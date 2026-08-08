# entodo Supabase マイグレーション設計書

対象リポジトリ: entodo
対象コミット: 1b82bda
作成日: 2026-08-08
生成者: Claude Code

本文書は `req.md` （Todo Application 詳細設計書）の記載を根拠とする。
本文中の `(req.md §NN)` はその節番号を指す。
`req.md` は本リポジトリ直下の `req.md:1` から参照できる。

本文書は `docs/db-design.md`・`docs/frontend-design.md`・`docs/auth-design.md` の姉妹文書である。
DB スキーマ・RLS・Trigger・RPC の設計内容そのものは `docs/db-design.md` に、フロントエンドのディレクトリ構成は `docs/frontend-design.md` に、認証・認可の詳細は `docs/auth-design.md` に委ねる。
本文書が扱うのは、それらの設計を Supabase CLI を用いてどう migration ファイル・seed data・pgTAP テストへ落とし込み、どのような開発ループと本番反映フローで運用するかという実行計画である。

本文書中、`req.md` に根拠を持つ記述は「確定事項」として断定で書く。
2026-08-08 にユーザーが確定した 3 点（migration の分割方針、seed data の元データ、pgTAP による DB テスト方針）も確定事項として扱う。
それ以外の記述で本設計書が新たに下す判断には「提案」と明記し、未確定であることを示す。

## 目次

- [1. サマリ](#1-サマリ)
- [2. Supabase CLI ワークフロー全体像](#2-supabase-cli-ワークフロー全体像)
- [3. ディレクトリ構成](#3-ディレクトリ構成)
- [4. config.toml の要点](#4-configtoml-の要点)
- [5. migration ファイル構成](#5-migration-ファイル構成)
- [6. seed data 設計](#6-seed-data-設計)
- [7. pgTAP テスト設計](#7-pgtap-テスト設計)
- [8. 型生成フロー](#8-型生成フロー)
- [9. 本番反映フロー](#9-本番反映フロー)
- [10. 未決事項](#10-未決事項)
- [11. 用語集](#11-用語集)

---

## 1. サマリ

entodo の DB スキーマ（`tasks` / `task_dependencies` / `app_tasks` View / Trigger / RPC / RLS / `next_auth` schema）は `docs/db-design.md` と `docs/auth-design.md` で確定している。
本文書はこれを Supabase CLI のローカル開発フローへ落とし込むための実行計画であり、次の 3 点を確定事項として前提に置く（2026-08-08 ユーザー確定）。

1. **migration は意味単位で数本に分割する**。1 本の init migration へ集約しない。
2. **seed data は UI モック検討で使ったサンプルデータをそのまま用いる**。状態パターン（依存連鎖・fan-in・期限切れ・今日期日・完了済み・blocked・論理削除済み）を網羅する。
3. **DB テストは pgTAP を用い、`supabase test db` で実行する**。

この前提のもと、本文書は次を設計する。

- `supabase/` 配下のディレクトリ構成と `config.toml` の要点（2〜4章）
- 6 本の migration ファイルへの分割案とその順序・境界理由（5章）
- seed data の具体的な内容と dev ユーザーの扱い（6章）
- `req.md` §74 が挙げる 7 シナリオを pgTAP テストへ対応づける表（7章）
- 型生成フローと本番反映フロー（8〜9章）
- 未決事項（10章）

フロントエンドのディレクトリ構成（`src/` 配下）は `docs/frontend-design.md` の対象であり、`supabase/` 配下とは独立したディレクトリツリーである（3章で述べる）。
UI/UX の詳細、Server Action の実装詳細は本文書の対象外とする。

---

## 2. Supabase CLI ワークフロー全体像

entodo は専用バックエンドサーバーを持たず、Next.js Server Actions から Supabase Data API へ直接アクセスする構成である(req.md §1, §71)。
ローカル開発およびスキーマ変更管理には Supabase CLI を用いる(req.md §74)。

### 2.1 各コマンドの役割

| コマンド | 役割 |
| --- | --- |
| `supabase init` | リポジトリに `supabase/` ディレクトリと既定の `config.toml` を生成する。entodo では最初の 1 回のみ実行する |
| `supabase start` | Docker 上にローカル Postgres・Supabase Data API（PostgREST）・Supabase Studio 等のスタックを起動する |
| `supabase stop` | 起動したローカルスタックを停止する |
| `supabase migration new <name>` | `supabase/migrations/` 配下に `<timestamp>_<name>.sql` という空の migration ファイルを生成する |
| `supabase db reset` | ローカル DB を破棄・再作成し、`supabase/migrations/` 配下の全ファイルをタイムスタンプ順に再生し、続けて `supabase/seed.sql` を適用する |
| `supabase db push` | `supabase link` 済みのリモート（hosted）プロジェクトへ、未適用の migration を適用する |
| `supabase gen types typescript --local` | ローカル DB の現在のスキーマから TypeScript の型定義を生成する |
| `supabase test db` | `supabase/tests/` 配下の pgTAP テストを、使い捨てのテスト用 DB に対して実行する |

`supabase db reset` は migration を「積み重ねる」コマンドではなく、常に全 migration をゼロから再生するコマンドである点に注意する。
これにより、migration ファイル群は常に「空の DB から現在のスキーマまでを一意に再現できる」状態を保つ必要がある。

### 2.2 日常の開発ループ

新しい migration を追加する際の開発ループを次に示す（提案。CLI の一般的な使い方を entodo の運用に当てはめたもの）。

```text
supabase migration new <意味を表す名前>
        ↓
supabase/migrations/<timestamp>_<name>.sql を編集
        ↓
supabase db reset
  （全 migration を再生 → seed.sql を適用）
        ↓
ローカル DB で動作確認
  （psql / Supabase Studio / Next.js dev server から Data API 経由）
        ↓
supabase test db
  （pgTAP。7章）
        ↓
supabase gen types typescript --local
  （src/lib/supabase/database.types.ts を再生成。8章）
        ↓
git commit
        ↓
（本番反映が必要な場合のみ）supabase db push
```

`supabase db reset` を開発ループの中心に置くことで、「ローカルで一度動いた状態」ではなく「migration ファイル一式を空の DB から再生した結果」を常に検証対象にできる。
これは、後から migration ファイルを直接書き換えて履歴の整合性を崩す事故を防ぐためにも重要である。

---

## 3. ディレクトリ構成

`supabase init` によって、リポジトリ直下に次のディレクトリ構成が作られる（提案。`config.toml` 以外はこれから作成する）。

```text
supabase/
  config.toml       # ローカルスタックの設定（4章）
  migrations/       # migration ファイル群（5章）
    <timestamp>_next_auth_schema.sql
    <timestamp>_tasks_and_dependencies.sql
    <timestamp>_app_tasks_view.sql
    <timestamp>_triggers.sql
    <timestamp>_rpc_functions.sql
    <timestamp>_rls_policies.sql
  seed.sql          # dev 専用 seed data（6章）
  tests/            # pgTAP テスト（7章）
    001_parent_cycle.test.sql
    002_dependency_cycle.test.sql
    003_blocked_completion.test.sql
    004_restore.test.sql
    005_cross_user_isolation.test.sql
    006_app_tasks_view.test.sql
```

`supabase/` はリポジトリ直下に置かれ、`docs/frontend-design.md` が定める `src/` 配下のアプリケーションコードのディレクトリツリーとは完全に独立している。
`src/lib/supabase/` に置かれる `database.types.ts` / `service-client.ts` / `app-client.ts` / `custom-jwt.ts`（`docs/frontend-design.md` 第4章）は、`supabase/` 配下の migration が定義した最終的なスキーマを消費する側であり、`supabase/` 自体には依存しない。
両者を繋ぐのは 8章で述べる型生成コマンドのみである。

---

## 4. config.toml の要点

`supabase init` が生成する `config.toml` に対して、entodo 固有の設定を加える点は次の 2 点である。

### 4.1 `[api]` の `schemas` への `next_auth` 追加

`@auth/supabase-adapter` は Supabase Data API（PostgREST）経由で `next_auth` schema のテーブルを操作する。
Data API は既定では `public`（および `graphql_public`）のみを exposed schema とするため、`next_auth` を追加しない限り Adapter からの読み書きが失敗する(`docs/auth-design.md` 第4.3節)。

`docs/auth-design.md` 第4.3節は、この設定箇所を「Supabase Dashboard の項目名、または `supabase/config.toml` 上の記述箇所は実装時に確認する」と未決事項に置いている。
ローカルスタックについては `config.toml` の `[api]` セクションが該当箇所であり、既定の `schemas` 配列（通常 `["public", "graphql_public"]`）へ `next_auth` を追加する（提案）。

```text
[api]
schemas = ["public", "graphql_public", "next_auth"]
```

hosted Supabase プロジェクト側で同等の設定（Dashboard 上の exposed schemas 設定）を行う必要がある点は、`docs/auth-design.md` 第10章の未決事項と重複するため、本文書では 10章で参照するに留める。

### 4.2 Supabase Auth（GoTrue）の扱い

Supabase Auth は認証主体として使用しない(req.md §2.3)。
認証は Auth.js + GitHub OAuth + `@auth/supabase-adapter` が担い、Auth.js のデータは `next_auth` schema に保存される(req.md §30, §31)。

ローカルスタックには既定で GoTrue（Supabase Auth を提供するコンポーネント。11章）が含まれる。
entodo ではこれを使わないため、次の 2 案のいずれかとする（提案。どちらを採るかは未確定）。

- **案 A: 無効化する**。`config.toml` の `[auth]` セクションに `enabled = false` を設定し、ローカルスタックから GoTrue コンテナを起動しない。用途のないコンポーネントを起動しないことで、ローカル環境の構成を実際の認証経路（Auth.js 経由）に一致させられる
- **案 B: 既定のまま放置する**。GoTrue は起動するが、Auth.js も RLS の `next_auth.uid()` もこれを参照しないため、動作上は無害である。将来 Supabase Auth を部分的に使う可能性を残せる

いずれの案でも、RLS Policy の `user_id = next_auth.uid()`(req.md §40) や RPC の `to authenticated` 権限(req.md §58) は GoTrue の発行する JWT ではなく、`docs/auth-design.md` 第5章が定める Custom JWT を前提にしている。
GoTrue の有効・無効は entodo の認証フローに影響しない。

### 4.3 その他

ポート番号（`api.port`、`db.port`、`studio.port` 等）は `supabase init` の既定値を維持する（提案）。
複数の Supabase プロジェクトをローカルで併用する予定がなく、ポート競合を避ける必要性が現時点でないためである。

---

## 5. migration ファイル構成

migration は意味単位で 6 本に分割する（2026-08-08 ユーザー確定の分割方針の具体化）。
各ファイル名は `supabase migration new <name>` が生成するタイムスタンプ prefix（`<timestamp>_`）に、次の意味名を続けたものとする。

| 順序 | ファイル名（意味部分） | 内容 | 根拠 |
| --- | --- | --- | --- |
| 1 | `next_auth_schema` | `next_auth` schema、`users` / `accounts` / `sessions` / `verification_tokens`、`next_auth.uid()` | req.md §31, §35 |
| 2 | `tasks_and_dependencies` | `tasks` / `task_dependencies` テーブルの DDL、インデックス | req.md §37, §38, §67 |
| 3 | `app_tasks_view` | `public.app_tasks` View（`effective_parent_id` / `sort_path` / `is_blocked`、`security_invoker`） | req.md §44〜46 |
| 4 | `triggers` | 親子 cycle Trigger、dependency cycle Trigger、blocked completion Trigger、`updated_at` 更新 Trigger | req.md §47〜50 |
| 5 | `rpc_functions` | RPC 5 種（`move_task` / `reorder_tasks` / `add_task_dependency` / `restore_task` / `permanently_delete_task`）、execute 権限の revoke/grant | req.md §52〜58 |
| 6 | `rls_policies` | `tasks` / `task_dependencies` の RLS 有効化と Policy | req.md §40〜43 |

この順序は依存関係の順序でもある。
`app_tasks` View は `tasks` テーブルを参照するため 2 の後でなければ作成できず、Trigger は `tasks` / `task_dependencies` の列変更を対象にするため同様に 2 の後、RPC は Trigger が保証する不変条件（cycle 禁止・blocked completion 禁止）に依拠する設計（req.md §53, §54）のため 4 の後に置く。

### 5.1 各ファイルの分割理由

**1. next_auth_schema**：`@auth/supabase-adapter` が要求する公式スキーマ定義を、entodo 自身の migration として管理する（提案）。
理由は次の 2 点である。

- ローカル再現性: `supabase db reset` だけでローカル環境に `next_auth` schema を含む DB 全体を再現できる。Adapter 側のインストールや Dashboard 操作に依存させない
- 履歴管理: `next_auth` schema に対する将来的な変更（Adapter のバージョンアップに伴うスキーマ差分など）を、entodo 自身の migration 履歴として `git log` から追跡できる

この migration の中身は `@auth/supabase-adapter` が要求する公式の schema 定義（`next_auth` schema 作成、4 テーブル、`next_auth.uid()` 関数）をそのまま用いる。
具体的なテーブル定義（カラム名・型）は Adapter のバージョンに紐づくため、実装時に Adapter が要求する定義を確認して migration へ反映する。

**2. tasks_and_dependencies**：`tasks` テーブルと `task_dependencies` テーブルの DDL は `req.md` から無改変で引用する。

`tasks` テーブルの DDL 冒頭は次の通りである（全文は req.md §37 参照）。

```sql
create table public.tasks (
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null,

  title text not null,
  description text not null default '',
  ...
);
```

`task_dependencies` テーブルの DDL 冒頭は次の通りである（全文は req.md §38 参照）。

```sql
create table public.task_dependencies (
  user_id uuid not null,
  task_id uuid not null,
  depends_on_task_id uuid not null,
  ...
);
```

このファイルにはさらに、req.md §67 が候補として挙げるインデックスのうち、既存の PRIMARY KEY / UNIQUE 制約と重複しないものを作成する。

| 候補インデックス | 採用 | 理由 |
| --- | --- | --- |
| `tasks(user_id, parent_id)` | 採用 | `tasks_parent_same_user_fkey` の参照元列だが、参照元列自体には自動でインデックスは張られないため必要 |
| `tasks(user_id, deleted_at)` | 採用 | `app_tasks` View の「削除済み除外」条件、ゴミ箱一覧の絞り込みに使う |
| `tasks(user_id, completed_at)` | 採用 | 完了/未完了での絞り込みに使う |
| `tasks(user_id, due_date)` | 採用 | 期日での絞り込み・並び替えに使う |
| `task_dependencies(user_id, task_id)` | **不採用** | PRIMARY KEY `(user_id, task_id, depends_on_task_id)` の先頭 2 列と一致し、既存の PK インデックスで代替できるため重複となる |
| `task_dependencies(user_id, depends_on_task_id)` | 採用 | PK のインデックスは `(user_id, task_id, ...)` 順であり、`depends_on_task_id` を条件に含めた検索（依存元の逆引き）には別途インデックスが要る |

`task_dependencies(user_id, task_id)` を不採用とした判断は、req.md §67 が明示する「実際にはPRIMARY KEYやUNIQUE制約で既に生成されるindexとの重複を確認した上で作成する」という指示（提案としての具体化）に基づく。

**3. app_tasks_view**：`public.app_tasks` View を単独の migration として切り出す。
理由は、View がテーブル本体の構造（1）とは異なる「読み取り専用の派生ロジック」というレイヤーであり、View の定義変更（例えば `sort_path` の算出方法の見直し）が将来単独で発生した際に、この migration だけを見ればレビューできるようにするためである。

**4. triggers**：Trigger を単独の migration として切り出す。
理由は、Trigger が「DBの不変条件」という 3 とは別の関心事であり(req.md §47, §51)、cycle 判定ロジックのような複雑な recursive CTE の変更を、テーブル構造や View の変更と混同せずレビューできるようにするためである。

**5. rpc_functions**：RPC を単独の migration として切り出す。
RPC は複数行更新を 1 トランザクションにまとめる層であり(req.md §51)、Trigger が保証する不変条件に依拠する（cycle 検出ロジックを重複させない、req.md §53）。
そのため Trigger（4）より後に置く。
execute 権限の revoke/grant（req.md §58）も同じ migration に含める。RPC 本体の定義と権限設定を別ファイルへ分離すると、「関数は存在するが権限が付与されていない」状態が migration 間で一時的に生じうるため、1 つの migration 内で完結させる。

**6. rls_policies**：RLS の有効化と Policy を最後に置く。

### 5.2 RLS を最後にする順序の意図

RLS を最後に配置する意図は、開発初期段階で `psql` や Supabase Studio から素の `tasks` / `task_dependencies` に対して動作確認を行いやすくする点にある（提案）。
RLS が未設定の間は、Custom JWT や `authenticated` ロールへの切り替えを用意しなくても、テーブル構造・View・Trigger・RPC の動作を確認できる。

ただし、これは「Trigger より先に RLS を有効化すると危険である」という意味ではない。
Trigger が保証する不変条件（cycle 禁止・blocked completion 禁止）は、RLS の有効・無効に関わらず常に評価される。
同様に、cross-user relation の禁止は複合 FK（`tasks_parent_same_user_fkey` 等、req.md §37, §38）が担っており、これも RLS とは独立に機能する(`docs/db-design.md` 第10.2章)。
RLS の順序は、あくまでローカル開発時の検証しやすさに関する運用上の判断であり、DB としての安全性は 1〜5 の migration だけで完結している。

`supabase db reset` で再生された直後の DB は 1〜6 すべてを適用済みの状態になるため、本番相当のスキーマとローカル検証時のスキーマが乖離することはない。
順序はあくまで migration ファイルという「変更履歴の見せ方」の話であり、最終状態には影響しない。

---

## 6. seed data 設計

seed data は `supabase/seed.sql` に定義し、`supabase db reset` のローカルフローでのみ適用する（2026-08-08 ユーザー確定を踏まえた設計）。
本番の hosted Supabase プロジェクトへは流さない。9章で述べる `supabase db push` は migration のみを対象とし、`seed.sql` を適用しない。

### 6.1 dev ユーザーの必要性

`tasks.user_id` は `next_auth.users(id)` への FK である(req.md §37, §32)。
そのため `tasks` へ seed データを投入するには、先に `next_auth.users` へ参照先となる行が存在している必要がある。

`next_auth.users` へ固定 UUID の dev ユーザーを 1 件挿入する（提案）。
具体的なカラム構成は 5.1節の migration 1（`next_auth_schema`）が採用する `@auth/supabase-adapter` 公式スキーマに従うが、少なくとも `id` と、`name` / `email` に相当する表示用のカラムへ値を入れる想定とする。

### 6.2 GitHub OAuth ログイン済みユーザーとの関係

ローカルで実際に GitHub OAuth ログインを行うと、`next_auth.users` にはログインした実ユーザーの行が別途作成される。
この実ユーザーの `id` は dev ユーザーの固定 UUID とは一致しないため、seed data（dev ユーザー所有）と実ログインユーザーのタスクは別ユーザーのデータとして扱われ、RLS 上も混ざらない(req.md §40)。

これに対する扱いは次の 2 案のいずれかとする（提案。どちらを採るかは未確定）。

- **案 A: dev ユーザーの割り切り**。GitHub OAuth ログインを行わず、Custom JWT の `sub` に dev ユーザーの固定 UUID を直接指定して Todo アプリ用の Supabase client を生成し、動作確認する。UI 開発・pgTAP 以外の手動確認を、実際の GitHub ログインフローを介さずに素早く行える
- **案 B: 実ログインユーザーへの付け替え**。ローカルで GitHub OAuth ログインを行った後、`psql` で `tasks.user_id` と `task_dependencies.user_id` を dev ユーザーの固定 UUID から実ログインユーザーの `id` へ一括更新する。ログインフローを含めた一気通貫の確認ができる

いずれの案も、`docs/auth-design.md` 第10章が未決事項として挙げる「ローカル Supabase 環境での認証確認手順（ローカル起動した Supabase に対して GitHub OAuth のコールバックをどう到達させるか）」と関連するため、最終的な採否はその検討と合わせて確定する。

### 6.3 サンプルデータ

サンプルデータは UI モック検討時に用いたデータをそのまま再現する（2026-08-08 ユーザー確定）。
元データは「Todoアプリ開発」（依存連鎖・fan-in を含む）、「家のこと」、単独タスク、ゴミ箱内 1 件から成る、状態パターンを網羅したセットである。

`due_date` / `completed_at` / `deleted_at` は `current_date` 基準の相対値で記述する（提案）。
理由は、これらの値をハードコードされた絶対日付（例えば `2026-08-08`）で記述すると、`supabase db reset` を実行した日によって「今日」「期限切れ」といった状態パターンが崩れてしまうためである。
相対値であれば、seed が何日に流されても、期限切れ・今日期日・将来期日というパターンが常に保たれる。

| タスク名 | 親 | position | due_date | completed_at | deleted_at | 依存 |
| --- | --- | --- | --- | --- | --- | --- |
| Todoアプリ開発 | (なし・ルート) | 0 | `current_date + 23` | - | - | - |
| DB設計 | Todoアプリ開発 | 0 | - | `now() - interval '2 days'` | - | - |
| API実装 | Todoアプリ開発 | 1 | `current_date`（今日） | - | - | DB設計 に依存 |
| Server Actions実装 | API実装 | 0 | - | - | - | - |
| RPC実装 | API実装 | 1 | - | - | - | - |
| UI実装 | Todoアプリ開発 | 2 | `current_date + 7` | - | - | API実装 に依存 |
| Vercelデプロイ | Todoアプリ開発 | 3 | - | - | - | UI実装, API実装 に依存（fan-in） |
| 家のこと | (なし・ルート) | 1 | - | - | - | - |
| 牛乳を買う | 家のこと | 0 | - | `now() - interval '1 day'` | - | - |
| 掃除機をかける | 家のこと | 1 | `current_date - 3`（期限切れ） | - | - | - |
| 確定申告の準備 | (なし・ルート) | 2 | `current_date + 53` | - | - | - |
| 旧デザイン検討 | (なし・ルート) | 3 | - | - | `now() - interval '14 days'` | - |

このセットは次の状態パターンを網羅する。

- **依存連鎖**：DB設計 → API実装 → UI実装 → Vercelデプロイ
- **fan-in**：Vercelデプロイ が UI実装 と API実装 の 2 件へ依存する
- **blocked**：UI実装（API実装が未完了のため blocked）、Vercelデプロイ（UI実装・API実装がともに未完了のため blocked）
- **blocked ではない未完了**：API実装（依存先の DB設計 が完了済みのため blocked が解除されている）
- **期限切れ**：掃除機をかける（`due_date` が過去日）
- **今日期日**：API実装（`due_date` が今日）
- **完了済み**：DB設計、牛乳を買う
- **論理削除済み（ゴミ箱）**：旧デザイン検討
- **親子関係の複数階層**：Todoアプリ開発 → API実装 → Server Actions実装 / RPC実装 の 3 階層

`確定申告の準備` は親を持たないルート単独タスクであり、依存関係も持たない。

### 6.4 固定 UUID を使う理由

各タスクおよび dev ユーザーの `id` には、ハードコードされた固定 UUID を用いる（提案）。
`gen_random_uuid()` の既定値に任せず明示的に UUID リテラルを指定する。

理由は、テスト・デバッグでの参照容易性である。
固定 UUID であれば、pgTAP テスト（7章）や手動での `psql` 確認から「Todoアプリ開発の直下にある API実装」を毎回同じリテラル値で指し示せる。
`gen_random_uuid()` に任せた場合、`supabase db reset` の都度 `id` が変わり、確認のたびに `title` から `id` を引き直す手間が発生する。

---

## 7. pgTAP テスト設計

DB テストには pgTAP を用い、`supabase test db` で実行する（2026-08-08 ユーザー確定）。
pgTAP は PostgreSQL の関数として実行される TAP（Test Anything Protocol、11章）準拠のテストフレームワークであり、SQL ファイルの中で `SELECT` 文としてテストケースを記述する。

### 7.1 supabase/tests/ の構成

`supabase test db` は `supabase/tests/` 配下の `*.sql` ファイルを、使い捨てのテスト用 DB に対して実行する。
このテスト用 DB は `supabase/migrations/` を全件適用した状態から作られるため、pgTAP テストは 5章で確定した 6 本の migration がすべて適用済みであることを前提にできる。
`seed.sql`（6章）はテスト用 DB には適用されないため、pgTAP テストはテストファイル自身の中で必要なテストデータを `INSERT` する。

### 7.2 req.md §74 の 7 シナリオとテストファイルの対応

req.md §74 が重点テスト項目として挙げる 7 シナリオを、次の 6 ファイルへ対応づける（提案）。

| # | req.md §74 のシナリオ | テストファイル | テストケース概要 |
| --- | --- | --- | --- |
| 1 | A→B→C に C→A を追加できない | `002_dependency_cycle.test.sql` | `task_dependencies` へ A→B、B→C を INSERT した後、C→A の INSERT が `TASK_DEPENDENCY_CYCLE` で拒否されることを確認する |
| 2 | Aが未完了ならAに依存するBを完了できない | `003_blocked_completion.test.sql` | A→B の依存を張った状態で、A が未完了のまま B の `completed_at` を更新しようとすると `TASK_BLOCKED` で拒否されることを確認する |
| 3 | dependency Aを削除するとBのblockedが解除される | `003_blocked_completion.test.sql` | 上記の状態から A→B の依存 edge を DELETE した後、`app_tasks` View 上の B の `is_blocked` が false になることを確認する |
| 4 | Aを復元するとdependencyが再び有効になる | `004_restore.test.sql` | A→B の依存が張られた状態で A を論理削除すると B の `is_blocked` が false になり、A を `restore_task` で復元すると再び true に戻ることを確認する |
| 5 | 別ユーザーのtaskをparentに設定できない | `005_cross_user_isolation.test.sql` | ユーザー甲のタスクの `parent_id` にユーザー乙のタスクの `id` を指定した INSERT/UPDATE が拒否されることを確認する |
| 6 | 別ユーザーのtaskへdependencyを張れない | `005_cross_user_isolation.test.sql` | ユーザー甲のタスクから、ユーザー乙のタスクへの `task_dependencies` の INSERT が拒否されることを確認する |
| 7 | 削除済みノードを含めてもcycleを生成できない | `001_parent_cycle.test.sql` / `002_dependency_cycle.test.sql` | 論理削除済みのノードを経路に含む親子関係・依存関係についても、cycle となる変更が拒否されることを確認する（req.md §25 が定める「cycle判定ではdeleted_atを考慮しない」の検証） |

`001_parent_cycle.test.sql` には、シナリオ 7 の親子関係側に加えて、自己参照禁止（`tasks_not_own_parent`、req.md §37）や単純な多階層 cycle（A→B→C→A）の拒否も含める（提案）。

5 と 6 について、これらは `docs/db-design.md` 第10.2章が述べる通り複合 FK（`tasks_parent_same_user_fkey`、`task_dependency_task_fkey`、`task_dependency_depends_on_fkey`）によって保証される制約である(req.md §39)。
複合 FK は RLS の有効・無効やテスト実行ロールに関わらず常に評価されるため、`005_cross_user_isolation.test.sql` はテスト実行ロールを切り替えずに（後述 7.3節の役割切替を伴わずに）実行できる。

### 7.3 RLS のテストにおける注意

`supabase test db` がテストを実行する際のロールは、既定では migration の適用や `INSERT` を自由に行える強い権限を持つ。
これは RLS を素通りする（RLS が影響しない）ロールであることが一般的であり、そのままでは「RLS Policy が他ユーザーの行を見せない」ことそのものを検証できない。

RLS Policy（`to authenticated`、`user_id = next_auth.uid()`、req.md §40〜43）の動作そのものを検証したい場合、pgTAP テスト内で次の 2 点を行う必要がある（概念レベル。詳細は未決事項として10章に置く）。

1. **ロールの切替**：`SET LOCAL ROLE authenticated;` 等によって、RLS の対象ロールへ切り替える
2. **JWT クレームの設定**：Supabase Data API が本来リクエスト毎に設定する JWT クレーム相当の情報（`docs/auth-design.md` 第5章の Custom JWT の `sub` / `role`）を、テストトランザクション内の設定値として再現し、`next_auth.uid()` がテスト対象のユーザー UUID を返すようにする

この 2 点目の具体的な設定方法（参照する設定値の名前、`next_auth.uid()` がどこからその値を読むか）は、5.1節で述べた `next_auth_schema` migration が採用する `@auth/supabase-adapter` 公式スキーマの実装に依存する。
本文書ではこれを未決事項（10章）とし、実装時に `next_auth.uid()` の定義を確認したうえで確定させる。

なお、7.2節で述べた通りシナリオ 5・6（cross-user relation の禁止）は複合 FK が担うため、この役割切替を必要としない。
役割切替が必要になるのは、RLS Policy の SELECT/INSERT/UPDATE/DELETE それぞれの条件（req.md §41〜43）を直接検証する追加テストを書く場合である。

### 7.4 提案: View の派生値検証テスト

req.md §74 が明示する 7 シナリオに加えて、`app_tasks` View（req.md §44〜46）が算出する 3 つの派生値についても検証する（提案）。

`006_app_tasks_view.test.sql` として、次を検証する。

- **effective_parent_id**：削除済み祖先を挟んだ場合に、最も近い未削除祖先が返ること。祖先が全て削除済みの場合に `NULL` が返ること(req.md §22)
- **sort_path**：削除済みノードを挟んでも、`position` を連結した配列がツリー順序を正しく表現すること(req.md §46)
- **is_blocked**：未完了かつ未削除の依存先が存在する場合に true、依存先が完了済みまたは削除済みの場合に false になること(req.md §12, §23)

これらは 3 章・5 章で述べた「派生状態を保存しない」という設計原則(req.md §75)の正しさを直接検証するテストであり、Trigger や RPC の単体テストとは別の観点として位置づける。

---

## 8. 型生成フロー

migration を変更した後は、必ず TypeScript 型を再生成する（提案。運用ルールとして明示する）。

```text
supabase db reset
        ↓
supabase gen types typescript --local
        ↓
src/lib/supabase/database.types.ts を上書き
```

生成先は `docs/frontend-design.md` 第4章が定める `src/lib/supabase/database.types.ts` であり、同章は「`supabase gen types typescript` 生成物。手編集禁止」と明記している。
`src/types/task.ts` はこの `database.types.ts` から導出するドメイン型 alias である（`docs/frontend-design.md` 第4章）。

したがって、migration を変更したにもかかわらず型生成を怠ると、`database.types.ts` が実際のスキーマと乖離し、`src/types/task.ts` 以下の型が古いスキーマを前提にしたまま残る。
このズレを防ぐため、5章・7章で述べた開発ループ（2.2節の図）には型生成のステップを明示的に組み込んでいる。

---

## 9. 本番反映フロー

V1 では `supabase link` + `supabase db push` による手動運用とし、CI は組まない（提案）。

```text
supabase link --project-ref <hosted プロジェクトの参照 ID>
        ↓
supabase db push
  （ローカルで確定した migration を hosted プロジェクトへ適用）
```

`supabase db push` は `supabase/migrations/` 配下の migration のみを対象とし、`supabase/seed.sql` は対象に含めない。
これにより、6章で述べた「seed data は dev 専用であり本番には流さない」という方針が、`db push` の対象範囲によって自然に担保される。

hosted プロジェクトの作成・`supabase link` に必要な認証情報の取得、および CI 化については、10章の未決事項に置く。

---

## 10. 未決事項

本文書は Supabase CLI ワークフロー、migration 構成、seed data、pgTAP テスト設計の大枠を定めるが、次の項目は実装時に確定させる。

- **hosted Supabase プロジェクトの作成・link**：`supabase link` に必要なプロジェクト作成手順、`project-ref` の管理方法は未確定とする
- **JWT secret の取得と env 設定**：`SUPABASE_JWT_SECRET` の取得方法・legacy JWT secret と新方式（非対称鍵）の関係については `docs/auth-design.md` 第10章が既に未決事項として挙げており、本文書ではそちらを参照する
- **`next_auth` schema の exposed schemas 設定（hosted 側）**：4.1節で述べたローカル `config.toml` の設定に対応する hosted 側の設定手順は、`docs/auth-design.md` 第10章の未決事項と重複するためそちらを参照する
- **pgTAP での RLS テスト実装詳細**：7.3節で述べた「ロール切替」「JWT クレーム相当の設定」の具体的な SQL 文（設定する値の名前、`next_auth.uid()` が参照する実装）は、`next_auth_schema` migration（5.1節）が採用する Adapter 公式スキーマの実装を確認したうえで確定させる
- **CI/CD 化**：9章で述べた手動 `supabase db push` 運用を、将来 CI 経由の自動反映へ移行するかどうかは未確定とする。移行する場合、pgTAP テスト（7章）を CI のゲートに含めるかどうかも合わせて検討する
- **backup 方針**：hosted Supabase プロジェクトのバックアップ取得・復元方針は未確定とする
- **seed data の dev ユーザー運用**：6.2節で挙げた案A（dev ユーザーの割り切り）と案B（実ログインユーザーへの付け替え）のどちらを採るかは、`docs/auth-design.md` 第10章の「ローカル Supabase 環境での認証確認手順」の検討と合わせて確定する

---

## 11. 用語集

**migration**：DB スキーマに対する変更を、適用順序が一意に定まる SQL ファイルの集合として管理する仕組み。entodo では `supabase/migrations/` 配下に置き、`supabase db reset` / `supabase db push` によって適用する。

**seed**：`supabase/seed.sql` に定義する、ローカル開発専用の初期データ。`supabase db reset` の実行時にのみ適用され、本番の hosted プロジェクトには流さない（6章）。

**pgTAP**：PostgreSQL の拡張機能として提供される、TAP 準拠の DB テストフレームワーク。SQL 関数としてテストケースを記述し、`SELECT` 文の実行結果としてテスト結果を出力する（7章）。

**TAP（Test Anything Protocol）**：テスト結果をプログラミング言語非依存の単純なテキスト形式で出力するためのプロトコル。pgTAP はこの形式でテスト結果を出力する。

**`supabase db reset`**：ローカル DB を破棄・再作成し、`supabase/migrations/` 配下の全 migration をタイムスタンプ順に再生したうえで `supabase/seed.sql` を適用する CLI コマンド（2章）。

**`supabase db push`**：`supabase link` 済みの hosted プロジェクトへ、未適用の migration を適用する CLI コマンド。`seed.sql` は対象に含めない（9章）。

**`supabase test db`**：`supabase/tests/` 配下の pgTAP テストを、使い捨てのテスト用 DB に対して実行する CLI コマンド（7章）。

**config.toml**：`supabase init` が生成する、ローカルスタックの設定ファイル。`[api]` セクションの `schemas` に `next_auth` を追加する等、entodo 固有の設定を加える（4章）。

**GoTrue**：Supabase Auth を提供するコンポーネント。entodo では認証主体として使用せず(req.md §2.3)、ローカルスタックでは無効化するか、既定のまま放置するかを未確定の提案として扱う（4.2節）。

**Data API（PostgREST）**：Supabase が PostgreSQL の前段に提供する REST API 層。`@auth/supabase-adapter` や Todo アプリの Server Action は、いずれもこの Data API 経由で PostgreSQL へアクセスする(`docs/auth-design.md` 第4.3節)。

**`next_auth.uid()`**：Custom JWT の `sub` クレームから Auth.js user UUID を解決する、`@auth/supabase-adapter` が提供する SQL 関数(req.md §35)。RLS Policy の基本条件 `user_id = next_auth.uid()` の根拠になる(req.md §40)。

**Custom JWT**：Next.js Server Action から Supabase Data API へアクセスする際に発行する短命 JWT。詳細は `docs/auth-design.md` 第5章。

**effective_parent_id / sort_path / is_blocked**：`app_tasks` View が算出する派生値。テーブルには保存しない(req.md §22, §46, §12, §75)。詳細は `docs/db-design.md` 第7〜9章。

---

対象リポジトリ: entodo
対象コミット: 1b82bda
作成日: 2026-08-08
生成者: Claude Code
