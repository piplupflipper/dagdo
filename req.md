# Todo Application 詳細設計書

## 1. 概要

個人利用を主目的とした、シンプルなWebベースのTodoアプリケーションを構築する。

通常のTodo管理に加えて、以下の2種類のタスク間関係を扱えることを特徴とする。

* 親子関係
* 前後・依存関係

フロントエンドおよびアプリケーションサーバーにはNext.jsを使用し、Vercelへデプロイする。

データベースにはSupabase PostgreSQLを使用する。

専用APIサービスは構築せず、Next.js Server ActionsからSupabaseへアクセスする。

---

# 2. 技術構成

## 2.1 アプリケーション

* Next.js
* TypeScript
* Server Actions
* Vercel

## 2.2 データベース

* Supabase
* PostgreSQL
* Supabase Data API
* PostgreSQL RLS
* PostgreSQL View
* PostgreSQL Trigger
* PostgreSQL Function / Supabase RPC

## 2.3 認証

* Auth.js
* GitHub OAuth
* `@auth/supabase-adapter`
* Auth.jsのデータはSupabase PostgreSQLの`next_auth` schemaに保存

Supabase Authは認証主体として使用しない。

---

# 3. 基本方針

## 3.1 利用者

主用途は個人利用とする。

ただしGitHub OAuthログイン後に特定のGitHubアカウントだけを許可するallowlistは設けない。

複数ユーザーが利用した場合にもデータが混在しないよう、ユーザー単位で完全に分離する。

そのため、

* RLS
* `user_id`付きの外部キー制約

の両方でユーザー間の分離を保証する。

---

# 4. タスク仕様

タスクは以下の情報を持つ。

| 項目           | 必須  | 説明                   |
| ------------ | --- | -------------------- |
| id           | Yes | UUID                 |
| user_id      | Yes | 所有ユーザー               |
| title        | Yes | タイトル                 |
| description  | Yes | Markdown対応。空文字可      |
| parent_id    | No  | 親タスク                 |
| position     | Yes | actual sibling内での並び順 |
| due_date     | No  | 期日。日付のみ              |
| completed_at | No  | 完了日時                 |
| deleted_at   | No  | 論理削除日時               |
| created_at   | Yes | 作成日時                 |
| updated_at   | Yes | 更新日時                 |

完了状態専用のbooleanカラムは持たない。

```text
completed_at IS NULL
→ 未完了

completed_at IS NOT NULL
→ 完了
```

---

# 5. タスク状態

DBに保存する状態は主に以下で表現する。

```text
未完了
completed_at IS NULL
deleted_at IS NULL

完了
completed_at IS NOT NULL
deleted_at IS NULL

削除済み
deleted_at IS NOT NULL
```

`blocked`はDBに状態として保存しない。

依存関係から動的に算出する。

---

# 6. 期日

期日は日時ではなく日付のみ扱う。

PostgreSQLでは以下とする。

```sql
due_date date
```

未指定を許容する。

```sql
due_date IS NULL
```

アプリケーションの基準タイムゾーンは以下とする。

```text
Asia/Tokyo
```

`due_date`そのものはタイムゾーン非依存だが、

* 今日
* 期限切れ
* completed_at表示
* created_at表示

などの判定・表示ではAsia/Tokyoを基準とする。

---

# 7. description

`description`はMarkdownとして扱う。

DBにはMarkdownのソース文字列を保存する。

例:

```md
APIについて

- Server Actionを使う
- RLSを確認する

参考:
https://example.com
```

リッチテキスト形式などはV1では採用しない。

---

# 8. 親子関係

1タスクにつき親は最大1つとする。

```text
Project A
├─ Task A
├─ Task B
│  └─ Task C
└─ Task D
```

複数階層を許可する。

親子関係はforest構造とし、循環は禁止する。

以下は禁止。

```text
A
└─ B
   └─ C
      └─ A
```

また、自分自身を親にすることも禁止する。

```text
A.parent_id = A.id
```

---

# 9. 親タスクと子タスクの完了

親と子の完了状態は独立とする。

子タスクがすべて完了しても親タスクを自動完了しない。

また、未完了の子タスクが存在していても親タスクを完了可能とする。

例:

```text
☑ Project A
  ☑ Task A
  □ Task B
```

この状態を許容する。

---

# 10. 依存関係

タスク間に前後・依存関係を設定できる。

1タスクが複数タスクへ依存可能。

また1タスクを複数タスクが依存可能。

例:

```text
A ─┐
   ├→ C
B ─┘
```

この場合、

```text
C depends on A
C depends on B
```

となる。

依存関係はDAG（Directed Acyclic Graph）とする。

以下は禁止。

```text
A → B → C → A
```

自分自身への依存も禁止する。

---

# 11. 親子関係と依存関係の独立性

親子関係と依存関係は完全に独立した概念とする。

例えば、

```text
Project
├─ DB設計
├─ API実装
└─ UI実装
```

という親子関係とは別に、

```text
DB設計 → API実装 → UI実装
```

という依存関係を設定できる。

`parent_id`から依存関係を推論しない。

逆も同様とする。

---

# 12. blocked

未完了タスクについて、未完了かつ未削除の依存先が1件以上存在する場合にblockedとする。

概念的には以下。

```text
is_blocked =
    completed_at IS NULL
    AND
    未完了かつ未削除のdependencyが存在する
```

例:

```text
□ A

🔒 B
   depends on A
```

Aが完了するとBのblocked状態が解除される。

---

# 13. blockedタスクの完了

blocked中の未完了タスクを完了することは禁止する。

DBレベルで保証する。

```text
A → B

A = todo
B = todo

B.complete()
→ TASK_BLOCKED
```

---

# 14. 完了済みタスクの再オープン

完了済みタスクを未完了へ戻せる。

```text
completed_at = NULL
```

にする。

例えば、

```text
A → B
```

でA/Bがともに完了している状態からAだけを再オープンしても、Bを自動的に再オープンしない。

```text
A = todo
B = done
```

という状態を許容する。

依存関係は、

> 未完了タスクをこれから完了してよいか

を制約するものであり、過去の完了実績を巻き戻すものではない。

`is_blocked`は未完了タスクについてのみ意味を持つ。

---

# 15. 完了済みタスクの編集

完了後も以下をすべて編集可能とする。

* title
* description
* due_date
* parent
* position
* dependency

---

# 16. 手動並び替え

タスクの手動並び替えを許可する。

`position integer`を使用する。

```text
A position=0
B position=1
C position=2
```

V1ではFractional IndexingやLexoRankは使用しない。

並び替え時に対象sibling groupのpositionを、

```text
0
1
2
3
...
```

と振り直す。

Todoアプリの規模を考慮し、この方式で十分と判断する。

---

# 17. positionの意味

`position`は同一のactual parentを持つタスク間の順序を意味する。

```text
parent_id = X
```

が同じタスク同士でpositionを比較する。

ルートタスクは、

```text
parent_id IS NULL
```

を同じsibling groupとして扱う。

依存関係の順序とは完全に独立する。

---

# 18. reorderとreparent

単純な並び替えと親変更は意味的に分離する。

## reorder

同じactual parentの中で順番だけ変更する。

```text
parent_id
→ 変更しない

position
→ 変更
```

## reparent

別の親へ移動する。

```text
parent_id
→ 変更

position
→ 新しいsibling group内の値へ変更
```

---

# 19. 論理削除

通常の削除では物理削除しない。

```sql
deleted_at timestamptz
```

を使用する。

削除時:

```text
deleted_at = now()
```

削除済みタスクは通常画面・通常検索から除外する。

---

# 20. ゴミ箱

論理削除されたタスクはゴミ箱から復元可能とする。

自動削除期限は設けない。

ゴミ箱内のタスクは無期限保持する。

明示的に「完全に削除」を実行した場合のみ物理削除する。

---

# 21. 論理削除と親子関係

親タスクを論理削除しても子タスクの`parent_id`は変更しない。

例:

```text
A
├─ B
└─ C
```

Aを削除:

```text
A.deleted_at = now()

B.parent_id = A.id
C.parent_id = A.id
```

DB上では関係を保持する。

通常画面では削除済みノードを透明化して表示する。

---

# 22. effective_parent_id

削除済み祖先を飛ばし、最も近い未削除祖先をアプリ上の親として扱う。

これを、

```text
effective_parent_id
```

と呼ぶ。

例:

```text
A
└─ B deleted
   └─ C
```

DB:

```text
C.parent_id = B
```

View:

```text
C.effective_parent_id = A
```

さらに、

```text
A deleted
└─ B deleted
   └─ C
```

なら、

```text
C.effective_parent_id = NULL
```

とする。

`effective_parent_id`はDBカラムには保存せず、Viewで算出する。

---

# 23. 論理削除と依存関係

タスクを論理削除しても`task_dependencies`レコードは削除しない。

例:

```text
A → B
```

Aを論理削除しても依存edgeは保持する。

ただしblocked判定では削除済みタスクを無視する。

```text
A = deleted
B = todo

B.is_blocked = false
```

Aを復元すると元の依存関係も自動的に復活する。

---

# 24. 削除済みノードの統一ルール

親子関係・依存関係ともに以下の原則を使用する。

> 削除済みノードは通常操作上は透明化するが、構造情報自体は保持する。

通常表示:

```text
deleted node
→ 無視
```

blocked判定:

```text
deleted dependency
→ 無視
```

cycle判定:

```text
deleted node
→ 含める
```

復元:

```text
元の構造を利用
```

---

# 25. cycle判定と削除済みタスク

cycle判定では`deleted_at`を考慮せず、削除済みタスクを含むすべてのノードを見る。

これにより、

```text
論理削除中はcycleなし
↓
復元したらcycle
```

という状態を防ぐ。

---

# 26. 復元時のposition

復元時に`parent_id`は変更しない。

復元対象のactual parentを共有するsibling groupの末尾へ移動する。

例えば、

```text
A deleted
└─ B
```

であってもBのactual parentはAである。

表示上のeffective parentとは別に扱う。

---

# 27. 完全削除

「完全に削除」を実行した場合にのみタスクを物理削除する。

親タスクを完全削除する場合、子タスクは削除しない。

例えば、

```text
A
├─ B
└─ C
```

Aを完全削除すると、

```text
B.parent_id = NULL
C.parent_id = NULL
```

として残す。

Aに接続していたdependency edgeは物理削除する。

---

# 28. 検索

V1では以下を対象とした単純な部分一致検索とする。

* title
* description

高度な全文検索はV1では採用しない。

通常検索では削除済みタスクを除外する。

完了済みタスクは検索対象に含める。

---

# 29. V1では実装しない機能

以下はV1の対象外とする。

* タグ
* プロジェクト専用エンティティ
* 優先度
* 通知
* 繰り返しタスク
* 添付ファイル
* 完了履歴
* 更新履歴
* アーカイブ専用機能

親子関係によってタスクのグルーピングを行う。

---

# 30. Auth.js

認証にはAuth.jsを使用する。

ProviderはGitHub OAuthとする。

```text
/login
  ↓
GitHub OAuth
  ↓
Auth.js callback
  ↓
Auth.js session
  ↓
Application
```

Auth.jsの永続化にはSupabase Adapterを使用する。

```text
@auth/supabase-adapter
```

---

# 31. Auth.js schema

Auth.jsの認証情報はSupabase PostgreSQLの、

```text
next_auth
```

schemaへ保存する。

主要テーブル:

```text
next_auth.users
next_auth.accounts
next_auth.sessions
next_auth.verification_tokens
```

TodoアプリのユーザーIDとして、

```text
next_auth.users.id
```

を使用する。

---

# 32. tasks.user_id

`tasks.user_id`は、

```text
next_auth.users.id
```

を参照する。

GitHub usernameやGitHub user IDをアプリケーション上の主キーとして直接利用しない。

概念的には、

```text
GitHub account
    ↓
next_auth.accounts

Auth.js user UUID
    ↓
next_auth.users.id
    ↓
tasks.user_id
```

となる。

---

# 33. Auth.jsとSupabase Data APIの認証分離

Auth.jsのsessionとSupabase Data API用JWTは別物とする。

```text
Auth.js Session

目的:
Next.js側でログインユーザーを識別する
```

```text
Supabase Custom JWT

目的:
PostgreSQL/RLSに
「誰としてDBアクセスしているか」
を伝える
```

GitHub access tokenをSupabaseへ直接渡さない。

---

# 34. Supabase用Custom JWT

Next.js Server ActionからSupabase Data APIへアクセスする際、短寿命Custom JWTを生成する。

JWTには少なくとも以下を含める。

```text
sub
role
exp
```

`sub`:

```text
Auth.js user UUID
```

`role`:

```text
authenticated
```

概念:

```text
Auth.js session.user.id
       ↓
Custom JWT
sub = session.user.id
role = authenticated
       ↓
supabase-js
       ↓
PostgreSQL
```

---

# 35. next_auth.uid()

PostgreSQL/RLS上ではAuth.js Adapter側で提供される、

```sql
next_auth.uid()
```

をユーザー識別に利用する。

JWTの`sub`からAuth.js user UUIDを取得する。

したがって、

```text
JWT.sub
=
next_auth.users.id
=
tasks.user_id
```

を成立させる。

---

# 36. Supabase Clientの分離

以下の2種類のSupabase clientを明確に分離する。

## Auth.js内部用

Auth.js Adapterが認証情報を管理するために使用。

サーバー専用のsecret keyを利用する。

```text
Auth.js
  ↓
Supabase Adapter
  ↓
next_auth schema
```

## Todoアプリ用

ユーザーとしてTodoデータへアクセスする。

```text
publishable key
+
Custom JWT
```

を利用する。

RLSを適用する。

Auth.js内部用のsecret keyをTodo操作に使用しない。

---

# 37. tasksテーブル

基本スキーマ:

```sql
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
```

---

# 38. task_dependenciesテーブル

```sql
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
```

---

# 39. ユーザー間の関係禁止

親子関係、依存関係ともに異なるユーザーのタスクを関連付けることを禁止する。

例えば、

```text
User A / Task 1
        ↓
User B / Task 2
```

は作成不能とする。

RLSだけでなく複合FKによってDBレベルでも保証する。

---

# 40. RLS

以下にRLSを有効化する。

```sql
alter table public.tasks
enable row level security;

alter table public.task_dependencies
enable row level security;
```

基本条件:

```sql
user_id = next_auth.uid()
```

---

# 41. tasks SELECT Policy

概念:

```sql
create policy tasks_select
on public.tasks
for select
to authenticated
using (
  user_id = next_auth.uid()
);
```

---

# 42. tasks INSERT Policy

```sql
create policy tasks_insert
on public.tasks
for insert
to authenticated
with check (
  user_id = next_auth.uid()
);
```

---

# 43. tasks UPDATE Policy

```sql
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
```

DELETEおよびdependenciesについても同様にユーザー所有権を保証する。

---

# 44. Application Read View

アプリケーションからの通常読み取りでは、可能な限りrawな`tasks`を直接使用しない。

以下のViewを用意する。

```text
public.app_tasks
```

想定フィールド:

```text
id
user_id

title
description

parent_id
effective_parent_id

position
sort_path

due_date
completed_at

is_blocked

created_at
updated_at
```

削除済みタスクは通常の`app_tasks`から除外する。

---

# 45. ViewとRLS

Viewは、

```sql
WITH (security_invoker = true)
```

を使用する。

概念:

```sql
create view public.app_tasks
with (security_invoker = true)
as
...
```

これによりView経由でも基底テーブルのRLSを適用する。

---

# 46. sort_path

削除済み祖先を透明化した場合でも元のtree上の順序を維持するため、View上に、

```text
sort_path
```

を派生値として用意する。

例:

```text
A position=0
├─ B deleted position=1
│  └─ C position=0
└─ D position=2
```

C:

```text
sort_path = {0, 1, 0}
```

D:

```text
sort_path = {0, 2}
```

PostgreSQLのinteger arrayの辞書順比較を利用し、

```sql
order by sort_path
```

でtree上の順序を取得できるようにする。

`sort_path`は実カラムとして保存しない。

---

# 47. Triggerの責務

Triggerは主としてDBの不変条件を保証する。

対象:

* 親子cycle禁止
* dependency cycle禁止
* blockedタスクの完了禁止
* updated_at更新

アプリケーションのユースケース処理そのものはTriggerへ過剰に持たせない。

---

# 48. 親子cycle Trigger

以下の場合に実行する。

```text
BEFORE INSERT
BEFORE UPDATE OF parent_id
```

`NEW.parent_id`からancestorをrecursive CTEで辿る。

途中で`NEW.id`へ到達した場合、

```text
TASK_PARENT_CYCLE
```

として拒否する。

deleted taskも探索対象とする。

---

# 49. Dependency Cycle Trigger

以下の場合に実行する。

```text
BEFORE INSERT
ON task_dependencies
```

新しい、

```text
task_id → depends_on_task_id
```

を追加した場合にcycleが発生するかrecursive CTEで判定する。

cycleになる場合、

```text
TASK_DEPENDENCY_CYCLE
```

として拒否する。

deleted taskも探索対象とする。

---

# 50. blocked Completion Trigger

以下の遷移を検知する。

```text
OLD.completed_at IS NULL
AND
NEW.completed_at IS NOT NULL
```

対象タスクについて、

```text
未完了
AND
未削除
```

のdependencyが存在する場合は更新を拒否する。

エラー:

```text
TASK_BLOCKED
```

---

# 51. DB Constraint / Trigger / RPCの責務

## Constraint

単純で常に成立すべき構造的ルールを保証する。

例:

* NOT NULL
* FK
* UNIQUE
* CHECK
* 同一ユーザー
* self dependency禁止

## Trigger

どの経路からDBを書き換えても破られてはいけない不変条件を保証する。

例:

* cycle禁止
* blocked completion禁止

## RPC

複数行更新や複数操作を1トランザクションとして扱う。

例:

* move
* reorder
* restore
* permanent delete

## Server Action

Webアプリケーションとしてのユースケース境界を担当する。

---

# 52. RPC方針

RPCは必要な複合操作に限定する。

V1では以下を想定する。

```text
move_task

reorder_tasks

add_task_dependency

restore_task

permanently_delete_task
```

基本的には、

```sql
SECURITY INVOKER
```

を使用する。

RLSを維持する。

---

# 53. add_task_dependency

概念:

```text
Server Action
   ↓
add_task_dependency RPC
   ↓
INSERT task_dependencies
   ↓
Trigger
   ↓
cycle検出
```

cycle検出ロジックをRPCとTriggerで重複させない。

不変条件はTrigger側を正とする。

---

# 54. move_task

入力イメージ:

```text
task_id
new_parent_id
new_position
```

1トランザクション内で以下を行う。

```text
旧sibling groupのposition整理

parent_id変更

新sibling groupのposition整理
```

親子cycleについてはTriggerが最終保証する。

---

# 55. reorder_tasks

入力イメージ:

```text
parent_id
ordered_task_ids[]
```

指定されたactual sibling groupについて、

```text
position = 0
position = 1
position = 2
...
```

と再採番する。

対象が同一ユーザー・同一actual parentであることを検証する。

---

# 56. restore_task

論理削除されたタスクを復元する。

```text
deleted_at = NULL
```

actual parentは変更しない。

actual sibling groupの末尾へpositionを移動する。

親・依存関係など、論理削除中に保持していた構造をそのまま再利用する。

---

# 57. permanently_delete_task

完全削除時は1トランザクションで以下を行う。

```text
子タスクのparent_idをNULLへ変更

子タスクのpositionをルート側で調整

関連dependency edgeを削除

対象タスクをDELETE
```

中途半端な状態を残さない。

---

# 58. RPC権限

RPC Functionについては実行権限を明示的に設定する。

概念:

```sql
revoke execute
on function ...
from public, anon;

grant execute
on function ...
to authenticated;
```

---

# 59. Server Actions

V1では以下を想定する。

```text
createTask

updateTask

completeTask

reopenTask

moveTask

reorderTasks

addDependency

removeDependency

softDeleteTask

restoreTask

permanentlyDeleteTask
```

---

# 60. createTask

単純なINSERTとして実装可能。

`user_id`をクライアント入力として信用しない。

Auth.js sessionから生成したCustom JWTによって、

```text
next_auth.uid()
```

と一致するuser_idだけをRLSで許可する。

必要であればServer Action側で明示的にsession user IDを設定する。

---

# 61. updateTask

以下の単純属性変更を担当する。

```text
title
description
due_date
```

構造変更は担当しない。

以下は専用Actionを使用する。

```text
parent_id
position
dependency
```

---

# 62. completeTask

対象タスクの、

```text
completed_at = now()
```

を実行する。

blockedかどうかの最終保証はDB Triggerが行う。

Server Action側で同じ判定を必須とはしない。

---

# 63. reopenTask

```text
completed_at = NULL
```

とする。

依存している他の完了済みタスクを変更しない。

---

# 64. softDeleteTask

基本操作:

```text
deleted_at = now()
```

親子関係・dependency edgeは変更しない。

---

# 65. removeDependency

単純なdependency edge削除であり、直接DELETEでもよい。

RPC必須とはしない。

---

# 66. DBエラー契約

DBからアプリへ返す代表的なエラーコードを固定する。

```text
TASK_NOT_FOUND

TASK_PARENT_CYCLE

TASK_DEPENDENCY_CYCLE

TASK_BLOCKED

DEPENDENCY_ALREADY_EXISTS

INVALID_POSITION

INVALID_PARENT
```

Next.js側では型として管理する。

例:

```ts
type TaskErrorCode =
  | "TASK_NOT_FOUND"
  | "TASK_PARENT_CYCLE"
  | "TASK_DEPENDENCY_CYCLE"
  | "TASK_BLOCKED"
  | "DEPENDENCY_ALREADY_EXISTS"
  | "INVALID_POSITION"
  | "INVALID_PARENT"
```

Server ActionでDBエラーをUI向けエラーへ変換する。

---

# 67. インデックス方針

V1では最低限以下を候補とする。

```text
tasks(user_id, parent_id)

tasks(user_id, deleted_at)

tasks(user_id, completed_at)

tasks(user_id, due_date)

task_dependencies(user_id, task_id)

task_dependencies(user_id, depends_on_task_id)
```

実際にはPRIMARY KEYやUNIQUE制約で既に生成されるindexとの重複を確認した上で作成する。

検索用`ILIKE '%query%'`についてはV1では高度なindex最適化を必須としない。

必要になった場合に`pg_trgm`等を検討する。

---

# 68. 一覧取得

V1ではページネーションを必須としない。

個人Todo用途を想定し、

```text
そのユーザーの未削除タスク全件
```

を取得可能とする。

数百〜数千件程度を想定する。

---

# 69. TaskとDependencyの取得

タスクとdependency情報は別々に取得する。

```text
app_tasks

task_dependencies
```

をそれぞれ取得し、必要に応じてアプリケーション側で関連付ける。

Task Viewにdependency arrayを埋め込む設計にはしない。

---

# 70. DB側の同時実行

cycle判定はrecursive CTE + Triggerで行う。

ただし複数トランザクションから同時にグラフ構造を変更する極端なケースでは、MVCC上それぞれの未commit変更が見えない問題があり得る。

このアプリでは競合頻度が低いため、V1で複雑なロック機構を必須とはしない。

必要になった場合、

```text
user_id単位のPostgreSQL advisory lock
```

などを検討する。

---

# 71. データの責務分割

全体の責務は次のように整理する。

```text
Browser
   ↓

Next.js UI
   ↓

Server Action
- session確認
- 入力validation
- DB/RPC呼び出し
- DBエラー変換
- revalidation
   ↓

Supabase Data API
   ↓

PostgreSQL RPC
- 複合操作
- transaction
   ↓

Constraint / RLS / Trigger
- 最終的なデータ整合性
   ↓

Tables
```

読み取りについては、

```text
Server Component / Server Action
   ↓
app_tasks View
   ↓
tasks / task_dependencies
```

とする。

---

# 72. UI/UX

UI/UXの詳細は現段階では確定しない。

以下は後で検討する。

* PC / スマートフォンのレイアウト
* Ready / Blocked / Done等の分類
* Tree表示方法
* Dependency表示方法
* タスク詳細画面
* ドラッグ&ドロップ
* Markdown編集UI
* 検索UI
* ゴミ箱UI
* GitHubログイン画面
* 完了済みタスクの表示方法

---

# 73. デプロイ

## Application

```text
Vercel
```

## Database

```text
Supabase
```

可能な限り両方の無料枠内で運用する。

専用バックエンドサーバーや別APIサービスは設けない。

---

# 74. 今後の詳細設計項目

DB・認証・Server Actionの大枠は確定済み。

実装開始前または実装と並行して以下を確定する。

## Supabase Migration

* Supabase CLIの利用
* migrationファイル構成
* local Supabase環境
* seed data

## DB Test

以下を重点的にテストする。

```text
A → B → C
に
C → A
を追加できない
```

```text
Aが未完了なら
Aに依存するBを完了できない
```

```text
dependency Aを削除すると
Bのblockedが解除される
```

```text
Aを復元すると
dependencyが再び有効になる
```

```text
別ユーザーのtaskをparentに設定できない
```

```text
別ユーザーのtaskへdependencyを張れない
```

```text
削除済みノードを含めてもcycleを生成できない
```

## Next.js

* ディレクトリ構成
* Server Action配置
* Supabase client生成処理
* Auth.js設定
* Custom JWT生成処理
* DB型生成
* Validation
* Cache / revalidate方針

## UI/UX

DB/API実装とは分離して後から詳細化する。

---

# 75. V1の設計原則

本アプリでは以下を設計原則とする。

### 1. DBを信頼できる状態にする

Server Actionを経由しなくても、

```text
cycle
cross-user relation
blocked completion
```

などの不正状態を可能な限りDBが拒否する。

### 2. 派生状態を保存しない

以下は保存しない。

```text
is_blocked
effective_parent_id
sort_path
```

元データから算出する。

### 3. 論理削除で構造を失わない

削除時に、

```text
parent-child
dependency
```

を可能な限り保持する。

### 4. Triggerにユースケースを書きすぎない

Triggerは不変条件の保証に限定する。

複数行操作はRPCで扱う。

### 5. Server Actionをアプリケーション境界にする

ブラウザからPostgreSQL Functionを直接意識させない。

```text
UI
→ Server Action
→ RPC / DB
```

を基本とする。

### 6. RLSとFKの双方でユーザーを分離する

認可だけに頼らず、データ構造自体でもcross-user relationを禁止する。

### 7. V1はシンプルに保つ

将来拡張可能性だけを理由に、

```text
タグ
プロジェクト
履歴
通知
繰り返し
複雑なランキングアルゴリズム
```

などを先行導入しない。

