-- SQLSTATE エラー契約 ET001〜ET007 (req.md §66, Issue #30)
--
-- 20260808000004_triggers.sql:8-15 が宣言する dagdo 固有の SQLSTATE 割り当てを、
-- 1 ファイルで漏れなく固定する。
--
--   ET001 TASK_NOT_FOUND            (RPC: move_task ほか)
--   ET002 TASK_PARENT_CYCLE         (Trigger: check_task_parent_cycle)
--   ET003 TASK_DEPENDENCY_CYCLE     (Trigger: check_task_dependency_cycle)
--   ET004 TASK_BLOCKED              (Trigger: check_task_blocked_completion)
--   ET005 DEPENDENCY_ALREADY_EXISTS (RPC: add_task_dependency)
--   ET006 INVALID_POSITION          (RPC: move_task)
--   ET007 INVALID_PARENT            (RPC: move_task / reorder_tasks)
--
-- なぜ独立したファイルにするか:
-- src/features/task/lib/map-db-error.ts:39-44 は「SQLSTATE は migration が定める契約であり
-- 変わりにくい。メッセージ文字列は将来の文言変更に弱い」として SQLSTATE を最優先で判定する。
-- ところが 001〜007 の検査はいずれも throws_like によるメッセージ前置詞のみで、
-- `using errcode` を書き換えても全件緑のまま通ってしまう。
-- 001〜007 は req.md のシナリオ単位で組まれており、エラーコード単位では並んでいない。
-- 契約表そのものの写しとしては、宣言元 (triggers migration の冒頭コメント) と 1 対 1 で
-- 対応する本ファイルに集約するほうが、コードを追加したときの追随漏れに気付きやすい。
-- 各エラーの「どのシナリオで起きるか」「メッセージ前置詞は何か」は 001〜007 と 008 が引き続き担う。
--
-- 固定データは使わず、このファイル専用の user / tasks を都度 INSERT する
-- (supabase test db は seed.sql を適用しないため、tests/ 側でフィクスチャを用意する)。
begin;
select plan(8);

insert into next_auth.users (id, name, email)
values
  ('a0000000-0000-0000-0000-00000000000a', 'error contract owner', 'error-contract-owner@test.local'),
  ('a0000000-0000-0000-0000-00000000000b', 'error contract other', 'error-contract-other@test.local');

-- owner: root T1(0) / T3(1) / T4(2)、T1 の子 T2(0)
insert into public.tasks (id, user_id, title, position)
values
  ('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', 'T1', 0),
  ('a0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-00000000000a', 'T3', 1),
  ('a0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-00000000000a', 'T4', 2);

insert into public.tasks (id, user_id, title, parent_id, position)
values ('a0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-00000000000a', 'T2', 'a0000000-0000-0000-0000-000000000001', 0);

-- T3 は T4 に依存する (T4 -> T3)。T4 が未完了・未削除のため T3 は blocked である。
insert into public.task_dependencies (user_id, task_id, depends_on_task_id)
values ('a0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000004');

-- 他ユーザーの root task Z (ET007 の検証に使う)
insert into public.tasks (id, user_id, title, position)
values ('a0000000-0000-0000-0000-0000000000f1', 'a0000000-0000-0000-0000-00000000000b', 'Z', 0);

-- RPC は SECURITY INVOKER であり、next_auth.uid() を解決するために
-- request.jwt.claims を set_config で明示的に設定する (docs/migration-design.md §7.3)。
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-00000000000a","role":"authenticated"}';

-- 1. ET001 TASK_NOT_FOUND: 存在しない task を move_task の対象にする
select throws_ok(
  $$select public.move_task(
      'a0000000-0000-0000-0000-0000000000ee',
      null,
      0)$$,
  'ET001'::char(5),
  null,
  'ET001 TASK_NOT_FOUND is raised for an unknown task'
);

-- 2. ET002 TASK_PARENT_CYCLE: 自分の子 T2 を自分 T1 の親にする
select throws_ok(
  $$update public.tasks
    set parent_id = 'a0000000-0000-0000-0000-000000000002'
    where id = 'a0000000-0000-0000-0000-000000000001'$$,
  'ET002'::char(5),
  null,
  'ET002 TASK_PARENT_CYCLE is raised when a descendant becomes the parent'
);

-- 3. ET003 TASK_DEPENDENCY_CYCLE: T4 -> T3 に対して T3 -> T4 を足す
select throws_ok(
  $$insert into public.task_dependencies (user_id, task_id, depends_on_task_id)
    values ('a0000000-0000-0000-0000-00000000000a',
            'a0000000-0000-0000-0000-000000000004',
            'a0000000-0000-0000-0000-000000000003')$$,
  'ET003'::char(5),
  null,
  'ET003 TASK_DEPENDENCY_CYCLE is raised when a dependency edge closes a cycle'
);

-- 4. ET004 TASK_BLOCKED: 未完了の T4 に依存している T3 を完了させる
select throws_ok(
  $$update public.tasks
    set completed_at = now()
    where id = 'a0000000-0000-0000-0000-000000000003'$$,
  'ET004'::char(5),
  null,
  'ET004 TASK_BLOCKED is raised when completing a task with an incomplete dependency'
);

-- 5. ET005 DEPENDENCY_ALREADY_EXISTS: 既にある T4 -> T3 をもう一度張る
select throws_ok(
  $$select public.add_task_dependency(
      'a0000000-0000-0000-0000-000000000003',
      'a0000000-0000-0000-0000-000000000004')$$,
  'ET005'::char(5),
  null,
  'ET005 DEPENDENCY_ALREADY_EXISTS is raised for a duplicate dependency'
);

-- 6. ET006 INVALID_POSITION: 負の position を move_task に渡す
select throws_ok(
  $$select public.move_task(
      'a0000000-0000-0000-0000-000000000001',
      null,
      -1)$$,
  'ET006'::char(5),
  null,
  'ET006 INVALID_POSITION is raised for a negative position'
);

-- 7. ET007 INVALID_PARENT (move_task): 他ユーザーの task Z を親に指定する
select throws_ok(
  $$select public.move_task(
      'a0000000-0000-0000-0000-000000000001',
      'a0000000-0000-0000-0000-0000000000f1',
      0)$$,
  'ET007'::char(5),
  null,
  'ET007 INVALID_PARENT is raised by move_task for a parent owned by another user'
);

-- 8. ET007 INVALID_PARENT (reorder_tasks): sibling group と件数が合わない ID 列を渡す
--    root の sibling group は T1 / T3 / T4 の 3 件なので、1 件だけ渡すと拒否される。
select throws_ok(
  $$select public.reorder_tasks(
      null,
      array['a0000000-0000-0000-0000-000000000001']::uuid[])$$,
  'ET007'::char(5),
  null,
  'ET007 INVALID_PARENT is raised by reorder_tasks for a mismatched sibling list'
);

select * from finish();
rollback;
