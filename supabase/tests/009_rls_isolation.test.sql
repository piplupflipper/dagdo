-- RLS による他ユーザー行の遮断 (req.md §40〜43, Issue #30)
--
-- 20260808000006_rls_policies.sql が定める Policy と GRANT を、authenticated ロールとして
-- 実際に読み書きすることで検証する:
--   - 他ユーザーの行が SELECT で 1 件も見えないこと (tasks / app_tasks / task_dependencies)
--   - 他ユーザーの行に対する UPDATE / DELETE が 0 行で終わること (エラーにはならない)
--   - 他ユーザーを user_id に指定した INSERT が with check 違反で拒否されること
--   - 自分の行に対する SELECT / UPDATE / DELETE は通ること (正の対照)
--   - 上記を終えたあとも、他ユーザーの行が元のまま残っていること
--
-- 005_cross_user_isolation.test.sql が検証するのは複合 FK であり、ロール・RLS の有無に
-- 依らず成立する制約である。本ファイルは RLS Policy と GRANT そのものを対象とする。
--
-- UPDATE / DELETE の影響行数を直接アサートするため、row_count を返す補助関数を用意する。
-- SECURITY INVOKER (既定) なので、authenticated として呼べば RLS は呼び出し元のまま適用される。
--
-- 固定データは使わず、このファイル専用の user / tasks を都度 INSERT する
-- (supabase test db は seed.sql を適用しないため、tests/ 側でフィクスチャを用意する)。
begin;
select plan(14);

create function public.rls_test_affected_rows(p_sql text)
returns integer
language plpgsql
as $$
declare
  v_count integer;
begin
  execute p_sql;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

insert into next_auth.users (id, name, email)
values
  ('90000000-0000-0000-0000-00000000000a', 'rls user A', 'rls-user-a@test.local'),
  ('90000000-0000-0000-0000-00000000000b', 'rls user B', 'rls-user-b@test.local');

-- user A: root A1 と、その子 A2
insert into public.tasks (id, user_id, title, position)
values ('90000000-0000-0000-0000-0000000000a1', '90000000-0000-0000-0000-00000000000a', 'A root', 0);

insert into public.tasks (id, user_id, title, parent_id, position)
values ('90000000-0000-0000-0000-0000000000a2', '90000000-0000-0000-0000-00000000000a', 'A child', '90000000-0000-0000-0000-0000000000a1', 0);

insert into public.task_dependencies (user_id, task_id, depends_on_task_id)
values ('90000000-0000-0000-0000-00000000000a', '90000000-0000-0000-0000-0000000000a2', '90000000-0000-0000-0000-0000000000a1');

-- user B: root B1 / B2
insert into public.tasks (id, user_id, title, position)
values
  ('90000000-0000-0000-0000-0000000000b1', '90000000-0000-0000-0000-00000000000b', 'B root', 0),
  ('90000000-0000-0000-0000-0000000000b2', '90000000-0000-0000-0000-00000000000b', 'B second', 1);

insert into public.task_dependencies (user_id, task_id, depends_on_task_id)
values ('90000000-0000-0000-0000-00000000000b', '90000000-0000-0000-0000-0000000000b2', '90000000-0000-0000-0000-0000000000b1');

-- authenticated ロールへ切り替え、user B として以降の SQL を実行する
-- (005_cross_user_isolation.test.sql と同じ書き方)。
set local role authenticated;
set local request.jwt.claims = '{"sub":"90000000-0000-0000-0000-00000000000b","role":"authenticated"}';

--
-- SELECT
--
-- 1. user A の tasks は 1 件も見えない
select is(
  (select count(*) from public.tasks
   where user_id = '90000000-0000-0000-0000-00000000000a'),
  0::bigint,
  'user B cannot select any of user A''s tasks'
);

-- 2. 正の対照: 見えるのは自分の 2 件だけである
--    (RLS が「全部見えない」状態を誤って合格にしていないことの確認も兼ねる)
select is(
  (select count(*) from public.tasks),
  2::bigint,
  'user B sees exactly its own 2 tasks and nothing else'
);

-- 3. app_tasks View も security_invoker = true により RLS を引き継ぐ
select is(
  (select count(*) from public.app_tasks
   where user_id = '90000000-0000-0000-0000-00000000000a'),
  0::bigint,
  'user B cannot select any of user A''s rows through app_tasks'
);

-- 4. user A の task_dependencies も 1 件も見えない
select is(
  (select count(*) from public.task_dependencies
   where user_id = '90000000-0000-0000-0000-00000000000a'),
  0::bigint,
  'user B cannot select any of user A''s dependencies'
);

-- 5. 正の対照: 自分の dependency は見える
select is(
  (select count(*) from public.task_dependencies),
  1::bigint,
  'user B sees exactly its own 1 dependency and nothing else'
);

--
-- UPDATE / DELETE
--
-- RLS は他ユーザーの行を「存在しないもの」として扱うため、エラーではなく影響 0 行になる。
--
-- 6. user A の tasks への UPDATE は 0 行
select is(
  public.rls_test_affected_rows(
    $$update public.tasks set title = 'hijacked by B'
      where user_id = '90000000-0000-0000-0000-00000000000a'$$),
  0,
  'updating user A''s tasks affects 0 rows'
);

-- 7. user A の task_dependencies への UPDATE は 0 行
select is(
  public.rls_test_affected_rows(
    $$update public.task_dependencies set created_at = now()
      where user_id = '90000000-0000-0000-0000-00000000000a'$$),
  0,
  'updating user A''s dependencies affects 0 rows'
);

-- 8. user A の tasks への DELETE は 0 行
select is(
  public.rls_test_affected_rows(
    $$delete from public.tasks
      where user_id = '90000000-0000-0000-0000-00000000000a'$$),
  0,
  'deleting user A''s tasks affects 0 rows'
);

-- 9. user A の task_dependencies への DELETE は 0 行
select is(
  public.rls_test_affected_rows(
    $$delete from public.task_dependencies
      where user_id = '90000000-0000-0000-0000-00000000000a'$$),
  0,
  'deleting user A''s dependencies affects 0 rows'
);

--
-- INSERT
--
-- 10. 他ユーザーを user_id に指定した INSERT は with check 違反で拒否される
select throws_like(
  $$insert into public.tasks (id, user_id, title)
    values ('90000000-0000-0000-0000-0000000000c1', '90000000-0000-0000-0000-00000000000a', 'planted by B')$$,
  '%violates row-level security policy%',
  'inserting a task owned by user A is rejected by the RLS with check'
);

--
-- 正の対照: 自分の行は書き換えられる
--
-- 11. 自分の task は UPDATE できる
select is(
  public.rls_test_affected_rows(
    $$update public.tasks set title = 'B root renamed'
      where id = '90000000-0000-0000-0000-0000000000b1'$$),
  1,
  'user B can update its own task'
);

-- 12. 自分の dependency は DELETE できる
select is(
  public.rls_test_affected_rows(
    $$delete from public.task_dependencies
      where user_id = '90000000-0000-0000-0000-00000000000b'$$),
  1,
  'user B can delete its own dependency'
);

--
-- 事後確認 (RLS を経由しない superuser 視点)
--
reset role;

-- 13. user A の tasks は 2 件とも元のタイトルのまま残っている
select is(
  (select array_agg(t.title order by t.title)
   from public.tasks t
   where t.user_id = '90000000-0000-0000-0000-00000000000a'),
  array['A child', 'A root'],
  'user A''s tasks survive untouched'
);

-- 14. user A の dependency も残っている
select is(
  (select count(*) from public.task_dependencies
   where user_id = '90000000-0000-0000-0000-00000000000a'),
  1::bigint,
  'user A''s dependency survives untouched'
);

select * from finish();
rollback;
