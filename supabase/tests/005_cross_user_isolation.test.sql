-- ユーザー間の関係禁止 (req.md §39)
--
-- docs/migration-design.md §7.2 に対応する項目:
--   - シナリオ5 (req.md §74): 別ユーザーのtaskをparentに設定できない
--   - シナリオ6 (req.md §74): 別ユーザーのtaskへdependencyを張れない
--
-- これらは複合FK (tasks_parent_same_user_fkey / task_dependency_depends_on_fkey) が
-- ロール・RLSの有無に関わらず保証する制約である (docs/migration-design.md §7.2)。
-- 本テストでは実際のアプリ経路に近い形で検証するため、authenticated ロールへ切り替え、
-- request.jwt.claims を set_config で user A に切り替えたうえで実行する。
begin;
select plan(4);

insert into next_auth.users (id, name, email)
values
  ('50000000-0000-0000-0000-00000000000a', 'user A', 'user-a@test.local'),
  ('50000000-0000-0000-0000-00000000000b', 'user B', 'user-b@test.local');

insert into public.tasks (id, user_id, title)
values
  ('50000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-00000000000a', 'A root'),
  ('50000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-00000000000b', 'B root');

-- authenticated ロールへ切り替え、user A として以降のSQLを実行する。
set local role authenticated;
set local request.jwt.claims = '{"sub":"50000000-0000-0000-0000-00000000000a","role":"authenticated"}';

-- 1. シナリオ5: 別ユーザー(B)のtaskをparentに設定できない
select throws_like(
  $$insert into public.tasks (id, user_id, title, parent_id)
    values ('50000000-0000-0000-0000-000000000003', '50000000-0000-0000-0000-00000000000a', 'cross-user child', '50000000-0000-0000-0000-000000000002')$$,
  '%tasks_parent_same_user_fkey%',
  'creating a task whose parent belongs to another user (B) is rejected'
);

-- 2. シナリオ6: 別ユーザー(B)のtaskへdependencyを張れない
select throws_like(
  $$insert into public.task_dependencies (user_id, task_id, depends_on_task_id)
    values ('50000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000002')$$,
  '%task_dependency_depends_on_fkey%',
  'depending on another user''s (B) task is rejected'
);

-- 3. 正の対照: 同一ユーザー内の parent 設定は許可される
insert into public.tasks (id, user_id, title)
values ('50000000-0000-0000-0000-000000000004', '50000000-0000-0000-0000-00000000000a', 'A child candidate');

select lives_ok(
  $$update public.tasks set parent_id = '50000000-0000-0000-0000-000000000001'
    where id = '50000000-0000-0000-0000-000000000004'$$,
  'setting parent within the same user (A) succeeds'
);

-- 4. 正の対照: 同一ユーザー内の dependency 設定は許可される
select lives_ok(
  $$insert into public.task_dependencies (user_id, task_id, depends_on_task_id)
    values ('50000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000004')$$,
  'depending on a task within the same user (A) succeeds'
);

select * from finish();
rollback;
