-- RPC Function
--
-- req.md §52〜58。複数行更新・複数操作を1トランザクションにまとめる層。
-- SECURITY INVOKER (既定) を使用し、呼び出し元の RLS をそのまま維持する (req.md §52)。
-- search_path はすべて明示的にスキーマ修飾することで固定し、search_path 汚染を避ける。
--
-- cycle 検出ロジックは Trigger 側を正とし、RPC 側では重複させない (req.md §53)。
-- SQLSTATE 割り当ては migration 4 (triggers) のコメントを参照。

--
-- move_task (req.md §54)
--
-- task_id を new_parent_id 配下の new_position へ移動する。
-- 旧 sibling group の position を詰め、新 sibling group の position を空け、
-- 最後に対象タスク自身の parent_id / position を更新する。
-- 親子 cycle の最終的な保証は Trigger (check_task_parent_cycle) が行う。
create function public.move_task(
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
begin
  if p_new_position < 0 then
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

  -- 新 sibling group に隙間を空ける
  update public.tasks
  set position = position + 1
  where user_id = v_user_id
    and parent_id is not distinct from p_new_parent_id
    and position >= p_new_position
    and id <> p_task_id;

  -- 対象タスク自身を移動する (親子 cycle の最終確認は Trigger が行う)
  update public.tasks
  set parent_id = p_new_parent_id,
      position = p_new_position
  where id = p_task_id
    and user_id = v_user_id;
end;
$$;

revoke execute on function public.move_task(uuid, uuid, integer) from public, anon;
grant execute on function public.move_task(uuid, uuid, integer) to authenticated;

--
-- reorder_tasks (req.md §55)
--
-- 指定された actual sibling group (同一 parent_id) 全体を ordered_task_ids の順に
-- position = 0, 1, 2, ... と再採番する。
-- 対象が同一ユーザー・同一 actual parent であることを検証する。
create function public.reorder_tasks(
  p_parent_id uuid,
  p_ordered_task_ids uuid[]
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := next_auth.uid();
  v_task_id uuid;
  v_position integer := 0;
  v_expected_count integer;
  v_matched_count integer;
begin
  select count(*)
  into v_expected_count
  from public.tasks
  where user_id = v_user_id
    and parent_id is not distinct from p_parent_id;

  select count(*)
  into v_matched_count
  from unnest(p_ordered_task_ids) as ids(id)
  join public.tasks tk
    on tk.id = ids.id
   and tk.user_id = v_user_id
   and tk.parent_id is not distinct from p_parent_id;

  if p_ordered_task_ids is null
     or array_length(p_ordered_task_ids, 1) is distinct from v_expected_count
     or v_matched_count is distinct from v_expected_count
  then
    raise exception 'INVALID_PARENT: ordered_task_ids does not match the sibling group of parent %', p_parent_id
      using errcode = 'ET007';
  end if;

  foreach v_task_id in array p_ordered_task_ids
  loop
    update public.tasks
    set position = v_position
    where id = v_task_id
      and user_id = v_user_id;

    v_position := v_position + 1;
  end loop;
end;
$$;

revoke execute on function public.reorder_tasks(uuid, uuid[]) from public, anon;
grant execute on function public.reorder_tasks(uuid, uuid[]) to authenticated;

--
-- add_task_dependency (req.md §53)
--
-- INSERT を行うだけの薄いラッパー。cycle検出は Trigger (check_task_dependency_cycle) に委譲し、
-- RPC側では重複させない。
create function public.add_task_dependency(
  p_task_id uuid,
  p_depends_on_task_id uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := next_auth.uid();
begin
  if not exists (
    select 1 from public.tasks where id = p_task_id and user_id = v_user_id
  ) then
    raise exception 'TASK_NOT_FOUND: task % not found', p_task_id
      using errcode = 'ET001';
  end if;

  if not exists (
    select 1 from public.tasks where id = p_depends_on_task_id and user_id = v_user_id
  ) then
    raise exception 'TASK_NOT_FOUND: task % not found', p_depends_on_task_id
      using errcode = 'ET001';
  end if;

  if exists (
    select 1
    from public.task_dependencies
    where user_id = v_user_id
      and task_id = p_task_id
      and depends_on_task_id = p_depends_on_task_id
  ) then
    raise exception 'DEPENDENCY_ALREADY_EXISTS: dependency task_id=% depends_on_task_id=% already exists', p_task_id, p_depends_on_task_id
      using errcode = 'ET005';
  end if;

  insert into public.task_dependencies (user_id, task_id, depends_on_task_id)
  values (v_user_id, p_task_id, p_depends_on_task_id);
end;
$$;

revoke execute on function public.add_task_dependency(uuid, uuid) from public, anon;
grant execute on function public.add_task_dependency(uuid, uuid) to authenticated;

--
-- restore_task (req.md §56)
--
-- deleted_at = NULL に戻す。actual parent は変更せず、actual sibling group の末尾へ position を
-- 移動する。親・依存関係など、論理削除中に保持していた構造はそのまま再利用する (削除・更新しない)。
create function public.restore_task(
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
  v_next_position integer;
begin
  select parent_id
  into v_parent_id
  from public.tasks
  where id = p_task_id
    and user_id = v_user_id
    and deleted_at is not null
  for update;

  if not found then
    raise exception 'TASK_NOT_FOUND: deleted task % not found', p_task_id
      using errcode = 'ET001';
  end if;

  -- actual sibling group (同一 parent_id、削除済みも含む) の末尾へ
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

revoke execute on function public.restore_task(uuid) from public, anon;
grant execute on function public.restore_task(uuid) to authenticated;

--
-- permanently_delete_task (req.md §57)
--
-- 1トランザクションで、子タスクの parent_id を NULL へ変更してルート側 position を調整し、
-- 関連 dependency edge を削除したうえで対象タスクを物理 DELETE する。
-- tasks_parent_same_user_fkey には on delete 指定がなく (既定 NO ACTION)、子タスクが
-- parent_id を保持したままでは対象タスクを DELETE できないため、reparent を先に行う。
create function public.permanently_delete_task(
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
begin
  if not exists (
    select 1 from public.tasks where id = p_task_id and user_id = v_user_id
  ) then
    raise exception 'TASK_NOT_FOUND: task % not found', p_task_id
      using errcode = 'ET001';
  end if;

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

revoke execute on function public.permanently_delete_task(uuid) from public, anon;
grant execute on function public.permanently_delete_task(uuid) to authenticated;
