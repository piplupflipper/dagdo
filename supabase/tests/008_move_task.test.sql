-- move_task (req.md §54, Issue #30)
--
-- 20260808000005_rpc_functions.sql の move_task が定める挙動を検証する:
--   - 同一 sibling group 内の移動で、旧 position を詰め・新 position を空ける ±1 シフトが
--     正しく働き、position が 0 から連番で連続したままであること
--   - 親を跨ぐ移動 (reparent) で、旧グループの隙間が詰まり、新グループに隙間が空くこと
--   - parent_id = NULL (root) への移動でも、`is not distinct from` により root グループが
--     sibling group として扱われること
--   - 負の position が INVALID_POSITION (SQLSTATE ET006) で拒否されること
--   - 他ユーザーの task を親に指定すると INVALID_PARENT (SQLSTATE ET007) で拒否されること
--
-- 本ファイルは 007 と同じく authenticated ロールへは切り替えず、request.jwt.claims のみを
-- 設定して実行する。move_task 自身が持つ `user_id = next_auth.uid()` の絞り込みが、RLS の
-- 有無に依らず他ユーザーの行を対象外にすることを確かめるためである。
-- RLS そのものの検証は 009_rls_isolation.test.sql が担う。
--
-- 固定データは使わず、このファイル専用の user / tasks を都度 INSERT する
-- (supabase test db は seed.sql を適用しないため、tests/ 側でフィクスチャを用意する)。
begin;
select plan(13);

insert into next_auth.users (id, name, email)
values
  ('80000000-0000-0000-0000-00000000000a', 'move owner', 'move-owner@test.local'),
  ('80000000-0000-0000-0000-00000000000b', 'move other', 'move-other@test.local');

-- owner の root: P1(0) / P2(1)
insert into public.tasks (id, user_id, title, position)
values
  ('80000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-00000000000a', 'P1', 0),
  ('80000000-0000-0000-0000-000000000002', '80000000-0000-0000-0000-00000000000a', 'P2', 1);

-- P1 の子: A(0) / B(1) / C(2)
insert into public.tasks (id, user_id, title, parent_id, position)
values
  ('80000000-0000-0000-0000-0000000000a1', '80000000-0000-0000-0000-00000000000a', 'A', '80000000-0000-0000-0000-000000000001', 0),
  ('80000000-0000-0000-0000-0000000000a2', '80000000-0000-0000-0000-00000000000a', 'B', '80000000-0000-0000-0000-000000000001', 1),
  ('80000000-0000-0000-0000-0000000000a3', '80000000-0000-0000-0000-00000000000a', 'C', '80000000-0000-0000-0000-000000000001', 2);

-- P2 の子: X(0) / Y(1)
insert into public.tasks (id, user_id, title, parent_id, position)
values
  ('80000000-0000-0000-0000-0000000000b1', '80000000-0000-0000-0000-00000000000a', 'X', '80000000-0000-0000-0000-000000000002', 0),
  ('80000000-0000-0000-0000-0000000000b2', '80000000-0000-0000-0000-00000000000a', 'Y', '80000000-0000-0000-0000-000000000002', 1);

-- 他ユーザーの root task Z (INVALID_PARENT の検証に使う)
insert into public.tasks (id, user_id, title, position)
values ('80000000-0000-0000-0000-0000000000f1', '80000000-0000-0000-0000-00000000000b', 'Z', 0);

-- move_task は SECURITY INVOKER であり、next_auth.uid() を解決するために
-- request.jwt.claims を set_config で明示的に設定する (docs/migration-design.md §7.3)。
set local request.jwt.claims = '{"sub":"80000000-0000-0000-0000-00000000000a","role":"authenticated"}';

--
-- ケース1: 同一 sibling group 内で末尾から先頭へ (上方向の移動)
--
-- C(2) を position 0 へ移す。新グループ側の +1 シフトが A(0) / B(1) を押し下げる。
--
-- 1. 移動が成功する
select lives_ok(
  $$select public.move_task(
      '80000000-0000-0000-0000-0000000000a3',
      '80000000-0000-0000-0000-000000000001',
      0)$$,
  'moving C to the head of its own sibling group succeeds'
);

-- 2. C が 0 に入り、A / B が +1 シフトして 0 から連番のまま保たれる
select is(
  (select array_agg(t.title || ':' || t.position order by t.position)
   from public.tasks t
   where t.user_id = '80000000-0000-0000-0000-00000000000a'
     and t.parent_id = '80000000-0000-0000-0000-000000000001'),
  array['C:0', 'A:1', 'B:2'],
  'siblings after C are shifted by +1 and positions stay contiguous from 0'
);

--
-- ケース2: 同一 sibling group 内で先頭から末尾へ (下方向の移動)
--
-- C(0) を position 2 へ戻す。旧グループ側の -1 シフトが A(1) / B(2) を引き上げたうえで
-- C が末尾に入るため、結果は元の A / B / C に戻る。
--
-- 3. 移動が成功する
select lives_ok(
  $$select public.move_task(
      '80000000-0000-0000-0000-0000000000a3',
      '80000000-0000-0000-0000-000000000001',
      2)$$,
  'moving C back to the tail of its own sibling group succeeds'
);

-- 4. A / B が -1 シフトし、C が 2 に入る
select is(
  (select array_agg(t.title || ':' || t.position order by t.position)
   from public.tasks t
   where t.user_id = '80000000-0000-0000-0000-00000000000a'
     and t.parent_id = '80000000-0000-0000-0000-000000000001'),
  array['A:0', 'B:1', 'C:2'],
  'siblings before C are shifted by -1 and C lands at the tail'
);

--
-- ケース3: reparent (P1 -> P2)
--
-- B(P1, 1) を P2 の position 1 へ移す。
-- 旧グループ P1 では C(2) が -1 され、新グループ P2 では Y(1) が +1 される。
--
-- 5. 親を跨ぐ移動が成功する
select lives_ok(
  $$select public.move_task(
      '80000000-0000-0000-0000-0000000000a2',
      '80000000-0000-0000-0000-000000000002',
      1)$$,
  'moving B from P1 to P2 succeeds'
);

-- 6. 旧グループ P1 の隙間が詰まり、0 から連番で連続する
select is(
  (select array_agg(t.title || ':' || t.position order by t.position)
   from public.tasks t
   where t.user_id = '80000000-0000-0000-0000-00000000000a'
     and t.parent_id = '80000000-0000-0000-0000-000000000001'),
  array['A:0', 'C:1'],
  'the old sibling group (P1) closes the gap left by B'
);

-- 7. 新グループ P2 に隙間が空き、B がそこへ入る
select is(
  (select array_agg(t.title || ':' || t.position order by t.position)
   from public.tasks t
   where t.user_id = '80000000-0000-0000-0000-00000000000a'
     and t.parent_id = '80000000-0000-0000-0000-000000000002'),
  array['X:0', 'B:1', 'Y:2'],
  'the new sibling group (P2) makes room for B at the requested position'
);

--
-- ケース4: root (parent_id = NULL) への移動
--
-- C(P1, 1) を root の position 1 へ移す。
-- root も `parent_id is not distinct from null` で 1 つの sibling group として扱われるため、
-- P2(1) が +1 される。
--
-- 8. root への移動が成功する
select lives_ok(
  $$select public.move_task(
      '80000000-0000-0000-0000-0000000000a3',
      null,
      1)$$,
  'moving C to the root group succeeds'
);

-- 9. root グループに隙間が空き、C が 1 に入る
select is(
  (select array_agg(t.title || ':' || t.position order by t.position)
   from public.tasks t
   where t.user_id = '80000000-0000-0000-0000-00000000000a'
     and t.parent_id is null),
  array['P1:0', 'C:1', 'P2:2'],
  'the root group makes room for C at the requested position'
);

-- 10. 旧グループ P1 には A だけが残る
select is(
  (select array_agg(t.title || ':' || t.position order by t.position)
   from public.tasks t
   where t.user_id = '80000000-0000-0000-0000-00000000000a'
     and t.parent_id = '80000000-0000-0000-0000-000000000001'),
  array['A:0'],
  'only A remains under P1 after C moved out'
);

--
-- ケース5: 不正な引数
--
-- 11. 負の position は INVALID_POSITION (ET006) で拒否される
select throws_like(
  $$select public.move_task(
      '80000000-0000-0000-0000-0000000000a1',
      '80000000-0000-0000-0000-000000000001',
      -1)$$,
  'INVALID_POSITION%',
  'a negative position is rejected with INVALID_POSITION'
);

-- 12. 拒否された移動は 1 行も書き換えない (position 検査が更新より先に走る)
select is(
  (select array_agg(t.title || ':' || t.position order by t.position)
   from public.tasks t
   where t.user_id = '80000000-0000-0000-0000-00000000000a'
     and t.parent_id is null),
  array['P1:0', 'C:1', 'P2:2'],
  'the rejected move leaves the root group untouched'
);

-- 13. 他ユーザー (move other) の task Z を親に指定すると INVALID_PARENT (ET007) で拒否される
select throws_like(
  $$select public.move_task(
      '80000000-0000-0000-0000-0000000000a1',
      '80000000-0000-0000-0000-0000000000f1',
      0)$$,
  'INVALID_PARENT%',
  'a parent owned by another user is rejected with INVALID_PARENT'
);

select * from finish();
rollback;
