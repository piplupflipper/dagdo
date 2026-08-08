-- app_tasks View の派生値検証 (req.md §22, §44〜46, §12)
--
-- docs/migration-design.md §7.4 に対応する項目:
--   - effective_parent_id: 削除済み祖先を挟んだ場合に最も近い未削除祖先が返ること。
--     祖先がすべて削除済みの場合に NULL が返ること。
--   - sort_path: 削除済みノードを挟んでも position を連結した配列が tree 順序を表現すること。
--   - is_blocked: 未完了かつ未削除の依存先が存在する場合に true、
--     依存先が完了済みまたは削除済みの場合に false になること。
begin;
select plan(10);

insert into next_auth.users (id, name, email)
values ('60000000-0000-0000-0000-000000000000', 'app_tasks view test user', 'app-tasks-view@test.local');

--
-- effective_parent_id / sort_path 用フィクスチャ (req.md §22, §46 の例と同型)
--
-- A position=0 (root)
-- +- B position=1 (deleted)
-- |  +- C position=0
-- +- D position=2
insert into public.tasks (id, user_id, title, position)
values ('60000000-0000-0000-0000-00000000000a', '60000000-0000-0000-0000-000000000000', 'A', 0);

insert into public.tasks (id, user_id, title, parent_id, position, deleted_at)
values ('60000000-0000-0000-0000-00000000000b', '60000000-0000-0000-0000-000000000000', 'B', '60000000-0000-0000-0000-00000000000a', 1, now());

insert into public.tasks (id, user_id, title, parent_id, position)
values ('60000000-0000-0000-0000-00000000000c', '60000000-0000-0000-0000-000000000000', 'C', '60000000-0000-0000-0000-00000000000b', 0);

insert into public.tasks (id, user_id, title, parent_id, position)
values ('60000000-0000-0000-0000-00000000000d', '60000000-0000-0000-0000-000000000000', 'D', '60000000-0000-0000-0000-00000000000a', 2);

-- 1. C.effective_parent_id は削除済みの B を飛ばして A になる (req.md §22)
select is(
  (select effective_parent_id from public.app_tasks where id = '60000000-0000-0000-0000-00000000000c'),
  '60000000-0000-0000-0000-00000000000a'::uuid,
  'effective_parent_id skips a deleted ancestor (B) and resolves to A'
);

-- 2. C.sort_path は削除済みの中間ノード B の position も含めて {0,1,0} になる (req.md §46)
select is(
  (select sort_path from public.app_tasks where id = '60000000-0000-0000-0000-00000000000c'),
  array[0, 1, 0],
  'sort_path includes the position of a deleted intermediate node (B)'
);

-- 3. D.sort_path は {0,2} になる (req.md §46)
select is(
  (select sort_path from public.app_tasks where id = '60000000-0000-0000-0000-00000000000d'),
  array[0, 2],
  'sort_path of D reflects its own position under root A'
);

-- 4. D.effective_parent_id は直接の親 A (未削除) になる (対照)
select is(
  (select effective_parent_id from public.app_tasks where id = '60000000-0000-0000-0000-00000000000d'),
  '60000000-0000-0000-0000-00000000000a'::uuid,
  'effective_parent_id of D is its direct, non-deleted parent A'
);

-- 5. 削除済みタスク B 自身は app_tasks から除外される (req.md §44)
select is(
  (select count(*) from public.app_tasks where id = '60000000-0000-0000-0000-00000000000b'),
  0::bigint,
  'deleted task B itself is excluded from app_tasks'
);

--
-- 祖先がすべて削除済みの場合、effective_parent_id は NULL になる
--
-- E position=0 (root, deleted)
-- +- F position=0 (deleted)
--    +- G position=0
insert into public.tasks (id, user_id, title, position, deleted_at)
values ('60000000-0000-0000-0000-00000000000e', '60000000-0000-0000-0000-000000000000', 'E', 0, now());

insert into public.tasks (id, user_id, title, parent_id, position, deleted_at)
values ('60000000-0000-0000-0000-00000000000f', '60000000-0000-0000-0000-000000000000', 'F', '60000000-0000-0000-0000-00000000000e', 0, now());

insert into public.tasks (id, user_id, title, parent_id, position)
values ('60000000-0000-0000-0000-000000000010', '60000000-0000-0000-0000-000000000000', 'G', '60000000-0000-0000-0000-00000000000f', 0);

-- 6. すべての祖先 (E, F) が削除済みの場合、G.effective_parent_id は NULL になる (req.md §22)
select is(
  (select effective_parent_id from public.app_tasks where id = '60000000-0000-0000-0000-000000000010'),
  null::uuid,
  'effective_parent_id is NULL when every ancestor (E, F) is deleted'
);

--
-- is_blocked フィクスチャ (req.md §12)
--
insert into public.tasks (id, user_id, title, position)
values
  ('60000000-0000-0000-0000-000000000011', '60000000-0000-0000-0000-000000000000', 'H1 (no dependency)', 3),
  ('60000000-0000-0000-0000-000000000012', '60000000-0000-0000-0000-000000000000', 'H2 (incomplete dependency target)', 4),
  ('60000000-0000-0000-0000-000000000013', '60000000-0000-0000-0000-000000000000', 'H3 (depends on H2)', 5);

insert into public.tasks (id, user_id, title, position, completed_at)
values ('60000000-0000-0000-0000-000000000014', '60000000-0000-0000-0000-000000000000', 'H4 (completed dependency target)', 6, now());

insert into public.tasks (id, user_id, title, position)
values
  ('60000000-0000-0000-0000-000000000015', '60000000-0000-0000-0000-000000000000', 'H5 (depends on H4)', 7),
  ('60000000-0000-0000-0000-000000000016', '60000000-0000-0000-0000-000000000000', 'H6 (dependency target, to be deleted)', 8),
  ('60000000-0000-0000-0000-000000000017', '60000000-0000-0000-0000-000000000000', 'H7 (depends on H6)', 9);

insert into public.task_dependencies (user_id, task_id, depends_on_task_id)
values
  ('60000000-0000-0000-0000-000000000000', '60000000-0000-0000-0000-000000000013', '60000000-0000-0000-0000-000000000012'),
  ('60000000-0000-0000-0000-000000000000', '60000000-0000-0000-0000-000000000015', '60000000-0000-0000-0000-000000000014'),
  ('60000000-0000-0000-0000-000000000000', '60000000-0000-0000-0000-000000000017', '60000000-0000-0000-0000-000000000016');

update public.tasks set deleted_at = now() where id = '60000000-0000-0000-0000-000000000016';

-- 7. 依存先を持たない H1 は is_blocked = false
select is(
  (select is_blocked from public.app_tasks where id = '60000000-0000-0000-0000-000000000011'),
  false,
  'a task with no dependency is not blocked'
);

-- 8. 未完了・未削除の依存先 (H2) を持つ H3 は is_blocked = true
select is(
  (select is_blocked from public.app_tasks where id = '60000000-0000-0000-0000-000000000013'),
  true,
  'a task depending on an incomplete, non-deleted task is blocked'
);

-- 9. 依存先 (H4) が完了済みの場合、H5 は is_blocked = false
select is(
  (select is_blocked from public.app_tasks where id = '60000000-0000-0000-0000-000000000015'),
  false,
  'a task depending on a completed task is not blocked'
);

-- 10. 依存先 (H6) が削除済みの場合、H7 は is_blocked = false
select is(
  (select is_blocked from public.app_tasks where id = '60000000-0000-0000-0000-000000000017'),
  false,
  'a task depending on a deleted task is not blocked'
);

select * from finish();
rollback;
