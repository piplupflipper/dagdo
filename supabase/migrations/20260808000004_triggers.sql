-- Trigger
--
-- req.md §47〜50 が定める、どの経路から書き換えても破られてはいけない不変条件。
-- エラーは ERRCODE を明示的に指定した RAISE EXCEPTION とし、メッセージ先頭に
-- req.md §66 のエラーコード文字列を置くことで、アプリ側がメッセージ文字列と
-- SQLSTATE (`error.code`) の両方から判別できるようにする。
--
-- dagdo 固有の SQLSTATE 割り当て (P0001 等の予約域と衝突しない 5 文字コード):
--   ET001 TASK_NOT_FOUND            (RPC側で使用。migration 5)
--   ET002 TASK_PARENT_CYCLE
--   ET003 TASK_DEPENDENCY_CYCLE
--   ET004 TASK_BLOCKED
--   ET005 DEPENDENCY_ALREADY_EXISTS (RPC側で使用。migration 5)
--   ET006 INVALID_POSITION          (RPC側で使用。migration 5)
--   ET007 INVALID_PARENT            (RPC側で使用。migration 5)

--
-- (a) 親子 cycle Trigger (req.md §48)
--
-- NEW.parent_id から ancestor を辿り、NEW.id に到達したら TASK_PARENT_CYCLE。
-- deleted なタスクも探索対象とする (req.md §25: cycle判定ではdeleted_atを考慮しない)。
create function public.check_task_parent_cycle()
returns trigger
language plpgsql
as $$
declare
  v_cycle_found boolean;
begin
  if new.parent_id is null then
    return new;
  end if;

  with recursive ancestors as (
    select t.id, t.parent_id
    from public.tasks t
    where t.id = new.parent_id

    union all

    select t.id, t.parent_id
    from public.tasks t
    join ancestors a on t.id = a.parent_id
  )
  select exists (select 1 from ancestors where id = new.id)
  into v_cycle_found;

  if v_cycle_found then
    raise exception 'TASK_PARENT_CYCLE: setting parent_id=% on task % would create a cycle', new.parent_id, new.id
      using errcode = 'ET002';
  end if;

  return new;
end;
$$;

create trigger trg_check_task_parent_cycle
before insert or update of parent_id on public.tasks
for each row
execute function public.check_task_parent_cycle();

--
-- (b) dependency cycle Trigger (req.md §49)
--
-- 新規に張る task_id → depends_on_task_id が cycle を生むかを、
-- depends_on_task_id から辿れる依存先を recursive CTE で判定する。
-- deleted なタスクも探索対象とする (dependency edge は deleted_at にかかわらず保持されるため、
-- 追加のフィルタなしで自然に含まれる)。
create function public.check_task_dependency_cycle()
returns trigger
language plpgsql
as $$
declare
  v_cycle_found boolean;
begin
  with recursive reachable as (
    select td.depends_on_task_id
    from public.task_dependencies td
    where td.user_id = new.user_id
      and td.task_id = new.depends_on_task_id

    union all

    select td.depends_on_task_id
    from public.task_dependencies td
    join reachable r on td.task_id = r.depends_on_task_id
    where td.user_id = new.user_id
  )
  select exists (select 1 from reachable where depends_on_task_id = new.task_id)
  into v_cycle_found;

  if v_cycle_found then
    raise exception 'TASK_DEPENDENCY_CYCLE: adding dependency task_id=% depends_on_task_id=% would create a cycle', new.task_id, new.depends_on_task_id
      using errcode = 'ET003';
  end if;

  return new;
end;
$$;

create trigger trg_check_task_dependency_cycle
before insert on public.task_dependencies
for each row
execute function public.check_task_dependency_cycle();

--
-- (c) blocked completion Trigger (req.md §50)
--
-- OLD.completed_at IS NULL AND NEW.completed_at IS NOT NULL の遷移時のみ発火する。
-- 未完了かつ未削除の依存先が存在する場合は TASK_BLOCKED として拒否する。
create function public.check_task_blocked_completion()
returns trigger
language plpgsql
as $$
declare
  v_blocked boolean;
begin
  select exists (
    select 1
    from public.task_dependencies td
    join public.tasks dep on dep.id = td.depends_on_task_id
    where td.user_id = new.user_id
      and td.task_id = new.id
      and dep.completed_at is null
      and dep.deleted_at is null
  )
  into v_blocked;

  if v_blocked then
    raise exception 'TASK_BLOCKED: task % has an incomplete, non-deleted dependency', new.id
      using errcode = 'ET004';
  end if;

  return new;
end;
$$;

create trigger trg_check_task_blocked_completion
before update on public.tasks
for each row
when (old.completed_at is null and new.completed_at is not null)
execute function public.check_task_blocked_completion();

--
-- (d) updated_at 自動更新 Trigger (req.md §47)
--
create function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_tasks_set_updated_at
before update on public.tasks
for each row
execute function public.set_updated_at();
