-- tasks / task_dependencies テーブル
--
-- DDL は req.md §37 (tasksテーブル) / §38 (task_dependenciesテーブル) を無改変で引用する。
-- インデックスは docs/migration-design.md §5.1 の採用インデックス 5 本を追加する。

create table public.tasks (
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null,

  title text not null,
  description text not null default '',

  parent_id uuid,

  position integer not null default 0,

  due_date date,

  completed_at timestamptz,
  deleted_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint tasks_title_not_blank
    check (length(btrim(title)) > 0),

  constraint tasks_position_non_negative
    check (position >= 0),

  constraint tasks_not_own_parent
    check (parent_id is null or parent_id <> id),

  constraint tasks_user_fkey
    foreign key (user_id)
    references next_auth.users(id),

  constraint tasks_user_id_id_unique
    unique (user_id, id),

  constraint tasks_parent_same_user_fkey
    foreign key (user_id, parent_id)
    references public.tasks(user_id, id)
);

create table public.task_dependencies (
  user_id uuid not null,
  task_id uuid not null,
  depends_on_task_id uuid not null,

  created_at timestamptz not null default now(),

  primary key (
    user_id,
    task_id,
    depends_on_task_id
  ),

  constraint task_dependency_not_self
    check (task_id <> depends_on_task_id),

  constraint task_dependency_task_fkey
    foreign key (user_id, task_id)
    references public.tasks(user_id, id)
    on delete cascade,

  constraint task_dependency_depends_on_fkey
    foreign key (user_id, depends_on_task_id)
    references public.tasks(user_id, id)
    on delete cascade
);

--
-- インデックス (docs/migration-design.md §5.1)
--
-- tasks(user_id, parent_id): tasks_parent_same_user_fkey の参照元列。参照元列自体には
-- 自動でインデックスが張られないため必要。
create index tasks_user_id_parent_id_idx
  on public.tasks (user_id, parent_id);

-- tasks(user_id, deleted_at): app_tasks View の「削除済み除外」条件、ゴミ箱一覧の絞り込みに使う。
create index tasks_user_id_deleted_at_idx
  on public.tasks (user_id, deleted_at);

-- tasks(user_id, completed_at): 完了/未完了での絞り込みに使う。
create index tasks_user_id_completed_at_idx
  on public.tasks (user_id, completed_at);

-- tasks(user_id, due_date): 期日での絞り込み・並び替えに使う。
create index tasks_user_id_due_date_idx
  on public.tasks (user_id, due_date);

-- task_dependencies(user_id, task_id) は PRIMARY KEY (user_id, task_id, depends_on_task_id) の
-- 先頭2列と重複するため不採用。
--
-- task_dependencies(user_id, depends_on_task_id): PK のインデックスは (user_id, task_id, ...) 順
-- であり、depends_on_task_id を条件に含めた検索 (依存元の逆引き) には別途インデックスが要る。
create index task_dependencies_user_id_depends_on_task_id_idx
  on public.task_dependencies (user_id, depends_on_task_id);
