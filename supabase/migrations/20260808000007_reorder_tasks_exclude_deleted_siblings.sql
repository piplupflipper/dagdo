-- reorder_tasks: 論理削除済みの兄弟を並べ替えの対象外にする (Issue #21)
--
-- 変更前 (20260808000005_rpc_functions.sql) の reorder_tasks は、兄弟グループの件数を
-- 論理削除済みも含めて数え、p_ordered_task_ids の配列長と一致しなければ INVALID_PARENT を投げていた。
-- 一方クライアントは app_tasks View 由来の ID 配列を渡すが、この View は論理削除済みを除外する
-- (20260808000003_app_tasks_view.sql)。
-- そのため論理削除済みの兄弟が 1 つでも残っていると配列長が必ず不足し、
-- そのグループ内の J / K と DnD が必ず INVALID_PARENT で失敗していた (Issue #21)。
--
-- 変更後は、論理削除されていない兄弟だけを並べ替えの対象とする。
-- 対象がいま占めている position の集合 (以下 slot) をそのまま使い回し、
-- p_ordered_task_ids の順に昇順の slot を割り当てる。論理削除済みの行の position は動かさない。
--
-- 例: A(0) / B(1, 削除済み) / C(2) の兄弟グループに [C, A] を渡すと、slot は {0, 2} なので
--     C -> 0、A -> 2 となり、結果は C(0) / B(1, 削除済み) / A(2) になる。
--     可視の並びは C, A で期待どおりであり、削除済みを含めた position は 0,1,2 のまま連続する。
--
-- 「同一 actual parent の兄弟グループの position は、論理削除済みの行も含めて 0 から連番で連続する」
-- という不変条件は、move_task の ±1 シフト (20260808000005_rpc_functions.sql)、
-- createTask の末尾採番 (src/features/task/actions/create-task.ts)、
-- computeCreatePosition (src/features/outline/lib/flatten-for-dnd.ts) が前提にしている。
-- 本方式は可視の兄弟どうしで position を入れ替えるだけで、兄弟グループ全体が占める position の集合を
-- 変えないため、この不変条件を保つ。
--
-- 論理削除済みの兄弟が 0 件のときは slot が {0, 1, ..., n-1} になるため、
-- req.md §55 の「position = 0, 1, 2, ... と再採番する」と結果が一致する。
create or replace function public.reorder_tasks(
  p_parent_id uuid,
  p_ordered_task_ids uuid[]
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := next_auth.uid();
  v_task_id uuid;
  v_index integer := 1;
  v_expected_count integer;
  v_matched_count integer;
  v_slots integer[];
begin
  -- 並べ替えの対象は、論理削除されていない兄弟のみ
  select count(*)
  into v_expected_count
  from public.tasks tk
  where tk.user_id = v_user_id
    and tk.parent_id is not distinct from p_parent_id
    and tk.deleted_at is null;

  -- 重複 ID を弾くため distinct で数える。
  -- 重複を許すと同じ行へ複数の slot を割り当てることになり、position の連番が壊れる
  select count(*)
  into v_matched_count
  from (select distinct ids.id from unnest(p_ordered_task_ids) as ids(id)) as uniq
  join public.tasks tk
    on tk.id = uniq.id
   and tk.user_id = v_user_id
   and tk.parent_id is not distinct from p_parent_id
   and tk.deleted_at is null;

  if p_ordered_task_ids is null
     or array_length(p_ordered_task_ids, 1) is distinct from v_expected_count
     or v_matched_count is distinct from v_expected_count
  then
    raise exception 'INVALID_PARENT: ordered_task_ids does not match the sibling group of parent %', p_parent_id
      using errcode = 'ET007';
  end if;

  -- 可視の兄弟がいま占めている position を昇順で集める。
  -- 論理削除済みの行の position はここに含まれないため、割り当て先にもならない
  select array_agg(tk.position order by tk.position)
  into v_slots
  from public.tasks tk
  where tk.user_id = v_user_id
    and tk.parent_id is not distinct from p_parent_id
    and tk.deleted_at is null;

  -- i 番目の ID へ i 番目の slot を割り当てる。
  -- 更新側で deleted_at を絞らないのは、上の検証で対象がすべて未削除の兄弟だと確定しており、
  -- ここで絞ると (検証後に他トランザクションが論理削除した場合に) slot が余って
  -- position の重複を生みうるためである
  foreach v_task_id in array p_ordered_task_ids
  loop
    update public.tasks
    set position = v_slots[v_index]
    where id = v_task_id
      and user_id = v_user_id;

    v_index := v_index + 1;
  end loop;
end;
$$;

-- create or replace function は pg_proc の行を置き換えるだけで ACL を引き継ぐため、
-- 20260808000005_rpc_functions.sql が設定した revoke/grant はこの migration の後も維持される。
-- ただし権限の状態をこのファイル単体で読み取れるようにするため、同じ内容を明示的に再設定する。
revoke execute on function public.reorder_tasks(uuid, uuid[]) from public, anon;
grant execute on function public.reorder_tasks(uuid, uuid[]) to authenticated;
