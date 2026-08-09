-- reorder_tasks (req.md §55, Issue #21)
--
-- 20260808000007_reorder_tasks_exclude_deleted_siblings.sql が定める挙動を検証する:
--   - 論理削除されていない兄弟だけを並べ替えの対象とすること
--   - 論理削除済みの兄弟が残っていても reorder が成功し、可視の並び順が指定どおりになること
--   - 論理削除済みの行の position が動かないこと
--   - 兄弟グループの position が、論理削除済みを含めて 0 から連番で連続したままであること
--     (move_task の ±1 シフト・createTask の末尾採番・computeCreatePosition が依拠する不変条件)
--   - 論理削除済みの兄弟の ID を混ぜた場合は INVALID_PARENT で拒否されること
--
-- 固定データは使わず、このファイル専用の user / tasks を都度 INSERT する
-- (supabase test db は seed.sql を適用しないため、tests/ 側でフィクスチャを用意する)。
begin;
select plan(13);

insert into next_auth.users (id, name, email)
values ('70000000-0000-0000-0000-000000000000', 'reorder test user', 'reorder@test.local');

-- 4 つの親 P1〜P4 を root に置き、ケースごとに独立した兄弟グループを作る
insert into public.tasks (id, user_id, title, position)
values
  ('70000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000000', 'P1', 0),
  ('70000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-000000000000', 'P2', 1),
  ('70000000-0000-0000-0000-000000000003', '70000000-0000-0000-0000-000000000000', 'P3', 2),
  ('70000000-0000-0000-0000-000000000004', '70000000-0000-0000-0000-000000000000', 'P4', 3);

-- ケース1 (対照): 削除済みなし。P1 の子 A(0) / B(1) / C(2)
insert into public.tasks (id, user_id, title, parent_id, position)
values
  ('70000000-0000-0000-0000-0000000000a1', '70000000-0000-0000-0000-000000000000', 'A', '70000000-0000-0000-0000-000000000001', 0),
  ('70000000-0000-0000-0000-0000000000a2', '70000000-0000-0000-0000-000000000000', 'B', '70000000-0000-0000-0000-000000000001', 1),
  ('70000000-0000-0000-0000-0000000000a3', '70000000-0000-0000-0000-000000000000', 'C', '70000000-0000-0000-0000-000000000001', 2);

-- ケース2: 中間が削除済み。P2 の子 D(0) / E(1, 削除済み) / F(2)
insert into public.tasks (id, user_id, title, parent_id, position)
values
  ('70000000-0000-0000-0000-0000000000b1', '70000000-0000-0000-0000-000000000000', 'D', '70000000-0000-0000-0000-000000000002', 0),
  ('70000000-0000-0000-0000-0000000000b3', '70000000-0000-0000-0000-000000000000', 'F', '70000000-0000-0000-0000-000000000002', 2);

insert into public.tasks (id, user_id, title, parent_id, position, deleted_at)
values ('70000000-0000-0000-0000-0000000000b2', '70000000-0000-0000-0000-000000000000', 'E', '70000000-0000-0000-0000-000000000002', 1, now());

-- ケース3: 先頭が削除済み。P3 の子 G(0, 削除済み) / H(1) / I(2)
insert into public.tasks (id, user_id, title, parent_id, position, deleted_at)
values ('70000000-0000-0000-0000-0000000000c1', '70000000-0000-0000-0000-000000000000', 'G', '70000000-0000-0000-0000-000000000003', 0, now());

insert into public.tasks (id, user_id, title, parent_id, position)
values
  ('70000000-0000-0000-0000-0000000000c2', '70000000-0000-0000-0000-000000000000', 'H', '70000000-0000-0000-0000-000000000003', 1),
  ('70000000-0000-0000-0000-0000000000c3', '70000000-0000-0000-0000-000000000000', 'I', '70000000-0000-0000-0000-000000000003', 2);

-- ケース4: 末尾が削除済み。P4 の子 J(0) / K(1) / L(2, 削除済み)
insert into public.tasks (id, user_id, title, parent_id, position)
values
  ('70000000-0000-0000-0000-0000000000d1', '70000000-0000-0000-0000-000000000000', 'J', '70000000-0000-0000-0000-000000000004', 0),
  ('70000000-0000-0000-0000-0000000000d2', '70000000-0000-0000-0000-000000000000', 'K', '70000000-0000-0000-0000-000000000004', 1);

insert into public.tasks (id, user_id, title, parent_id, position, deleted_at)
values ('70000000-0000-0000-0000-0000000000d3', '70000000-0000-0000-0000-000000000000', 'L', '70000000-0000-0000-0000-000000000004', 2, now());

-- reorder_tasks は SECURITY INVOKER であり、next_auth.uid() を解決するために
-- request.jwt.claims を set_config で明示的に設定する (docs/migration-design.md §7.3)。
set local request.jwt.claims = '{"sub":"70000000-0000-0000-0000-000000000000","role":"authenticated"}';

--
-- ケース1: 削除済みなし (req.md §55 の 0, 1, 2, ... 再採番と一致することの確認)
--
-- 1. [C, A, B] への並べ替えが成功する
select lives_ok(
  $$select public.reorder_tasks(
      '70000000-0000-0000-0000-000000000001',
      array['70000000-0000-0000-0000-0000000000a3',
            '70000000-0000-0000-0000-0000000000a1',
            '70000000-0000-0000-0000-0000000000a2']::uuid[])$$,
  'reorder succeeds when no sibling is soft-deleted'
);

-- 2. position は 0, 1, 2 に再採番され、並びは C, A, B になる
select is(
  (select array_agg(t.title order by t.position)
   from public.tasks t
   where t.parent_id = '70000000-0000-0000-0000-000000000001'),
  array['C', 'A', 'B'],
  'siblings without a deleted one are renumbered to the requested order'
);

-- 3. position は 0 から連番で連続する
select is(
  (select array_agg(t.position order by t.position)
   from public.tasks t
   where t.parent_id = '70000000-0000-0000-0000-000000000001'),
  array[0, 1, 2],
  'positions under P1 stay contiguous from 0'
);

--
-- ケース2: 中間が削除済み (Issue #21 の再現ケース。修正前は INVALID_PARENT で失敗した)
--
-- 可視の兄弟 D / F が占める position は {0, 2} であり、[F, D] を渡すと F -> 0、D -> 2 になる。
--
-- 4. 論理削除済みの兄弟 E がいても reorder が成功する
select lives_ok(
  $$select public.reorder_tasks(
      '70000000-0000-0000-0000-000000000002',
      array['70000000-0000-0000-0000-0000000000b3',
            '70000000-0000-0000-0000-0000000000b1']::uuid[])$$,
  'reorder succeeds even though a middle sibling (E) is soft-deleted'
);

-- 5. app_tasks 上の可視の並びは F, D になる
select is(
  (select array_agg(a.title order by a.position)
   from public.app_tasks a
   where a.parent_id = '70000000-0000-0000-0000-000000000002'),
  array['F', 'D'],
  'visible siblings under P2 are ordered as requested (F, D)'
);

-- 6. 削除済みの E の position は 1 のまま動かない
select is(
  (select t.position from public.tasks t where t.id = '70000000-0000-0000-0000-0000000000b2'),
  1,
  'the soft-deleted sibling (E) keeps its original position'
);

-- 7. 削除済みを含めた position は 0, 1, 2 の連番のまま保たれる
select is(
  (select array_agg(t.position order by t.position)
   from public.tasks t
   where t.parent_id = '70000000-0000-0000-0000-000000000002'),
  array[0, 1, 2],
  'positions under P2 stay contiguous from 0 including the deleted sibling'
);

--
-- ケース3: 先頭が削除済み
--
-- 可視の兄弟 H / I が占める position は {1, 2} であり、[I, H] を渡すと I -> 1、H -> 2 になる。
--
-- 8. 先頭が削除済み (G) でも reorder が成功する
select lives_ok(
  $$select public.reorder_tasks(
      '70000000-0000-0000-0000-000000000003',
      array['70000000-0000-0000-0000-0000000000c3',
            '70000000-0000-0000-0000-0000000000c2']::uuid[])$$,
  'reorder succeeds when the first sibling (G) is soft-deleted'
);

-- 9. 可視の並びは I, H になる
select is(
  (select array_agg(a.title order by a.position)
   from public.app_tasks a
   where a.parent_id = '70000000-0000-0000-0000-000000000003'),
  array['I', 'H'],
  'visible siblings under P3 are ordered as requested (I, H)'
);

-- 10. 削除済みの G は position = 0 のまま残り、削除済みを含めた連番も保たれる
select is(
  (select array_agg(t.title || ':' || t.position order by t.position)
   from public.tasks t
   where t.parent_id = '70000000-0000-0000-0000-000000000003'),
  array['G:0', 'I:1', 'H:2'],
  'the deleted first sibling (G) stays at position 0 and positions stay contiguous'
);

--
-- ケース4: 末尾が削除済み
--
-- 可視の兄弟 J / K が占める position は {0, 1} であり、[K, J] を渡すと K -> 0、J -> 1 になる。
--
-- 11. 末尾が削除済み (L) でも reorder が成功する
select lives_ok(
  $$select public.reorder_tasks(
      '70000000-0000-0000-0000-000000000004',
      array['70000000-0000-0000-0000-0000000000d2',
            '70000000-0000-0000-0000-0000000000d1']::uuid[])$$,
  'reorder succeeds when the last sibling (L) is soft-deleted'
);

-- 12. 可視の並びは K, J になり、削除済みの L は position = 2 のまま動かない
select is(
  (select array_agg(t.title || ':' || t.position order by t.position)
   from public.tasks t
   where t.parent_id = '70000000-0000-0000-0000-000000000004'),
  array['K:0', 'J:1', 'L:2'],
  'visible siblings under P4 are swapped while the deleted last sibling (L) stays at position 2'
);

--
-- 件数検証
--
-- 13. 論理削除済みの兄弟 (E) の ID を混ぜると、可視の兄弟の件数と一致せず INVALID_PARENT になる
select throws_like(
  $$select public.reorder_tasks(
      '70000000-0000-0000-0000-000000000002',
      array['70000000-0000-0000-0000-0000000000b3',
            '70000000-0000-0000-0000-0000000000b2',
            '70000000-0000-0000-0000-0000000000b1']::uuid[])$$,
  'INVALID_PARENT%',
  'passing a soft-deleted sibling (E) in ordered_task_ids is rejected'
);

select * from finish();
rollback;
