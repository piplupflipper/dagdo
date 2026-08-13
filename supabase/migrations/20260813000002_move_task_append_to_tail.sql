-- move_task: p_new_position = NULL を「新しい兄弟グループの末尾へ」として受け付ける (Issue #53)
--
-- 変更前 (20260808000005_rpc_functions.sql) の move_task は、p_new_position を
-- 「論理削除済みの行も含めた実 position」としてのみ解釈していた。この意味そのものは変えない。
--
-- 問題は「末尾へ追加する」意図をクライアントが実 position で表せないことにあった。
-- app_tasks View は論理削除済みを除外するため (20260808000003_app_tasks_view.sql)、
-- クライアントは移動先の兄弟グループの実際の末尾を知れない。
-- 例えば親 P の子が X(0) / Y(1, 論理削除済み) のとき、クライアントに見えるのは X(0) だけであり、
-- 末尾は 2 なのに「可視の兄弟の数」から 1 を求めてしまう。
-- 1 を渡すと本 RPC は position >= 1 の兄弟を +1 シフトして対象を 1 へ置くため、
-- 末尾ではなく Y の手前 (可視の並びでは X の直後、可視の最後の兄弟より前) へ入る (Issue #53)。
--
-- そこで、位置を「N 番目へ挿す」ではなく「末尾へ追加する」と表せるようにする。
-- p_new_position が NULL なら、移動先の actual sibling group (同一 parent_id、論理削除済みも含む) の
-- 末尾を RPC 側で求めて使う。末尾の求め方は restore_task (20260813000001) と同じ
-- `coalesce(max(position) + 1, 0)` である。
--
-- 数値を渡したときの意味は変更前のままであり、実 position を渡している既存の呼び出し
-- (computeCreatePosition / computeOutdent / create-task.ts の位置調整) には影響しない。
--
-- 末尾を求めるのは「旧 sibling group の隙間を詰める」の後である。
-- 移動先が移動元と同じ兄弟グループの場合、詰める前に求めると対象自身が抜けた分だけ末尾が 1 つ大きくなり、
-- 「同一 actual parent の兄弟グループの position は、論理削除済みの行も含めて 0 から連番で連続する」
-- という不変条件 (20260808000007_reorder_tasks_exclude_deleted_siblings.sql) を破って穴が空く。
--
-- 例: A(0) / B(1) / C(2) で A を NULL (末尾) へ移すと、まず B -> 0 / C -> 1 と詰め、
--     続いて A を末尾 (max(1) + 1 = 2) へ移すため、結果は B(0) / C(1) / A(2) になる。
--
-- 負の position を INVALID_POSITION (ET006) で拒否する契約は変えない (010_error_contract.test.sql)。
-- NULL はこの検査の対象外である。
create or replace function public.move_task(
  p_task_id uuid,
  p_new_parent_id uuid,
  p_new_position integer
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := next_auth.uid();
  v_old_parent_id uuid;
  v_old_position integer;
  v_new_position integer;
begin
  -- NULL は「末尾へ追加」を表すため、この検査を通す。
  -- `null < 0` は null と評価され if は成立しないが、意図を明示するため is not null を書く
  if p_new_position is not null and p_new_position < 0 then
    raise exception 'INVALID_POSITION: position must be non-negative, got %', p_new_position
      using errcode = 'ET006';
  end if;

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

  if p_new_parent_id is not null then
    if not exists (
      select 1
      from public.tasks
      where id = p_new_parent_id
        and user_id = v_user_id
    ) then
      raise exception 'INVALID_PARENT: parent task % not found', p_new_parent_id
        using errcode = 'ET007';
    end if;
  end if;

  -- 旧 sibling group の隙間を詰める
  update public.tasks
  set position = position - 1
  where user_id = v_user_id
    and parent_id is not distinct from v_old_parent_id
    and position > v_old_position
    and id <> p_task_id;

  -- p_new_position = NULL は新しい actual sibling group (論理削除済みも含む) の末尾を指す。
  -- 対象自身はこの後 position を上書きするため除外する (restore_task と同じ形)
  if p_new_position is null then
    select coalesce(max(position) + 1, 0)
    into v_new_position
    from public.tasks
    where user_id = v_user_id
      and parent_id is not distinct from p_new_parent_id
      and id <> p_task_id;
  else
    v_new_position := p_new_position;
  end if;

  -- 新 sibling group に隙間を空ける
  update public.tasks
  set position = position + 1
  where user_id = v_user_id
    and parent_id is not distinct from p_new_parent_id
    and position >= v_new_position
    and id <> p_task_id;

  -- 対象タスク自身を移動する (親子 cycle の最終確認は Trigger が行う)
  update public.tasks
  set parent_id = p_new_parent_id,
      position = v_new_position
  where id = p_task_id
    and user_id = v_user_id;
end;
$$;

-- create or replace function は pg_proc の行を置き換えるだけで ACL を引き継ぐため、
-- 20260808000005_rpc_functions.sql が設定した revoke/grant はこの migration の後も維持される。
-- ただし権限の状態をこのファイル単体で読み取れるようにするため、同じ内容を明示的に再設定する
-- (20260808000007_reorder_tasks_exclude_deleted_siblings.sql と同じ扱い)。
revoke execute on function public.move_task(uuid, uuid, integer) from public, anon;
grant execute on function public.move_task(uuid, uuid, integer) to authenticated;
