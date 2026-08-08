-- restore_task (req.md §23, §56)
--
-- docs/migration-design.md §7.2 に対応する項目:
--   - シナリオ4 (req.md §74): Aを復元するとdependencyが再び有効になる
begin;
select plan(5);

insert into next_auth.users (id, name, email)
values ('40000000-0000-0000-0000-000000000000', 'restore test user', 'restore@test.local');

insert into public.tasks (id, user_id, title, position)
values
  ('40000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000000', 'A', 0),
  ('40000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000000', 'B', 1);

-- B は A に依存する (A -> B)
insert into public.task_dependencies (user_id, task_id, depends_on_task_id)
values ('40000000-0000-0000-0000-000000000000', '40000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000001');

-- 1. 削除前: B は blocked
select is(
  (select is_blocked from public.app_tasks where id = '40000000-0000-0000-0000-000000000002'),
  true,
  'B is blocked before A is deleted'
);

-- A を論理削除する
update public.tasks set deleted_at = now() where id = '40000000-0000-0000-0000-000000000001';

-- 2. A を削除すると B の blocked は解除される (req.md §23: blocked判定では削除済みタスクを無視する)
select is(
  (select is_blocked from public.app_tasks where id = '40000000-0000-0000-0000-000000000002'),
  false,
  'deleting A unblocks B (deleted dependency is ignored)'
);

-- 3. 削除済みタスク A は app_tasks から除外される (req.md §44)
select is(
  (select count(*) from public.app_tasks where id = '40000000-0000-0000-0000-000000000001'),
  0::bigint,
  'deleted task A is excluded from app_tasks'
);

-- restore_task は SECURITY INVOKER であり、next_auth.uid() を解決するために
-- request.jwt.claims を set_config で明示的に設定する (docs/migration-design.md §7.3)。
set local request.jwt.claims = '{"sub":"40000000-0000-0000-0000-000000000000","role":"authenticated"}';

select lives_ok(
  $$select public.restore_task('40000000-0000-0000-0000-000000000001')$$,
  'restore_task succeeds for the deleted task A'
);

-- 4. シナリオ4: A を復元すると dependency が再び有効になり、B は再び blocked になる
select is(
  (select is_blocked from public.app_tasks where id = '40000000-0000-0000-0000-000000000002'),
  true,
  'restoring A re-activates the dependency and B is blocked again'
);

select * from finish();
rollback;
