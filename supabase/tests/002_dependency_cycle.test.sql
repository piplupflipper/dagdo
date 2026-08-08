-- dependency cycle (req.md §49)
--
-- docs/migration-design.md §7.2 に対応する項目:
--   - シナリオ1 (req.md §74): A -> B -> C に C -> A を追加できない
--   - 自己依存禁止 (task_dependency_not_self、req.md §38)
--   - シナリオ7 (req.md §74): 削除済みノードを含めても cycle を生成できない
--
-- 依存関係の矢印表記は req.md §10 に従う: "X -> Y" は「Y は X に依存する」を意味し、
-- task_dependencies の行としては (task_id = Y, depends_on_task_id = X) となる。
begin;
select plan(4);

insert into next_auth.users (id, name, email)
values ('20000000-0000-0000-0000-000000000000', 'dependency cycle test user', 'dependency-cycle@test.local');

insert into public.tasks (id, user_id, title)
values
  ('20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000000', 'A'),
  ('20000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000000', 'B'),
  ('20000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000000', 'C'),
  ('20000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000000', 'X (self dependency target)');

-- 1. 自己依存禁止 (X -> X)。cycle トリガーが評価する前に CHECK 制約 task_dependency_not_self
--    が違反するため、標準の check_violation として拒否される。
select throws_like(
  $$insert into public.task_dependencies (user_id, task_id, depends_on_task_id)
    values ('20000000-0000-0000-0000-000000000000', '20000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000005')$$,
  '%task_dependency_not_self%',
  'self dependency (X depends on X) is rejected by CHECK constraint task_dependency_not_self'
);

-- 依存連鎖 A -> B -> C を構築する (B depends on A, C depends on B)。
insert into public.task_dependencies (user_id, task_id, depends_on_task_id)
values ('20000000-0000-0000-0000-000000000000', '20000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001');

insert into public.task_dependencies (user_id, task_id, depends_on_task_id)
values ('20000000-0000-0000-0000-000000000000', '20000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000002');

-- 2. シナリオ1: A -> B -> C に C -> A (A depends on C) を追加すると cycle になる。
select throws_like(
  $$insert into public.task_dependencies (user_id, task_id, depends_on_task_id)
    values ('20000000-0000-0000-0000-000000000000', '20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003')$$,
  'TASK_DEPENDENCY_CYCLE%',
  'A -> B -> C に C -> A を追加すると TASK_DEPENDENCY_CYCLE で拒否される'
);

-- 3. シナリオ7: A を論理削除しても依存 edge は保持され、cycle 判定は deleted_at を考慮しない。
update public.tasks set deleted_at = now() where id = '20000000-0000-0000-0000-000000000001';

select throws_like(
  $$insert into public.task_dependencies (user_id, task_id, depends_on_task_id)
    values ('20000000-0000-0000-0000-000000000000', '20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003')$$,
  'TASK_DEPENDENCY_CYCLE%',
  'deleted task (A) を経由する cycle も引き続き拒否される'
);

-- 4. 正の対照: cycle にならない新規依存は許可される (誤検知していないことの確認)。
select lives_ok(
  $$insert into public.task_dependencies (user_id, task_id, depends_on_task_id)
    values ('20000000-0000-0000-0000-000000000000', '20000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000003')$$,
  'a non-cyclic dependency (X depends on C) succeeds'
);

select * from finish();
rollback;
