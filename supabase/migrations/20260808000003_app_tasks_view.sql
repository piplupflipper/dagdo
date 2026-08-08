-- public.app_tasks View
--
-- req.md §44〜46 が定める Application Read View。
-- 派生値 (effective_parent_id / sort_path / is_blocked) はテーブルに保存せず、この View で算出する
-- (req.md §75 原則2「派生状態を保存しない」)。
--
-- security_invoker = true により、View 経由でも基底テーブルの RLS を適用する (req.md §45)。
-- 削除済みタスク (tasks.deleted_at is not null) は最終 select で除外する (req.md §44)。

create view public.app_tasks
with (security_invoker = true)
as
with recursive
  -- sort_path: root から自身までの position を連結した配列。
  -- 削除済みの中間ノードも path に含める (req.md §46)。
  task_path as (
    select
      t.id,
      t.parent_id,
      array[t.position] as sort_path,
      array[t.id] as id_path
    from public.tasks t
    where t.parent_id is null

    union all

    select
      c.id,
      c.parent_id,
      tp.sort_path || c.position,
      tp.id_path || c.id
    from public.tasks c
    join task_path tp on c.parent_id = tp.id
    -- cycle 防止 (Trigger が cycle を禁止するため通常到達しないが、View 単体としての安全策)
    where not (c.id = any (tp.id_path))
  ),

  -- effective_parent_id: parent_id から辿った祖先のうち、最も近い未削除祖先。
  -- cycle判定とは異なり、削除済み祖先は透明化する (req.md §22, §24)。
  ancestor_walk as (
    select
      t.id as task_id,
      t.parent_id as ancestor_id,
      1 as depth
    from public.tasks t
    where t.parent_id is not null

    union all

    select
      aw.task_id,
      p.parent_id as ancestor_id,
      aw.depth + 1
    from ancestor_walk aw
    join public.tasks p on p.id = aw.ancestor_id
    where p.parent_id is not null
  ),
  ancestor_status as (
    select
      aw.task_id,
      aw.ancestor_id,
      aw.depth,
      a.deleted_at
    from ancestor_walk aw
    join public.tasks a on a.id = aw.ancestor_id
  ),
  effective_parent as (
    select distinct on (task_id)
      task_id,
      ancestor_id as effective_parent_id
    from ancestor_status
    where deleted_at is null
    order by task_id, depth
  ),

  -- is_blocked: 未完了かつ未削除の依存先が1件以上存在するタスク (req.md §12)。
  blocked_tasks as (
    select distinct td.task_id
    from public.task_dependencies td
    join public.tasks dep on dep.id = td.depends_on_task_id
    where dep.completed_at is null
      and dep.deleted_at is null
  )

select
  t.id,
  t.user_id,

  t.title,
  t.description,

  t.parent_id,
  ep.effective_parent_id,

  t.position,
  tp.sort_path,

  t.due_date,
  t.completed_at,

  (t.completed_at is null and bt.task_id is not null) as is_blocked,

  t.created_at,
  t.updated_at
from public.tasks t
join task_path tp on tp.id = t.id
left join effective_parent ep on ep.task_id = t.id
left join blocked_tasks bt on bt.task_id = t.id
where t.deleted_at is null;
