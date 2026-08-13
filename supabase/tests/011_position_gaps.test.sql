-- restore_task / permanently_delete_task と position の連番 (req.md §26, §27, §56, §57、Issue #23)
--
-- 20260813000001_close_position_gaps_on_restore_and_delete.sql が保つ不変条件を検証する:
--   - restore_task が復元対象を actual sibling group の末尾へ移し (req.md §26)、かつ対象が元々占めていた
--     position の穴を詰めて連番を保つこと
--   - permanently_delete_task が対象を DELETE した後、同じ兄弟グループの後続の position を詰めて
--     連番を保つこと。子を root へ reparent する req.md §57 の手順と併用しても連番が保たれること
--   - 両者の後で createTask と同じ末尾採番 (兄弟の件数を position にする、
--     src/features/task/actions/create-task.ts) を行っても、既存行と position が重複しないこと
--   - root 直下 (parent_id is null) と子グループの両方
--
-- 「同一 actual parent の兄弟グループの position は、論理削除済みの行も含めて 0 から連番で連続する」
-- という不変条件そのものは 20260808000007_reorder_tasks_exclude_deleted_siblings.sql のコメントが明文化する。
-- そのため検証は tasks テーブル (app_tasks View ではなく) を直接見て、論理削除済みの行も数える。
--
-- 004_restore.test.sql は restore_task が dependency と is_blocked を復活させることだけを見ており、
-- 末尾配置と position の連番は本ファイルが担う。
--
-- 本ファイルは 007 / 008 と同じく authenticated ロールへは切り替えず、request.jwt.claims のみを
-- 設定して実行する。RLS そのものの検証は 009_rls_isolation.test.sql が担う。
--
-- 固定データは使わず、このファイル専用の user / tasks を都度 INSERT する
-- (supabase test db は seed.sql を適用しないため、tests/ 側でフィクスチャを用意する)。
begin;
select plan(24);

insert into next_auth.users (id, name, email)
values
  ('b0000000-0000-0000-0000-00000000000a', 'gap owner', 'gap-owner@test.local'),
  ('b0000000-0000-0000-0000-00000000000b', 'gap single root', 'gap-single@test.local');

-- owner の root: RA(0) / RB(1, 論理削除済み) / RC(2) / RP(3) / RD(4, 論理削除済み)
insert into public.tasks (id, user_id, title, position, deleted_at)
values
  ('b0000000-0000-0000-0000-0000000000a1', 'b0000000-0000-0000-0000-00000000000a', 'RA', 0, null),
  ('b0000000-0000-0000-0000-0000000000a2', 'b0000000-0000-0000-0000-00000000000a', 'RB', 1, now()),
  ('b0000000-0000-0000-0000-0000000000a3', 'b0000000-0000-0000-0000-00000000000a', 'RC', 2, null),
  ('b0000000-0000-0000-0000-0000000000a4', 'b0000000-0000-0000-0000-00000000000a', 'RP', 3, null),
  ('b0000000-0000-0000-0000-0000000000a5', 'b0000000-0000-0000-0000-00000000000a', 'RD', 4, now());

-- RP の子: PA(0) / PB(1, 論理削除済み) / PC(2) / PD(3, 論理削除済み)
insert into public.tasks (id, user_id, title, parent_id, position, deleted_at)
values
  ('b0000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-00000000000a', 'PA', 'b0000000-0000-0000-0000-0000000000a4', 0, null),
  ('b0000000-0000-0000-0000-0000000000b2', 'b0000000-0000-0000-0000-00000000000a', 'PB', 'b0000000-0000-0000-0000-0000000000a4', 1, now()),
  ('b0000000-0000-0000-0000-0000000000b3', 'b0000000-0000-0000-0000-00000000000a', 'PC', 'b0000000-0000-0000-0000-0000000000a4', 2, null),
  ('b0000000-0000-0000-0000-0000000000b4', 'b0000000-0000-0000-0000-00000000000a', 'PD', 'b0000000-0000-0000-0000-0000000000a4', 3, now());

-- RC の子: CA(0) / CB(1)。RC の完全削除で root へ reparent される (req.md §27)
insert into public.tasks (id, user_id, title, parent_id, position)
values
  ('b0000000-0000-0000-0000-0000000000c1', 'b0000000-0000-0000-0000-00000000000a', 'CA', 'b0000000-0000-0000-0000-0000000000a3', 0),
  ('b0000000-0000-0000-0000-0000000000c2', 'b0000000-0000-0000-0000-00000000000a', 'CB', 'b0000000-0000-0000-0000-0000000000a3', 1);

-- 2 人目の root: Z(0) だけ。Z は子 ZX(0) / ZY(1) を持つ
insert into public.tasks (id, user_id, title, position)
values ('b0000000-0000-0000-0000-0000000000f1', 'b0000000-0000-0000-0000-00000000000b', 'Z', 0);

insert into public.tasks (id, user_id, title, parent_id, position)
values
  ('b0000000-0000-0000-0000-0000000000f2', 'b0000000-0000-0000-0000-00000000000b', 'ZX', 'b0000000-0000-0000-0000-0000000000f1', 0),
  ('b0000000-0000-0000-0000-0000000000f3', 'b0000000-0000-0000-0000-00000000000b', 'ZY', 'b0000000-0000-0000-0000-0000000000f1', 1);

-- restore_task / permanently_delete_task は SECURITY INVOKER であり、next_auth.uid() を解決するために
-- request.jwt.claims を set_config で明示的に設定する (docs/migration-design.md §7.3)。
set local request.jwt.claims = '{"sub":"b0000000-0000-0000-0000-00000000000a","role":"authenticated"}';

--
-- ケース1: restore_task で root グループの中間を復元する (Issue #23 の不具合 1)
--
-- RA(0) / RB(1, 削除済み) / RC(2) / RP(3) / RD(4, 削除済み) で RB を復元する。
-- RB が抜けた穴を詰めて RC -> 1 / RP -> 2 / RD -> 3 とし、RB を末尾 (4) へ移す。
--
-- 1. 復元が成功する
select lives_ok(
  $$select public.restore_task('b0000000-0000-0000-0000-0000000000a2')$$,
  'restore_task succeeds for a soft-deleted task in the middle of the root group'
);

-- 2. 復元した RB は root 兄弟グループの末尾へ移る (req.md §26)
select is(
  (select t.position from public.tasks t where t.id = 'b0000000-0000-0000-0000-0000000000a2'),
  (select max(t.position) from public.tasks t
   where t.user_id = 'b0000000-0000-0000-0000-00000000000a' and t.parent_id is null),
  'restored RB sits at the tail of its root sibling group (req.md §26)'
);

-- 3. RB が空けた穴が詰まり、削除済みの RD を含めて並びが 1 つ前へ寄る
select is(
  (select array_agg(t.title || ':' || t.position order by t.position)
   from public.tasks t
   where t.user_id = 'b0000000-0000-0000-0000-00000000000a' and t.parent_id is null),
  array['RA:0', 'RC:1', 'RP:2', 'RD:3', 'RB:4'],
  'the gap left by RB is closed and the soft-deleted RD shifts down with the rest'
);

-- 4. root グループの position は 0 から連番で連続する
select is(
  (select array_agg(t.position order by t.position)
   from public.tasks t
   where t.user_id = 'b0000000-0000-0000-0000-00000000000a' and t.parent_id is null),
  array[0, 1, 2, 3, 4],
  'root positions stay contiguous from 0 after restore_task'
);

--
-- ケース2: restore_task で子グループの中間を復元する
--
-- PA(0) / PB(1, 削除済み) / PC(2) / PD(3, 削除済み) で PB を復元する。
--
-- 5. 復元が成功する
select lives_ok(
  $$select public.restore_task('b0000000-0000-0000-0000-0000000000b2')$$,
  'restore_task succeeds for a soft-deleted task in the middle of a child group'
);

-- 6. PB は末尾へ移り、PC / PD が 1 つ前へ寄る
select is(
  (select array_agg(t.title || ':' || t.position order by t.position)
   from public.tasks t
   where t.parent_id = 'b0000000-0000-0000-0000-0000000000a4'),
  array['PA:0', 'PC:1', 'PD:2', 'PB:3'],
  'restored PB sits at the tail of its child group and the gap is closed (req.md §26)'
);

-- 7. 子グループの position は 0 から連番で連続する
select is(
  (select array_agg(t.position order by t.position)
   from public.tasks t
   where t.parent_id = 'b0000000-0000-0000-0000-0000000000a4'),
  array[0, 1, 2, 3],
  'child positions under RP stay contiguous from 0 after restore_task'
);

--
-- ケース3: 復元後の末尾採番が既存の position と重複しない (root)
--
-- createTask (src/features/task/actions/create-task.ts) は削除済みを含む兄弟の件数を
-- position として INSERT する。同じ採番をここで再現する。
insert into public.tasks (id, user_id, title, parent_id, position)
select 'b0000000-0000-0000-0000-0000000000d1', 'b0000000-0000-0000-0000-00000000000a', 'NR', null, count(*)
from public.tasks t
where t.user_id = 'b0000000-0000-0000-0000-00000000000a'
  and t.parent_id is null;

-- 8. 末尾採番した NR の position が既存のどの兄弟とも重複しない
select is(
  (select count(*) from (
     select t.position
     from public.tasks t
     where t.user_id = 'b0000000-0000-0000-0000-00000000000a' and t.parent_id is null
     group by t.position
     having count(*) > 1
   ) as duplicated),
  0::bigint,
  'sibling-count numbering after restore_task does not collide in the root group'
);

-- 9. NR を含めても root の position は 0 から連番で連続する
select is(
  (select array_agg(t.title || ':' || t.position order by t.position)
   from public.tasks t
   where t.user_id = 'b0000000-0000-0000-0000-00000000000a' and t.parent_id is null),
  array['RA:0', 'RC:1', 'RP:2', 'RD:3', 'RB:4', 'NR:5'],
  'NR is appended to the root tail and root positions stay contiguous'
);

--
-- ケース4: 復元後の末尾採番が既存の position と重複しない (子グループ)
--
insert into public.tasks (id, user_id, title, parent_id, position)
select 'b0000000-0000-0000-0000-0000000000d2', 'b0000000-0000-0000-0000-00000000000a', 'NP', 'b0000000-0000-0000-0000-0000000000a4', count(*)
from public.tasks t
where t.parent_id = 'b0000000-0000-0000-0000-0000000000a4';

-- 10. 末尾採番した NP の position が既存のどの兄弟とも重複しない
select is(
  (select count(*) from (
     select t.position
     from public.tasks t
     where t.parent_id = 'b0000000-0000-0000-0000-0000000000a4'
     group by t.position
     having count(*) > 1
   ) as duplicated),
  0::bigint,
  'sibling-count numbering after restore_task does not collide in a child group'
);

-- 11. NP を含めても子グループの position は 0 から連番で連続する
select is(
  (select array_agg(t.title || ':' || t.position order by t.position)
   from public.tasks t
   where t.parent_id = 'b0000000-0000-0000-0000-0000000000a4'),
  array['PA:0', 'PC:1', 'PD:2', 'PB:3', 'NP:4'],
  'NP is appended to the child tail and child positions stay contiguous'
);

--
-- ケース5: permanently_delete_task で子グループの中間を完全削除する (Issue #23 の不具合 2)
--
-- PA(0) / PC(1) / PD(2, 削除済み) / PB(3) / NP(4) で PC を完全削除する。
-- PC は子を持たないため、req.md §57 の reparent は起こらない。
--
-- 12. 完全削除が成功する
select lives_ok(
  $$select public.permanently_delete_task('b0000000-0000-0000-0000-0000000000b3')$$,
  'permanently_delete_task succeeds for a leaf in the middle of a child group'
);

-- 13. PC が抜けた穴が詰まり、削除済みの PD を含めて後続が 1 つ前へ寄る
select is(
  (select array_agg(t.title || ':' || t.position order by t.position)
   from public.tasks t
   where t.parent_id = 'b0000000-0000-0000-0000-0000000000a4'),
  array['PA:0', 'PD:1', 'PB:2', 'NP:3'],
  'the gap left by the permanently deleted PC is closed in the child group'
);

-- 14. 子グループの position は 0 から連番で連続する
select is(
  (select array_agg(t.position order by t.position)
   from public.tasks t
   where t.parent_id = 'b0000000-0000-0000-0000-0000000000a4'),
  array[0, 1, 2, 3],
  'child positions under RP stay contiguous from 0 after permanently_delete_task'
);

--
-- ケース6: permanently_delete_task で root 直下の中間を完全削除する (子の reparent と併用)
--
-- RA(0) / RC(1) / RP(2) / RD(3, 削除済み) / RB(4) / NR(5) で RC を完全削除する。
-- RC は子 CA(0) / CB(1) を持つため、req.md §57 に従って両者は parent_id = NULL へ移る。
-- 穴を詰めた後の root 末尾 (4 + 1 = 5) から順に採番されるため、CA -> 5 / CB -> 6 になる。
--
-- 15. 完全削除が成功する
select lives_ok(
  $$select public.permanently_delete_task('b0000000-0000-0000-0000-0000000000a3')$$,
  'permanently_delete_task succeeds for a root task that has children'
);

-- 16. RC が抜けた穴が詰まり、reparent された CA / CB が root の末尾へ続く
select is(
  (select array_agg(t.title || ':' || t.position order by t.position)
   from public.tasks t
   where t.user_id = 'b0000000-0000-0000-0000-00000000000a' and t.parent_id is null),
  array['RA:0', 'RP:1', 'RD:2', 'RB:3', 'NR:4', 'CA:5', 'CB:6'],
  'the gap left by RC is closed and its children are appended to the root tail (req.md §27)'
);

-- 17. root グループの position は 0 から連番で連続する
select is(
  (select array_agg(t.position order by t.position)
   from public.tasks t
   where t.user_id = 'b0000000-0000-0000-0000-00000000000a' and t.parent_id is null),
  array[0, 1, 2, 3, 4, 5, 6],
  'root positions stay contiguous from 0 after permanently_delete_task with reparenting'
);

--
-- ケース7: 完全削除後の末尾採番が既存の position と重複しない (root)
--
insert into public.tasks (id, user_id, title, parent_id, position)
select 'b0000000-0000-0000-0000-0000000000d3', 'b0000000-0000-0000-0000-00000000000a', 'NR2', null, count(*)
from public.tasks t
where t.user_id = 'b0000000-0000-0000-0000-00000000000a'
  and t.parent_id is null;

-- 18. 末尾採番した NR2 の position が既存のどの兄弟とも重複しない
select is(
  (select count(*) from (
     select t.position
     from public.tasks t
     where t.user_id = 'b0000000-0000-0000-0000-00000000000a' and t.parent_id is null
     group by t.position
     having count(*) > 1
   ) as duplicated),
  0::bigint,
  'sibling-count numbering after permanently_delete_task does not collide in the root group'
);

-- 19. NR2 を含めても root の position は 0 から連番で連続する
select is(
  (select array_agg(t.position order by t.position)
   from public.tasks t
   where t.user_id = 'b0000000-0000-0000-0000-00000000000a' and t.parent_id is null),
  array[0, 1, 2, 3, 4, 5, 6, 7],
  'root positions stay contiguous from 0 after appending NR2'
);

--
-- ケース8: undo (`u`) の Op 列 [restore, move] が削除前の並びへ戻る
--
-- src/features/outline/lib/invert-op.ts の `softDelete` 分岐は、逆操作を
-- `restore` + 削除前の parent_id/position への `move` の 2 Op 列として組み立てる。
-- restore_task が末尾へ移す仕様 (req.md §26) は変わっていないため、この 2 Op 列は
-- 詰め処理の追加後も削除前の状態へ戻る必要がある。
--
-- UA(0) / UB(1) / UC(2) の UB を論理削除 (softDeleteTask は deleted_at だけを更新し position を動かさない、
-- src/features/task/actions/soft-delete-task.ts) してから restore_task -> move_task を順に呼ぶ。
set local request.jwt.claims = '{"sub":"b0000000-0000-0000-0000-00000000000a","role":"authenticated"}';

insert into public.tasks (id, user_id, title, parent_id, position)
select 'b0000000-0000-0000-0000-0000000000e0', 'b0000000-0000-0000-0000-00000000000a', 'UP', null, count(*)
from public.tasks t
where t.user_id = 'b0000000-0000-0000-0000-00000000000a'
  and t.parent_id is null;

insert into public.tasks (id, user_id, title, parent_id, position)
values
  ('b0000000-0000-0000-0000-0000000000e1', 'b0000000-0000-0000-0000-00000000000a', 'UA', 'b0000000-0000-0000-0000-0000000000e0', 0),
  ('b0000000-0000-0000-0000-0000000000e2', 'b0000000-0000-0000-0000-00000000000a', 'UB', 'b0000000-0000-0000-0000-0000000000e0', 1),
  ('b0000000-0000-0000-0000-0000000000e3', 'b0000000-0000-0000-0000-00000000000a', 'UC', 'b0000000-0000-0000-0000-0000000000e0', 2);

update public.tasks
set deleted_at = now()
where id = 'b0000000-0000-0000-0000-0000000000e2';

-- 20. undo の 1 つ目の Op (restore)。UB は末尾 (2) へ移り、UC は 1 へ詰まる
select lives_ok(
  $$select public.restore_task('b0000000-0000-0000-0000-0000000000e2')$$,
  'the first undo op (restore_task) succeeds'
);

-- 21. undo の 2 つ目の Op (move)。削除前の parent_id / position (UP, 1) へ戻す
select lives_ok(
  $$select public.move_task(
      'b0000000-0000-0000-0000-0000000000e2',
      'b0000000-0000-0000-0000-0000000000e0',
      1)$$,
  'the second undo op (move_task back to the original position) succeeds'
);

-- 22. 2 Op を通すと削除前の UA(0) / UB(1) / UC(2) に完全に戻る
select is(
  (select array_agg(t.title || ':' || t.position order by t.position)
   from public.tasks t
   where t.parent_id = 'b0000000-0000-0000-0000-0000000000e0'),
  array['UA:0', 'UB:1', 'UC:2'],
  'undo (restore_task + move_task) restores the sibling group exactly as it was before the soft delete'
);

--
-- ケース9: root 直下が完全削除の対象 1 件だけで、その対象が子を持つ
--
-- 穴を詰める処理を子の reparent より後ろに置くと、子へ振った position を二重に詰めてしまい重複する。
-- 詰めてから root 末尾を求める順序 (20260813000001) であることを固定する。
set local request.jwt.claims = '{"sub":"b0000000-0000-0000-0000-00000000000b","role":"authenticated"}';

-- 23. 完全削除が成功する
select lives_ok(
  $$select public.permanently_delete_task('b0000000-0000-0000-0000-0000000000f1')$$,
  'permanently_delete_task succeeds for the only root task, which has children'
);

-- 24. reparent された ZX / ZY が root で 0 から連番になる
select is(
  (select array_agg(t.title || ':' || t.position order by t.position, t.title)
   from public.tasks t
   where t.user_id = 'b0000000-0000-0000-0000-00000000000b' and t.parent_id is null),
  array['ZX:0', 'ZY:1'],
  'children of the only root task are renumbered from 0 without colliding'
);

select * from finish();
rollback;
