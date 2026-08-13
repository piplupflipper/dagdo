-- restore_task / permanently_delete_task: position の連番に空く穴を詰める (Issue #23)
--
-- 「同一 actual parent の兄弟グループの position は、論理削除済みの行も含めて 0 から連番で連続する」
-- という不変条件を、両 RPC の実行後にも保つ。
-- この不変条件は 20260808000007_reorder_tasks_exclude_deleted_siblings.sql のコメントが明文化しており、
-- move_task の ±1 シフト (20260808000005_rpc_functions.sql)、
-- createTask の末尾採番 (src/features/task/actions/create-task.ts)、
-- computeCreatePosition (src/features/outline/lib/flatten-for-dnd.ts) が前提にしている。
--
-- 変更前 (20260808000005_rpc_functions.sql) の両 RPC はこれを壊していた。
--
--   restore_task: 復元対象を兄弟グループの末尾へ移すが、対象が元々占めていた position を詰めない。
--     A(0) / B(1, 論理削除済み) / C(2) で B を復元すると {0, 2, 3} になり position 1 が空く。
--   permanently_delete_task: 対象行を DELETE するだけで、同じ兄弟グループの後続の position を詰めない。
--     A(0) / B(1) / C(2) で B を完全削除すると {0, 2} になり position 1 が空く。
--
-- 穴が空くと createTask の末尾採番 (兄弟の件数を position にする) が既存行と衝突する。
-- tasks の position には check (position >= 0) しかなく一意制約が無いため (20260808000002_tasks_and_dependencies.sql)、
-- 重複はエラーにならず、以降その 2 行の並び順が不定になる。
--
-- 変更後は、いずれも move_task の「旧 sibling group の隙間を詰める」と同じ形の
-- `position = position - 1` を対象の position より後ろの兄弟へ適用する。

--
-- restore_task (req.md §26, §56)
--
-- 「復元対象の actual parent を共有する sibling group の末尾へ移動する」(req.md §26) 仕様は変えない。
-- 末尾へ移す前に、対象が抜けた穴を詰める順序にすることで、末尾の position が
-- 「詰めた後の兄弟の件数」と一致し、連番が保たれる。
--
-- 例: A(0) / B(1, 論理削除済み) / C(2) で B を復元すると、まず C -> 1 と詰め、
--     続いて B を末尾 (max(1) + 1 = 2) へ移すため、結果は A(0) / C(1) / B(2) になる。
create or replace function public.restore_task(
  p_task_id uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := next_auth.uid();
  v_parent_id uuid;
  v_old_position integer;
  v_next_position integer;
begin
  select parent_id, position
  into v_parent_id, v_old_position
  from public.tasks
  where id = p_task_id
    and user_id = v_user_id
    and deleted_at is not null
  for update;

  if not found then
    raise exception 'TASK_NOT_FOUND: deleted task % not found', p_task_id
      using errcode = 'ET001';
  end if;

  -- 復元対象が元々占めていた position の穴を詰める (Issue #23 の不具合 1)。
  -- 対象自身の position はこの後まとめて上書きするため、ここでは除外する
  update public.tasks
  set position = position - 1
  where user_id = v_user_id
    and parent_id is not distinct from v_parent_id
    and position > v_old_position
    and id <> p_task_id;

  -- 詰めた後の actual sibling group (同一 parent_id、削除済みも含む) の末尾へ (req.md §26)
  select coalesce(max(position) + 1, 0)
  into v_next_position
  from public.tasks
  where user_id = v_user_id
    and parent_id is not distinct from v_parent_id
    and id <> p_task_id;

  update public.tasks
  set deleted_at = null,
      position = v_next_position
  where id = p_task_id
    and user_id = v_user_id;
end;
$$;

--
-- permanently_delete_task (req.md §27, §57)
--
-- req.md §57 の 4 手順 (子の reparent、子の position 調整、dependency edge 削除、対象の DELETE) は変えず、
-- 対象が占めていた position の穴を詰める処理を加える (Issue #23 の不具合 2)。
--
-- 穴を詰めるのは子の reparent より前に行う。
-- 子を移す先のルート末尾 (max(position) + 1) は対象自身を除いて求めるため、
-- 先に詰めておかないと「対象がルート直下にいて、かつ子を持つ」場合に
-- 子の position が対象の position 以下へ落ちて重複する。
--
-- 例: ルート直下が B(0) だけで、B が子 X(0) / Y(1) を持つとき、
--     詰めてから求めれば末尾は 0 なので X -> 0 / Y -> 1 となり、B の DELETE 後に {0, 1} で連番が保たれる。
--     逆に DELETE 後に詰めると、X -> 0 / Y -> 1 の後で position > 0 を詰めてしまい Y -> 0 で X と重複する。
create or replace function public.permanently_delete_task(
  p_task_id uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := next_auth.uid();
  v_child record;
  v_next_root_position integer;
  v_old_parent_id uuid;
  v_old_position integer;
begin
  -- 変更前は exists による存在確認だけだったが、詰める基準に position が要るため
  -- move_task / restore_task と同じく for update で読む。
  -- TASK_NOT_FOUND のメッセージと SQLSTATE は変更前のまま維持する (010_error_contract.test.sql)
  select parent_id, position
  into v_old_parent_id, v_old_position
  from public.tasks
  where id = p_task_id
    and user_id = v_user_id
  for update;

  if not found then
    raise exception 'TASK_NOT_FOUND: task % not found', p_task_id
      using errcode = 'ET001';
  end if;

  -- 対象が占めていた position の穴を詰める。
  -- 対象自身の position はこの後の DELETE で消えるため書き換えない
  update public.tasks
  set position = position - 1
  where user_id = v_user_id
    and parent_id is not distinct from v_old_parent_id
    and position > v_old_position
    and id <> p_task_id;

  select coalesce(max(position) + 1, 0)
  into v_next_root_position
  from public.tasks
  where user_id = v_user_id
    and parent_id is null
    and id <> p_task_id;

  for v_child in
    select id
    from public.tasks
    where user_id = v_user_id
      and parent_id = p_task_id
    order by position
  loop
    update public.tasks
    set parent_id = null,
        position = v_next_root_position
    where id = v_child.id
      and user_id = v_user_id;

    v_next_root_position := v_next_root_position + 1;
  end loop;

  -- task_dependency_task_fkey / task_dependency_depends_on_fkey は on delete cascade だが、
  -- req.md §57 の手順どおり明示的にも削除しておく。
  delete from public.task_dependencies
  where user_id = v_user_id
    and (task_id = p_task_id or depends_on_task_id = p_task_id);

  delete from public.tasks
  where id = p_task_id
    and user_id = v_user_id;
end;
$$;

-- create or replace function は pg_proc の行を置き換えるだけで ACL を引き継ぐため、
-- 20260808000005_rpc_functions.sql が設定した revoke/grant はこの migration の後も維持される。
-- ただし権限の状態をこのファイル単体で読み取れるようにするため、同じ内容を明示的に再設定する
-- (20260808000007_reorder_tasks_exclude_deleted_siblings.sql と同じ扱い)。
revoke execute on function public.restore_task(uuid) from public, anon;
grant execute on function public.restore_task(uuid) to authenticated;

revoke execute on function public.permanently_delete_task(uuid) from public, anon;
grant execute on function public.permanently_delete_task(uuid) to authenticated;
