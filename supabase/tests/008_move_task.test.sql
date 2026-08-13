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
-- 20260813000002_move_task_append_to_tail.sql (Issue #53) が加えた挙動も検証する:
--   - 論理削除済みの兄弟が残っている sibling group でも、p_new_position が論理削除済みを含む
--     実 position として解釈されること
--   - p_new_position = NULL が「論理削除済みも含めた actual sibling group の末尾へ追加」を表すこと。
--     同一 sibling group 内の末尾指定では、旧グループの隙間を詰めた後の末尾になること
--     (詰める前に求めると対象自身の分だけ 1 つ大きくなり、position の連番に穴が空く)
--
-- エラーはメッセージ前置詞 (throws_like) と SQLSTATE (throws_ok) の両方で固定する。
-- src/features/task/lib/map-db-error.ts は SQLSTATE を最優先で判定するため、メッセージだけを
-- 検査すると errcode の書き換えを検出できない。ET001〜ET007 の全体は
-- 010_error_contract.test.sql がまとめて固定する。
--
-- 本ファイルは 007 と同じく authenticated ロールへは切り替えず、request.jwt.claims のみを
-- 設定して実行する。move_task 自身が持つ `user_id = next_auth.uid()` の絞り込みが、RLS の
-- 有無に依らず他ユーザーの行を対象外にすることを確かめるためである。
-- RLS そのものの検証は 009_rls_isolation.test.sql が担う。
--
-- 固定データは使わず、このファイル専用の user / tasks を都度 INSERT する
-- (supabase test db は seed.sql を適用しないため、tests/ 側でフィクスチャを用意する)。
begin;
select plan(24);

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

-- 12. 同じ拒否が SQLSTATE ET006 で返る (map-db-error.ts が最優先で見る契約)
select throws_ok(
  $$select public.move_task(
      '80000000-0000-0000-0000-0000000000a1',
      '80000000-0000-0000-0000-000000000001',
      -1)$$,
  'ET006'::char(5),
  null,
  'a negative position is rejected with SQLSTATE ET006'
);

-- 13. 拒否された移動は 1 行も書き換えない (position 検査が更新より先に走る)
select is(
  (select array_agg(t.title || ':' || t.position order by t.position)
   from public.tasks t
   where t.user_id = '80000000-0000-0000-0000-00000000000a'
     and t.parent_id is null),
  array['P1:0', 'C:1', 'P2:2'],
  'the rejected move leaves the root group untouched'
);

-- 14. 他ユーザー (move other) の task Z を親に指定すると INVALID_PARENT (ET007) で拒否される
select throws_like(
  $$select public.move_task(
      '80000000-0000-0000-0000-0000000000a1',
      '80000000-0000-0000-0000-0000000000f1',
      0)$$,
  'INVALID_PARENT%',
  'a parent owned by another user is rejected with INVALID_PARENT'
);

-- 15. 同じ拒否が SQLSTATE ET007 で返る
select throws_ok(
  $$select public.move_task(
      '80000000-0000-0000-0000-0000000000a1',
      '80000000-0000-0000-0000-0000000000f1',
      0)$$,
  'ET007'::char(5),
  null,
  'a parent owned by another user is rejected with SQLSTATE ET007'
);

--
-- ケース6〜9: 論理削除済みの兄弟が残っている sibling group (Issue #53)
--
-- ここまでの状態は root: P1(0) / C(1) / P2(2)、P1 の子: A(0)、P2 の子: X(0) / B(1) / Y(2) である。
-- Issue #53 の例と同じ形の sibling group を追加する。
-- P3 の子 DX(0) / DY(1, 論理削除済み) / DZ(2) は、issue 本文の X / Y(論理削除済み) / Z に対応する
-- (P2 の子 X / Y とは別物である)。
-- app_tasks View は論理削除済みを除外するため (20260808000003_app_tasks_view.sql)、
-- クライアントに見えるのは DX と DZ の 2 件だけになる。
--
-- 検証は tasks テーブルを直接見て、論理削除済みの DY も数える
-- (011_position_gaps.test.sql と同じ方針)。
insert into public.tasks (id, user_id, title, position)
values ('80000000-0000-0000-0000-000000000003', '80000000-0000-0000-0000-00000000000a', 'P3', 3);

insert into public.tasks (id, user_id, title, parent_id, position, deleted_at)
values
  ('80000000-0000-0000-0000-0000000000d1', '80000000-0000-0000-0000-00000000000a', 'DX', '80000000-0000-0000-0000-000000000003', 0, null),
  ('80000000-0000-0000-0000-0000000000d2', '80000000-0000-0000-0000-00000000000a', 'DY', '80000000-0000-0000-0000-000000000003', 1, now()),
  ('80000000-0000-0000-0000-0000000000d3', '80000000-0000-0000-0000-00000000000a', 'DZ', '80000000-0000-0000-0000-000000000003', 2, null);

--
-- ケース6: p_new_position は論理削除済みを含む実 position である
--
-- B(P2, 1) を P3 の position 2 (= DZ の実 position) へ移す。DZ が +1 されて B がその手前に入る。
-- クライアントが可視の兄弟 (DX / DZ) の数 2 を「末尾」のつもりで渡すと、この結果になってしまう
-- のが Issue #53 の不具合である。RPC 側の解釈は実 position のまま変えない。
--
-- 16. 移動が成功する
select lives_ok(
  $$select public.move_task(
      '80000000-0000-0000-0000-0000000000a2',
      '80000000-0000-0000-0000-000000000003',
      2)$$,
  'moving B into a sibling group that contains a soft-deleted row succeeds'
);

-- 17. 論理削除済みの DY は動かず、DZ だけが +1 される (実 position としての解釈)
select is(
  (select array_agg(t.title || ':' || t.position order by t.position)
   from public.tasks t
   where t.user_id = '80000000-0000-0000-0000-00000000000a'
     and t.parent_id = '80000000-0000-0000-0000-000000000003'),
  array['DX:0', 'DY:1', 'B:2', 'DZ:3'],
  'p_new_position is interpreted as the actual position, counting the soft-deleted sibling'
);

-- 18. 旧グループ P2 の隙間が詰まる
select is(
  (select array_agg(t.title || ':' || t.position order by t.position)
   from public.tasks t
   where t.user_id = '80000000-0000-0000-0000-00000000000a'
     and t.parent_id = '80000000-0000-0000-0000-000000000002'),
  array['X:0', 'Y:1'],
  'the old sibling group (P2) closes the gap left by B'
);

--
-- ケース7: p_new_position = NULL は論理削除済みを含む末尾を指す
--
-- A(P1, 0) を P3 へ NULL (末尾) で移す。末尾は max(position) + 1 = 4 であり、
-- 可視の兄弟の数 (DX / B / DZ の 3 件) ではない。
--
-- 19. 末尾指定の移動が成功する
select lives_ok(
  $$select public.move_task(
      '80000000-0000-0000-0000-0000000000a1',
      '80000000-0000-0000-0000-000000000003',
      null)$$,
  'moving A to the tail of a sibling group with a null position succeeds'
);

-- 20. A は論理削除済みも含めた末尾 (4) に入り、既存の兄弟は 1 つも動かない
select is(
  (select array_agg(t.title || ':' || t.position order by t.position)
   from public.tasks t
   where t.user_id = '80000000-0000-0000-0000-00000000000a'
     and t.parent_id = '80000000-0000-0000-0000-000000000003'),
  array['DX:0', 'DY:1', 'B:2', 'DZ:3', 'A:4'],
  'a null position appends to the actual tail, counting the soft-deleted sibling'
);

--
-- ケース8: 同一 sibling group 内での NULL は、隙間を詰めた後の末尾へ入る
--
-- DX(P3, 0) を P3 へ NULL で移す。先に DY / B / DZ / A が -1 され、その後の末尾 4 へ DX が入る。
-- 詰める前に末尾を求めると 5 になり、position 4 が空いて連番が途切れる。
--
-- 21. 同一グループ内の末尾指定が成功する
select lives_ok(
  $$select public.move_task(
      '80000000-0000-0000-0000-0000000000d1',
      '80000000-0000-0000-0000-000000000003',
      null)$$,
  'moving DX to the tail of its own sibling group with a null position succeeds'
);

-- 22. 詰めた後の末尾に入り、position は 0 から連番で連続したままになる
select is(
  (select array_agg(t.title || ':' || t.position order by t.position)
   from public.tasks t
   where t.user_id = '80000000-0000-0000-0000-00000000000a'
     and t.parent_id = '80000000-0000-0000-0000-000000000003'),
  array['DY:0', 'B:1', 'DZ:2', 'A:3', 'DX:4'],
  'a null position within the same sibling group lands after the gap is closed, keeping positions contiguous'
);

--
-- ケース9: 子を持たない親への NULL は 0 になる
--
-- A(P3, 3) を C (子を持たない root task) へ NULL で移す。
--
-- 23. 子の居ない親への末尾指定が成功する
select lives_ok(
  $$select public.move_task(
      '80000000-0000-0000-0000-0000000000a1',
      '80000000-0000-0000-0000-0000000000a3',
      null)$$,
  'moving A under a childless parent with a null position succeeds'
);

-- 24. 最初の子は position 0 に入る
select is(
  (select array_agg(t.title || ':' || t.position order by t.position)
   from public.tasks t
   where t.user_id = '80000000-0000-0000-0000-00000000000a'
     and t.parent_id = '80000000-0000-0000-0000-0000000000a3'),
  array['A:0'],
  'a null position on an empty sibling group resolves to 0'
);

select * from finish();
rollback;
