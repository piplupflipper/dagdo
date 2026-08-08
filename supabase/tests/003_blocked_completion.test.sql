-- blocked completion (req.md §12, §13, §50)
--
-- docs/migration-design.md §7.2 に対応する項目:
--   - シナリオ2 (req.md §74): Aが未完了ならAに依存するBを完了できない
--   - シナリオ3 (req.md §74): dependency Aを削除するとBのblockedが解除される
begin;
select plan(4);

insert into next_auth.users (id, name, email)
values ('30000000-0000-0000-0000-000000000000', 'blocked completion test user', 'blocked@test.local');

insert into public.tasks (id, user_id, title, position)
values
  ('30000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000000', 'A', 0),
  ('30000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000000', 'B', 1);

-- B は A に依存する (A -> B)
insert into public.task_dependencies (user_id, task_id, depends_on_task_id)
values ('30000000-0000-0000-0000-000000000000', '30000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001');

-- 1. app_tasks 上で B.is_blocked = true (A が未完了・未削除のため, req.md §12)
select is(
  (select is_blocked from public.app_tasks where id = '30000000-0000-0000-0000-000000000002'),
  true,
  'B is blocked while A is incomplete and not deleted'
);

-- 2. シナリオ2: A が未完了なら、A に依存する B を完了できない (TASK_BLOCKED)
select throws_like(
  $$update public.tasks set completed_at = now() where id = '30000000-0000-0000-0000-000000000002'$$,
  'TASK_BLOCKED%',
  'completing B while blocked by incomplete A is rejected'
);

-- 3. シナリオ3: dependency edge (B -> A) を削除すると B の blocked が解除される
delete from public.task_dependencies
where user_id = '30000000-0000-0000-0000-000000000000'
  and task_id = '30000000-0000-0000-0000-000000000002'
  and depends_on_task_id = '30000000-0000-0000-0000-000000000001';

select is(
  (select is_blocked from public.app_tasks where id = '30000000-0000-0000-0000-000000000002'),
  false,
  'removing the dependency edge unblocks B'
);

-- 4. 依存解除後は B を正常に完了できる (誤検知していないことの確認)
select lives_ok(
  $$update public.tasks set completed_at = now() where id = '30000000-0000-0000-0000-000000000002'$$,
  'B can be completed once no longer blocked'
);

select * from finish();
rollback;
