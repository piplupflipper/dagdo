-- dev 専用 seed data (docs/migration-design.md §6)
--
-- supabase db reset のローカルフローでのみ適用され、supabase db push の対象には含まれない。
-- 元データは UI モック検討時に用いたサンプルをそのまま再現する (docs/migration-design.md §6.3)。
-- due_date / completed_at / deleted_at は current_date 基準の相対値で記述し、
-- 「今日」「期限切れ」等の状態パターンが実行日に関わらず保たれるようにする。
--
-- postgres ロール (RLS をバイパスする) で流れるが、Trigger は有効なままである。
-- ただし blocked completion Trigger は `completed_at` の UPDATE 遷移でのみ発火し、
-- 本 seed はすべて INSERT 時点で completed_at を確定値として与えるため発火しない。
--
-- 固定 UUID 一覧 (docs/migration-design.md §6.4):
--   dev user                 ffffffff-ffff-ffff-ffff-ffffffffffff
--   01 Todoアプリ開発         00000000-0000-0000-0000-000000000001
--   02 DB設計                 00000000-0000-0000-0000-000000000002
--   03 API実装                00000000-0000-0000-0000-000000000003
--   04 Server Actions実装     00000000-0000-0000-0000-000000000004
--   05 RPC実装                00000000-0000-0000-0000-000000000005
--   06 UI実装                 00000000-0000-0000-0000-000000000006
--   07 Vercelデプロイ         00000000-0000-0000-0000-000000000007
--   08 家のこと                00000000-0000-0000-0000-000000000008
--   09 牛乳を買う              00000000-0000-0000-0000-000000000009
--   10 掃除機をかける          00000000-0000-0000-0000-000000000010
--   11 確定申告の準備          00000000-0000-0000-0000-000000000011
--   12 旧デザイン検討          00000000-0000-0000-0000-000000000012

-- dev ユーザー (next_auth.users)
insert into next_auth.users (id, name, email)
values (
  'ffffffff-ffff-ffff-ffff-ffffffffffff',
  'dagdo dev user',
  'dev@dagdo.local'
);

-- tasks
-- 親を先に INSERT する (tasks_parent_same_user_fkey)。

-- ルート: Todoアプリ開発 (position 0, due_date = 未来)
insert into public.tasks (id, user_id, title, position, due_date)
values (
  '00000000-0000-0000-0000-000000000001',
  'ffffffff-ffff-ffff-ffff-ffffffffffff',
  'Todoアプリ開発',
  0,
  current_date + 23
);

-- Todoアプリ開発 の子: DB設計 (完了済み)
insert into public.tasks (id, user_id, title, parent_id, position, completed_at)
values (
  '00000000-0000-0000-0000-000000000002',
  'ffffffff-ffff-ffff-ffff-ffffffffffff',
  'DB設計',
  '00000000-0000-0000-0000-000000000001',
  0,
  now() - interval '2 days'
);

-- Todoアプリ開発 の子: API実装 (due_date = 今日、DB設計 に依存)
insert into public.tasks (id, user_id, title, parent_id, position, due_date)
values (
  '00000000-0000-0000-0000-000000000003',
  'ffffffff-ffff-ffff-ffff-ffffffffffff',
  'API実装',
  '00000000-0000-0000-0000-000000000001',
  1,
  current_date
);

-- API実装 の子: Server Actions実装
insert into public.tasks (id, user_id, title, parent_id, position)
values (
  '00000000-0000-0000-0000-000000000004',
  'ffffffff-ffff-ffff-ffff-ffffffffffff',
  'Server Actions実装',
  '00000000-0000-0000-0000-000000000003',
  0
);

-- API実装 の子: RPC実装
insert into public.tasks (id, user_id, title, parent_id, position)
values (
  '00000000-0000-0000-0000-000000000005',
  'ffffffff-ffff-ffff-ffff-ffffffffffff',
  'RPC実装',
  '00000000-0000-0000-0000-000000000003',
  1
);

-- Todoアプリ開発 の子: UI実装 (due_date = 1週間後、API実装 に依存。blocked)
insert into public.tasks (id, user_id, title, parent_id, position, due_date)
values (
  '00000000-0000-0000-0000-000000000006',
  'ffffffff-ffff-ffff-ffff-ffffffffffff',
  'UI実装',
  '00000000-0000-0000-0000-000000000001',
  2,
  current_date + 7
);

-- Todoアプリ開発 の子: Vercelデプロイ (UI実装・API実装 に fan-in 依存。blocked)
insert into public.tasks (id, user_id, title, parent_id, position)
values (
  '00000000-0000-0000-0000-000000000007',
  'ffffffff-ffff-ffff-ffff-ffffffffffff',
  'Vercelデプロイ',
  '00000000-0000-0000-0000-000000000001',
  3
);

-- ルート: 家のこと
insert into public.tasks (id, user_id, title, position)
values (
  '00000000-0000-0000-0000-000000000008',
  'ffffffff-ffff-ffff-ffff-ffffffffffff',
  '家のこと',
  1
);

-- 家のこと の子: 牛乳を買う (完了済み)
insert into public.tasks (id, user_id, title, parent_id, position, completed_at)
values (
  '00000000-0000-0000-0000-000000000009',
  'ffffffff-ffff-ffff-ffff-ffffffffffff',
  '牛乳を買う',
  '00000000-0000-0000-0000-000000000008',
  0,
  now() - interval '1 day'
);

-- 家のこと の子: 掃除機をかける (期限切れ)
insert into public.tasks (id, user_id, title, parent_id, position, due_date)
values (
  '00000000-0000-0000-0000-000000000010',
  'ffffffff-ffff-ffff-ffff-ffffffffffff',
  '掃除機をかける',
  '00000000-0000-0000-0000-000000000008',
  1,
  current_date - 3
);

-- ルート: 確定申告の準備 (単独タスク、依存なし)
insert into public.tasks (id, user_id, title, position, due_date)
values (
  '00000000-0000-0000-0000-000000000011',
  'ffffffff-ffff-ffff-ffff-ffffffffffff',
  '確定申告の準備',
  2,
  current_date + 53
);

-- ルート: 旧デザイン検討 (論理削除済み、ゴミ箱)
insert into public.tasks (id, user_id, title, position, deleted_at)
values (
  '00000000-0000-0000-0000-000000000012',
  'ffffffff-ffff-ffff-ffff-ffffffffffff',
  '旧デザイン検討',
  3,
  now() - interval '14 days'
);

-- task_dependencies (依存連鎖 + fan-in、4エッジ)
-- 依存連鎖: DB設計 → API実装 → UI実装 → Vercelデプロイ
-- fan-in  : Vercelデプロイ が UI実装 と API実装 の両方へ依存する

-- API実装 は DB設計 に依存する (DB設計は完了済みのため API実装 は blocked ではない)
insert into public.task_dependencies (user_id, task_id, depends_on_task_id)
values (
  'ffffffff-ffff-ffff-ffff-ffffffffffff',
  '00000000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-000000000002'
);

-- UI実装 は API実装 に依存する (API実装は未完了のため UI実装は blocked)
insert into public.task_dependencies (user_id, task_id, depends_on_task_id)
values (
  'ffffffff-ffff-ffff-ffff-ffffffffffff',
  '00000000-0000-0000-0000-000000000006',
  '00000000-0000-0000-0000-000000000003'
);

-- Vercelデプロイ は UI実装 に依存する (fan-in 1本目)
insert into public.task_dependencies (user_id, task_id, depends_on_task_id)
values (
  'ffffffff-ffff-ffff-ffff-ffffffffffff',
  '00000000-0000-0000-0000-000000000007',
  '00000000-0000-0000-0000-000000000006'
);

-- Vercelデプロイ は API実装 にも依存する (fan-in 2本目)
insert into public.task_dependencies (user_id, task_id, depends_on_task_id)
values (
  'ffffffff-ffff-ffff-ffff-ffffffffffff',
  '00000000-0000-0000-0000-000000000007',
  '00000000-0000-0000-0000-000000000003'
);
