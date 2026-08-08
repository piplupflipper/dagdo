-- 親子 cycle (req.md §48)
--
-- docs/migration-design.md §7.2 に対応する項目:
--   - 自己参照禁止 (tasks_not_own_parent、req.md §37)
--   - 単純な多階層 cycle (A -> B -> C -> A) の拒否
--   - シナリオ7 (req.md §74): 削除済みノードを含めても cycle を生成できない
--
-- 固定データは使わず、このファイル専用の user / tasks を都度 INSERT する
-- (supabase test db は seed.sql を適用しないため、tests/ 側でフィクスチャを用意する)。
begin;
select plan(4);

insert into next_auth.users (id, name, email)
values ('10000000-0000-0000-0000-000000000000', 'parent cycle test user', 'parent-cycle@test.local');

-- A (root), B (A の子), C (B の子)、および無関係な root D
insert into public.tasks (id, user_id, title)
values
  ('10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000000', 'A'),
  ('10000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000000', 'D');

insert into public.tasks (id, user_id, title, parent_id)
values ('10000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000000', 'B', '10000000-0000-0000-0000-000000000001');

insert into public.tasks (id, user_id, title, parent_id)
values ('10000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000000', 'C', '10000000-0000-0000-0000-000000000002');

-- 1. 自己参照禁止 (A.parent_id = A.id)。
--    check_task_parent_cycle Trigger が「自分自身へ辿り着くcycle」として先に検知するため
--    (BEFORE トリガーは CHECK 制約より先に評価される)、実際に表面化するエラーは
--    TASK_PARENT_CYCLE になる。tasks_not_own_parent 制約自体は、Trigger を経由しない
--    経路 (制約違反の直接検証) に対する構造的な安全網として schema 上に存在する。
select throws_like(
  $$update public.tasks set parent_id = '10000000-0000-0000-0000-000000000001' where id = '10000000-0000-0000-0000-000000000001'$$,
  'TASK_PARENT_CYCLE%',
  'self-parent (A.parent_id = A.id) is rejected'
);

-- 2. 多階層 cycle: A -> B -> C の下で A.parent_id = C にすると A -> B -> C -> A の cycle になる。
select throws_like(
  $$update public.tasks set parent_id = '10000000-0000-0000-0000-000000000003' where id = '10000000-0000-0000-0000-000000000001'$$,
  'TASK_PARENT_CYCLE%',
  'multi-level cycle (A -> B -> C -> A) is rejected by the parent cycle trigger'
);

-- 3. シナリオ7 (req.md §74, §25): 削除済みノードを含めても cycle 判定は行われる。
--    B を論理削除しても、cycle 判定では deleted_at を考慮しない。
update public.tasks set deleted_at = now() where id = '10000000-0000-0000-0000-000000000002';

select throws_like(
  $$update public.tasks set parent_id = '10000000-0000-0000-0000-000000000003' where id = '10000000-0000-0000-0000-000000000001'$$,
  'TASK_PARENT_CYCLE%',
  'cycle via a logically deleted intermediate node (B) is still rejected'
);

-- 4. 正の対照: cycle にならない reparent は許可される (誤検知していないことの確認)。
select lives_ok(
  $$update public.tasks set parent_id = '10000000-0000-0000-0000-000000000001' where id = '10000000-0000-0000-0000-000000000004'$$,
  'a non-cyclic reparent (D under A) succeeds'
);

select * from finish();
rollback;
