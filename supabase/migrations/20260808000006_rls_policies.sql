-- RLS (Row Level Security)
--
-- req.md §40〜43。両テーブルで RLS を有効化し、user_id = next_auth.uid() を基本条件とする
-- select/insert/update/delete の各 Policy を定義する。
-- req.md §43 末尾「DELETEおよびdependenciesについても同様にユーザー所有権を保証する」に従い、
-- tasks の DELETE と task_dependencies 側の4種すべても同一条件で用意する。
--
-- RLS Policy は行フィルタであり、それだけでは authenticated ロールはテーブルへアクセスできない。
-- ローカル config.toml の `auto_expose_new_tables` が既定で無効 (新方式) であるため、
-- public schema 配下で作成したオブジェクトは Data API ロールへ自動 GRANT されない。
-- そのため RLS 有効化・Policy 定義に加えて、authenticated ロールへの基本権限を明示的に GRANT する。

alter table public.tasks
enable row level security;

alter table public.task_dependencies
enable row level security;

grant select, insert, update, delete on public.tasks to authenticated;
grant select, insert, update, delete on public.task_dependencies to authenticated;
grant select on public.app_tasks to authenticated;

--
-- tasks
--
create policy tasks_select
on public.tasks
for select
to authenticated
using (
  user_id = next_auth.uid()
);

create policy tasks_insert
on public.tasks
for insert
to authenticated
with check (
  user_id = next_auth.uid()
);

create policy tasks_update
on public.tasks
for update
to authenticated
using (
  user_id = next_auth.uid()
)
with check (
  user_id = next_auth.uid()
);

create policy tasks_delete
on public.tasks
for delete
to authenticated
using (
  user_id = next_auth.uid()
);

--
-- task_dependencies
--
create policy task_dependencies_select
on public.task_dependencies
for select
to authenticated
using (
  user_id = next_auth.uid()
);

create policy task_dependencies_insert
on public.task_dependencies
for insert
to authenticated
with check (
  user_id = next_auth.uid()
);

create policy task_dependencies_update
on public.task_dependencies
for update
to authenticated
using (
  user_id = next_auth.uid()
)
with check (
  user_id = next_auth.uid()
);

create policy task_dependencies_delete
on public.task_dependencies
for delete
to authenticated
using (
  user_id = next_auth.uid()
);
