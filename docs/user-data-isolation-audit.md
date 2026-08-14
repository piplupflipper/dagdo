# dagdo ユーザーデータ分離調査報告書

- 調査日: 2026-08-14
- 対象: リポジトリの `main` ブランチ、およびリポジトリにリンクされた hosted Supabase プロジェクト
- 調査目的: 複数ユーザー間のデータ分離と、管理権限を持つ運用者からの秘匿性を確認する

## 1. 結論

現在の実装は、通常のログインユーザー同士を PostgreSQL RLS によって分離している。
ユーザー A として発行された正規の Custom JWT では、ユーザー B のタスクおよび依存関係を読み書きできない。

一方、Supabase プロジェクト管理者や、本番環境の Supabase secret key / JWT signing secret を取得できる運用管理者からデータを秘匿する設計にはなっていない。
したがって、次の 2 つは区別する必要がある。

| 要求 | 現状 |
| --- | --- |
| 通常ユーザーが他ユーザーのデータを閲覧・変更できない | 満たしている |
| Supabase / Vercel 等のインフラ管理者も他ユーザーのデータを閲覧できない | 満たしていない |

後者を満たすには RLS の追加では足りず、復号鍵をサーバーへ渡さないクライアント側暗号化が必要になる。

## 2. 「管理者」の範囲

アプリケーションには、一般ユーザーとは別の application admin ロールは存在しない。
Custom JWT の `role` は常に `authenticated` であり、ログインユーザーは全員同じ DB ロールを使用する。

本報告書で問題になる管理者は、次のいずれかを行える運用主体を指す。

- Supabase Dashboard、SQL Editor、Management API、DB 接続情報を利用できる
- Supabase secret key を取得できる
- Supabase legacy JWT secret を取得できる
- Vercel の本番環境変数を閲覧・変更できる
- デプロイするサーバーコードまたはブラウザへ配信するコードを変更できる

## 3. 調査範囲と方法

次を読み取り専用で確認した。

1. `supabase/migrations/` のテーブル、View、RLS Policy、RPC、GRANT
2. `src/auth.ts` と `src/lib/supabase/` の認証情報・クライアント生成経路
3. Server Action と RSC がセッションユーザー ID を取得する経路
4. `supabase/tests/` のユーザー分離テスト
5. Management API を用いた hosted DB の権限メタデータ
   - migration 適用履歴
   - `relrowsecurity` / `relforcerowsecurity`
   - `pg_policies`
   - relation / schema / function ACL
   - `postgres` / `service_role` / `authenticated` / `anon` の `BYPASSRLS`
6. `supabase test db` による pgTAP テスト一式

hosted DB の確認では、ユーザーのタスク、メールアドレス、セッショントークン、OAuth token 等の実データは取得していない。
プロジェクト ref、API key、access token、JWT secret も本報告書には記録しない。

## 4. 通常ユーザー間の分離

### 4.1 RLS

`public.tasks` と `public.task_dependencies` では RLS が有効である。
SELECT / INSERT / UPDATE / DELETE の全 Policy が `authenticated` を対象とし、所有者条件に次を使用する。

```sql
user_id = next_auth.uid()
```

根拠は [20260808000006_rls_policies.sql](../supabase/migrations/20260808000006_rls_policies.sql) である。

`public.app_tasks` は `security_invoker = true` で作られているため、View 所有者の権限ではなく呼び出しユーザーの権限で基底テーブルへアクセスし、RLS を引き継ぐ。
根拠は [20260808000003_app_tasks_view.sql](../supabase/migrations/20260808000003_app_tasks_view.sql) である。

hosted DB でも、両テーブルの RLS と全 8 Policy、および View の `security_invoker=true` が実際に存在することを確認した。

### 4.2 セッションから DB ユーザーへの経路

Server Action / RSC は `auth()` で検証した `session.user.id` を取得する。
その ID を `sub`、DB ロールを `authenticated` とする有効期間 5 分の Custom JWT をサーバー側で発行し、publishable key と組み合わせて Data API を呼ぶ。

関連実装は次のとおりである。

- [get-session-user.ts](../src/features/auth/lib/get-session-user.ts)
- [custom-jwt.ts](../src/lib/supabase/custom-jwt.ts)
- [app-client.ts](../src/lib/supabase/app-client.ts)
- [define-task-action.ts](../src/features/task/lib/define-task-action.ts)

`createTask` は `user_id` をクライアント入力から受け取らず、検証済みセッションの ID を INSERT へ設定する。
他の更新系 Action も同じ ID をクエリ条件に使用し、DB の RLS と二重に対象を限定している。

### 4.3 複合外部キー

タスクの親子関係と依存関係は、`user_id` を含む複合外部キーで同一ユーザー内に制限されている。
これは異なるユーザーのタスク間に関係を作れないことを保証する。

ただし、複合外部キーはデータ構造の整合性を守る制約であり、RLS を迂回した主体による SELECT を防ぐものではない。

### 4.4 テスト結果

`npx supabase@2.114.0 test db` を実行し、次の結果を得た。

```text
Files=11, Tests=114
Result: PASS
```

[009_rls_isolation.test.sql](../supabase/tests/009_rls_isolation.test.sql) は、ユーザー B の `authenticated` ロールから次を確認している。

- ユーザー A の `tasks` が 0 件に見える
- `app_tasks` 経由でもユーザー A の行が 0 件に見える
- ユーザー A の `task_dependencies` が 0 件に見える
- ユーザー A の行に対する UPDATE / DELETE が 0 行になる
- ユーザー A の `user_id` を指定した INSERT が RLS 違反になる
- 自分の行に対する操作は成功する

## 5. 管理権限からの閲覧経路

### 5.1 service_role と postgres は RLS を迂回する

hosted DB のロール属性は次の状態だった。

| DB ロール | `BYPASSRLS` |
| --- | --- |
| `anon` | false |
| `authenticated` | false |
| `service_role` | true |
| `postgres` | true |

Supabase の secret key は `service_role` としてプロジェクトデータへの full access を与え、RLS を迂回する仕様である。
これは Supabase の [Understanding API keys](https://supabase.com/docs/guides/getting-started/api-keys) と [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security) に明記されている。

`FORCE ROW LEVEL SECURITY` は両テーブルで無効だが、`service_role` と `postgres` 自体が `BYPASSRLS` を持つため、これを有効にするだけでは管理者からの秘匿にはならない。

### 5.2 Auth.js が secret key を使用する

Auth.js の Supabase Adapter は [auth.ts](../src/auth.ts) で `SUPABASE_SECRET_KEY` を受け取り、Data API 経由で `next_auth` schema を操作する。
この key は Adapter が必要とする認証テーブルだけでなく、プロジェクトの `public.tasks` と `public.task_dependencies` にもアクセスできる。

[service-client.ts](../src/lib/supabase/service-client.ts) にも同じ key で任意の schema へアクセスできる factory があり、現在は未使用だが、secret key が持つ権限範囲を縮小するものではない。

### 5.3 JWT signing secret を持つ主体は任意ユーザーになれる

[custom-jwt.ts](../src/lib/supabase/custom-jwt.ts) は、引数の `userId` を検証せず `sub` に設定し、`SUPABASE_JWT_SECRET` で署名する。
通常経路では呼び出し元が `auth()` の結果だけを渡しているため問題はない。

一方、JWT signing secret を取得できる管理者は任意の Auth.js user UUID を `sub` にした正当な JWT を作成できる。
RLS は署名済み JWT の `sub` を信頼するため、その JWT の発行主体がユーザー ID を偽装した場合には防御できない。

したがって、Custom JWT 発行処理と RLS は、管理者に対して独立した 2 つの防御境界ではない。

### 5.4 next_auth に保存される情報

[20260808000001_next_auth_schema.sql](../supabase/migrations/20260808000001_next_auth_schema.sql) は、次の情報をアプリケーションレベルで暗号化していない通常カラムとして定義し、`service_role` と `postgres` に全権限を付与する。

- `next_auth.users`: 氏名、メールアドレス、画像 URL
- `next_auth.sessions`: セッショントークン、ユーザー ID、有効期限
- `next_auth.accounts`: GitHub provider account ID、access token、refresh token、ID token、scope 等
- `next_auth.verification_tokens`: identifier、token、有効期限

`authenticated` と `anon` にはこれらのテーブルを SELECT する権限がないことを hosted DB で確認した。
しかし、Supabase プロジェクト管理者および secret key を持つ管理者は閲覧できる。

## 6. hosted DB で確認した追加事項

### 6.1 migration 適用状態

リポジトリに存在する次の 9 migration は、hosted DB の `supabase_migrations.schema_migrations` にすべて記録されていた。

1. `next_auth_schema`
2. `tasks_and_dependencies`
3. `app_tasks_view`
4. `triggers`
5. `rpc_functions`
6. `rls_policies`
7. `reorder_tasks_exclude_deleted_siblings`
8. `close_position_gaps_on_restore_and_delete`
9. `move_task_append_to_tail`

### 6.2 anon の過剰な relation 権限

hosted DB では `anon` に、次の relation 権限が付与されていた。

- `public.tasks`: SELECT / INSERT / UPDATE / DELETE を含む広い権限
- `public.task_dependencies`: SELECT / INSERT / UPDATE / DELETE を含む広い権限
- `public.app_tasks`: SELECT を含む広い権限

現在は RLS Policy が `authenticated` だけを対象としているため、`anon` から対象行は見えず、直ちにデータ漏洩する状態ではない。
ただし、RLS の無効化や誤った anon Policy の追加が将来発生すると、relation 権限がそのまま利用可能になる。

リポジトリの [20260808000006_rls_policies.sql](../supabase/migrations/20260808000006_rls_policies.sql) は `authenticated` への GRANT だけを記述しており、hosted DB の ACL と一致していない。
不要な `anon` 権限を明示的に REVOKE する migration を追加し、実DBとのずれを解消することが望ましい。

## 7. リスク判定

| ID | 重要度 | 内容 | 現在の影響 |
| --- | --- | --- | --- |
| F-1 | 要件不適合 | Supabase / Vercel 管理者からタスク内容を秘匿できない | 管理権限があれば全ユーザーのタスクを取得可能 |
| F-2 | 高 | secret key が Auth.js 用途を超えて public schema にも full access を持つ | key 漏洩・誤用時に RLS を迂回して全データへ到達可能 |
| F-3 | 高 | JWT signing secret から任意 `sub` の JWT を発行できる | signing secret を持つ主体は任意ユーザーとしてアクセス可能 |
| F-4 | 高 | `next_auth` にセッション・OAuth token をアプリケーションレベルの暗号化なしで保存する | 管理権限または secret key から認証情報を取得可能 |
| F-5 | 中 | hosted DB の `anon` ACL が必要以上に広い | 現在は RLS が遮断するが、将来の設定ミスに対する防御が弱い |
| F-6 | 文書不整合 | RLS が Custom JWT 発行経路から独立した防御であるという記述 | signing secret の信頼境界を誤認する可能性がある |

F-1 は、通常の Supabase / RLS の脆弱性ではない。
RLS はアプリケーションユーザー間の認可を目的とし、DB 管理権限から平文データを隠す仕組みではないためである。

## 8. 推奨対応

### 8.1 最初に決めること

守る対象を次のどちらにするか明文化する。

1. 通常ユーザー間だけを分離し、信頼された運用管理者によるアクセスは許容する
2. 運用管理者、DB 管理者、クラウド事業者からもタスク内容を秘匿する

1 を選ぶ場合、現在の基本構成は目的に合っている。
秘密情報へのアクセス制御、監査、key rotation、不要権限の削除を強化する。

2 を選ぶ場合、次節のクライアント側暗号化が必要になる。

### 8.2 管理者から秘匿する場合

少なくとも `title` と `description` をユーザー端末で暗号化し、Supabase には暗号文だけを保存する。
秘匿対象に応じて `due_date`、完了状態、親子・依存関係等も暗号化対象に含める。

復号鍵は次の条件を満たす必要がある。

- Supabase、Vercel、Next.js Server Action へ平文で渡さない
- サーバーの環境変数へ保存しない
- ユーザーのパスフレーズ、端末鍵、WebAuthn 等の管理者が取得できない情報で保護する
- 複数端末間の鍵共有、端末紛失、復旧、鍵 rotation の仕様を持つ

暗号化すると、サーバー側での検索、ソート、期限判定、View による派生値計算等に制約が生じる。
暗号化しない ID、所有者、構造、更新日時等の metadata は管理者から見える点にも注意が必要である。

さらに、運用管理者がブラウザへ配信する JavaScript を変更できる脅威まで対象にすると、復号時に鍵や平文を送信するコードを混入できる。
この脅威に対しては、ユーザーが検証可能な署名済みクライアント、独立したクライアント配布、コード完全性の保証等を含む別の設計が必要になる。

### 8.3 現行構成の防御強化

管理者からの完全な秘匿を採用するかにかかわらず、次を推奨する。

1. hosted DB の `anon` relation 権限を明示的に REVOKE する
2. `anon` が `tasks` / `task_dependencies` / `app_tasks` へ権限を持たないことをテストする
3. Supabase / Vercel の管理者と本番環境変数の閲覧者を必要最小限にする
4. secret key をコンポーネントごとに分け、不要になった key を失効させる
5. `service-client.ts` の将来用途を再検討し、不要であれば削除する
6. `next_auth.accounts` に GitHub OAuth token を保存し続ける必要性を確認し、不要な token を保持しない
7. key 利用、管理操作、認証イベントの監査ログを整備する
8. hosted DB の Policy・ACL・ロール属性を定期的に監査し、migration との差分を検出する

## 9. 判定の要約

通常ユーザー同士の分離については、実装、hosted DB、pgTAP テストの 3 点で有効性を確認できた。

しかし、現在のデータはアプリケーションレベルの暗号化なしで保存され、Supabase の管理ロールと secret key は RLS を迂回する。
このため、「管理者であっても他ユーザーの情報を閲覧できない」を文字どおりの要件とするなら、現行設計は不適合であり、クライアント側暗号化を前提とした再設計が必要である。
