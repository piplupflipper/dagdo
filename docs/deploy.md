# dagdo 本番デプロイ手順書

- 対象リポジトリ: dagdo
- 対象コミット: 1a167fc
- 作成日: 2026-08-12
- 更新日: 2026-08-13
- 生成者: Claude Code

本文中、`docs/auth-design.md` に根拠を持つ記述には `(auth-design.md §NN)` を、`docs/github-oauth-setup.md` に根拠を持つ記述には `(github-oauth-setup.md §NN)` を付ける。
それ以外の記述は、2026-08-12 に実施したデプロイ作業で確認した事実、または本文書が下す確定事項である。
実施して確認済みの事実と、環境（Supabase の新規プロジェクトに割り当てられる鍵の状態、実施環境のネットワーク構成など）によって変わりうる事項は、章ごとに書き分ける。

## 目次

1. [サマリ](#1-サマリ)
2. [前提](#2-前提)
3. [手順の全体像](#3-手順の全体像)
4. [Supabase プロジェクトの作成](#4-supabase-プロジェクトの作成)
5. [next_auth schema の公開](#5-next_auth-schema-の公開)
6. [JWT secret の確認](#6-jwt-secret-の確認)
7. [migration の適用](#7-migration-の適用)
8. [Vercel プロジェクトの作成](#8-vercel-プロジェクトの作成)
9. [カスタムドメインの接続](#9-カスタムドメインの接続)
10. [prod 用 GitHub OAuth App](#10-prod-用-github-oauth-app)
11. [Vercel 環境変数の設定](#11-vercel-環境変数の設定)
12. [Production デプロイ](#12-production-デプロイ)
13. [動作検証](#13-動作検証)
14. [既知の制約](#14-既知の制約)
15. [トラブルシューティング](#15-トラブルシューティング)
16. [用語集](#16-用語集)

---

## 1. サマリ

dagdo の本番構成は Vercel（Next.js）と hosted Supabase（PostgreSQL）であり、カスタムドメイン `dagdo.ngmtine.com`（Cloudflare で管理する `ngmtine.com` のサブドメイン）を用いる。
本文書は、2026-08-12 に実施した初回の本番デプロイ作業の手順を、実施順に確定事項として記録する。

手順には順序上の依存があり、任意の順序では進められない。
とくに、GitHub OAuth App のコールバック URL はドメインが確定するまで登録できないため、Vercel のプロジェクト作成とカスタムドメイン接続を先に済ませる必要がある（第 3 章で詳述する）。

対象読者は、dagdo を Vercel 本番環境へ新たにデプロイする開発者、および既存の本番環境を運用・保守する開発者である。

---

## 2. 前提

### 2.1 本番構成

本番構成は次のとおりである。

| 要素 | 採用技術 |
|---|---|
| アプリケーション | Vercel 上の Next.js（App Router） |
| データベース | hosted Supabase（PostgreSQL） |
| カスタムドメイン | `dagdo.ngmtine.com`（Cloudflare が管理する `ngmtine.com` のサブドメイン） |

認証（Auth.js + GitHub OAuth + Custom JWT）と認可（RLS + 複合 FK）の設計は `docs/auth-design.md` に定義済みであり、本文書では重複させない。
GitHub OAuth App 自体の作成手順は `docs/github-oauth-setup.md` に定義済みであり、本文書は第 10 章で同書 §7 を参照する。

### 2.2 手順の順序に意味がある理由

本文書が第 3 章で示す手順は、次の依存関係により順序が固定される。

GitHub OAuth App の Authorization callback URL は、本番ドメインが確定してから登録する必要がある（`github-oauth-setup.md` §7.1）。
本番ドメインは Vercel のプロジェクト作成とカスタムドメイン接続（第 8 章・第 9 章）を終えるまで確定しない。
したがって、prod 用 GitHub OAuth App の作成（第 10 章）は、Vercel 側の手順よりも後に行う。

---

## 3. 手順の全体像

本文書が扱う手順は次の 10 個である。

| 手順 | 内容 | 対応章 |
|---|---|---|
| 1 | Supabase プロジェクト作成 | 第 4 章 |
| 2 | `next_auth` schema の Data API 公開 | 第 5 章 |
| 3 | JWT secret の確認 | 第 6 章 |
| 4 | migration の適用 | 第 7 章 |
| 5 | Vercel プロジェクト作成（ドメイン確定） | 第 8 章 |
| 6 | カスタムドメイン接続（Vercel + Cloudflare） | 第 9 章 |
| 7 | prod 用 GitHub OAuth App 作成 | 第 10 章 |
| 8 | Vercel 環境変数設定 | 第 11 章 |
| 9 | Production デプロイ | 第 12 章 |
| 10 | 動作検証 | 第 13 章 |

---

## 4. Supabase プロジェクトの作成

**確定事項**: リージョンは ap-northeast-1（Tokyo）を採用する。

プロジェクト作成後、プロジェクト ref は Supabase Dashboard の Project URL（`https://<ref>.supabase.co`）で確認できる。
この ref は、第 5 章の Management API 呼び出しと、第 11 章の `SUPABASE_URL` の両方で用いる。

プロジェクト作成時に設定する DB パスワードは、第 7.1 節の `supabase link` で使用するため控えておく。
値そのものは secret であり、本文書には書かない。

---

## 5. next_auth schema の公開

dagdo の Auth.js Adapter は Supabase の Data API（PostgREST）経由で `next_auth` schema を操作するため、この schema を Data API の exposed schemas に追加する必要がある（`auth-design.md` §4.3）。
この設定を怠ると、GitHub 認可後に 500 エラーになる（`auth-design.md` §4.3、第 15 章のトラブルシューティングにも記載する）。

ローカル環境では `supabase/config.toml` の次の行がこの設定を担う。

```toml
schemas = ["public", "graphql_public", "next_auth"]
```

（`supabase/config.toml:13`）

`auth-design.md` 第 10 章は、この exposed schemas 追加の具体的な設定手順を実装時の未決事項として残していた。
2026-08-12 の実施により、この未決事項を次のとおり確定させる。

**確定事項**: `supabase/config.toml` の設定は hosted Supabase には反映されない。
hosted 環境では、次のいずれかの方法で `next_auth` を exposed schemas に追加する。

- Supabase Dashboard → Settings → API → Exposed schemas に `next_auth` を追加する
- Supabase Management API の `PATCH /v1/projects/{ref}/postgrest` を呼び、`db_schema` を更新する

2026-08-12 の実施では後者（Management API 経由）を使用した。

---

## 6. JWT secret の確認

dagdo は `src/lib/supabase/custom-jwt.ts` で HS256 の Custom JWT を自前署名する（`src/lib/supabase/custom-jwt.ts:26-31`、`auth-design.md` §5.3）。
署名鍵は環境変数 `SUPABASE_JWT_SECRET` として渡し、値は Supabase プロジェクトの legacy JWT secret を用いる（`auth-design.md` §5.3）。

2026-08-12 時点で新規作成した Supabase プロジェクトの鍵の状態は次のとおりであった（実施環境固有の事実であり、Supabase 側の仕様変更により将来変わりうる）。

- ES256 の JWT Signing Keys（新方式の非対称鍵）が `in_use`
- HS256 legacy 鍵が `previously_used`

`previously_used` の鍵は検証には引き続き使われるため、Custom JWT はこの状態のままで動作する。

**確定事項（運用上の重要注意）**: HS256 legacy 鍵を revoke してはならない。
revoke すると、`custom-jwt.ts` が署名に使う鍵が検証側から失われ、認証が全滅する。

`SUPABASE_JWT_SECRET` に設定する値は、Dashboard → Settings → JWT Keys の legacy JWT secret である。

---

## 7. migration の適用

### 7.1 通常経路

制限のないネットワーク環境では、次の順序で適用する。

```sh
npx supabase login
npx supabase link --project-ref <ref>
make db-push
```

（`make db-push` は `Makefile:78-80` が定義する）

`db push` は `supabase/seed.sql` を適用しない（`Makefile:79` のコメントが明記する）。
本番に開発用ダミーデータが入らないのは意図どおりの挙動である。

### 7.2 ネットワーク制限環境での代替経路（2026-08-12 に実際に使用した経路）

2026-08-12 の実施環境では、outbound の Postgres ポート（5432/6543）がファイアウォールで遮断されていた。
direct 接続先（`db.<ref>.supabase.co`）は IPv6 のみで名前解決され、実施環境には IPv6 経路がなかった。
この結果、`make db-push` は Connection timed out で失敗した。

このときのエラーメッセージは `SUPABASE_DB_PASSWORD` の設定を促す内容であったが、原因はパスワードではなくネットワーク層である（第 15 章のトラブルシューティングにも記載する）。

代替として、HTTPS（443）のみで到達可能な Supabase Management API を使用した。
手順は次のとおりである。

1. `POST https://api.supabase.com/v1/projects/{ref}/database/query` に `{"query": "<migration SQL 全文>"}` を、`~/.supabase/access-token` にある CLI トークンを Bearer トークンとして付けて送る
2. migration ファイル（`supabase/migrations/` 配下の 7 ファイル）を、ファイル名の連番順に 1 の手順で投げる
3. 適用後、`supabase_migrations.schema_migrations` テーブル（`version text primary key, statements text[], name text`）を作成し、各 migration の version（ファイル名先頭 14 桁）と name を insert して適用履歴を記録する

手順 3 は、将来ネットワーク制限のない回線から `make db-push` を実行しても、すでに適用済みの migration が二重適用されないようにするための記録である。

適用対象の migration ファイルは次のとおりである。

- `supabase/migrations/20260808000001_next_auth_schema.sql`
- `supabase/migrations/20260808000002_tasks_and_dependencies.sql`
- `supabase/migrations/20260808000003_app_tasks_view.sql`
- `supabase/migrations/20260808000004_triggers.sql`
- `supabase/migrations/20260808000005_rpc_functions.sql`
- `supabase/migrations/20260808000006_rls_policies.sql`
- `supabase/migrations/20260808000007_reorder_tasks_exclude_deleted_siblings.sql`

**注意（作業時に遭遇した罠）**: Python 標準の `urllib` が送るデフォルトの User-Agent は Cloudflare に遮断される（HTTP 403、error code 1010）。
curl 相当の User-Agent を明示すると通る。

適用後、次の対象への select により、期待するオブジェクトの存在を確認した。

| 確認対象 | 確認先 |
|---|---|
| `next_auth` の 4 テーブル | `information_schema` |
| `tasks` / `task_dependencies`（RLS 有効） | `pg_class` |
| `app_tasks` ビュー | `information_schema` |
| RPC 5 本 + `next_auth.uid` | `pg_proc` |
| trigger 4 本 | `pg_trigger` |
| policy 8 本 | `pg_policies` |

---

## 8. Vercel プロジェクトの作成

Vercel の Add New Project から、GitHub リポジトリ（`ngmtine/dagdo`）を import する。
Framework は Next.js が自動検出される。

**確定事項**: 環境変数を未設定のまま行う初回ビルドは必ず失敗する。
`src/auth.ts` は `NextAuth()` の呼び出し（`src/auth.ts:21-30`）でモジュールスコープで `process.env.SUPABASE_URL` 等を読むため、この時点でこれらの環境変数が必要になる。
これは異常ではなく、第 11 章の環境変数設定後に Redeploy すれば解消する。

---

## 9. カスタムドメインの接続

Vercel 側の Project → Settings → Domains に `dagdo.ngmtine.com` を追加すると、要求される DNS レコードが表示される。

Cloudflare 側は `ngmtine.com` ゾーンの DNS → Records → Add record から、CNAME レコード（Name: `dagdo`、Target: Vercel が表示した値。通常 `cname.vercel-dns.com`）を追加する。

**確定事項**: Proxy status は必ず DNS only（グレー雲）にする。
Proxied（オレンジ雲）のままだと、Vercel 側の証明書検証が失敗し、リダイレクトループの原因になる（第 15 章のトラブルシューティングにも記載する）。

デフォルトで割り当てられる `*.vercel.app` ドメインは、カスタムドメインへの Redirect に設定する。
これを設定しない場合、`*.vercel.app` 側の URL からのログインが、GitHub OAuth App のコールバック URL 不一致（第 10 章）により失敗する。

---

## 10. prod 用 GitHub OAuth App

prod 用 GitHub OAuth App の作成手順は `github-oauth-setup.md` §7 が定義済みであり、本文書では重複させない。

本番の値は次のとおりである（`github-oauth-setup.md` §7.1 の入力欄に対応する）。

| 入力欄 | 値 |
|---|---|
| Application name | `dagdo` |
| Homepage URL | `https://dagdo.ngmtine.com` |
| Authorization callback URL | `https://dagdo.ngmtine.com/api/auth/callback/github` |

---

## 11. Vercel 環境変数の設定

`auth-design.md` §8 が定める 7 変数を、Vercel の Settings → Environment Variables から Production スコープで設定する。

| 変数名 | 値 |
|---|---|
| `AUTH_SECRET` | 新規生成する（`openssl rand -base64 33`）。ローカル用の値を使い回さない |
| `AUTH_GITHUB_ID` | 第 10 章で作成した prod 用 OAuth App の Client ID |
| `AUTH_GITHUB_SECRET` | 第 10 章で作成した prod 用 OAuth App の Client Secret |
| `SUPABASE_URL` | `https://<ref>.supabase.co`（第 4 章で確認した ref） |
| `SUPABASE_PUBLISHABLE_KEY` | Supabase Dashboard の API Settings から取得する（`sb_publishable_` で始まる） |
| `SUPABASE_SECRET_KEY` | Supabase Dashboard の API Settings から取得する（`sb_secret_` で始まる） |
| `SUPABASE_JWT_SECRET` | 第 6 章で確認した legacy JWT secret |

`AUTH_URL` / `AUTH_TRUST_HOST` は設定不要である。
Vercel 上で動作する Auth.js は、これらをデプロイ先ドメインから自動検出する。

認可後に `*.vercel.app` 側へ戻される等の症状が出た場合に限り、`AUTH_URL=https://dagdo.ngmtine.com` を設定するのが最初の対処である（第 15 章のトラブルシューティングにも記載する）。

---

## 12. Production デプロイ

第 11 章の環境変数を保存した後、Redeploy する。
第 8 章で失敗していた初回ビルドは、この Redeploy で解消する。

---

## 13. 動作検証

次の順序で確認する。

1. `https://dagdo.ngmtine.com/` を開き、`/login` へリダイレクトされることを確認する
2. GitHub でログインし、メイン画面が表示されることを確認する（タスク 0 件が正常な状態である。第 7.1 節が示すとおり seed は本番へ適用していない）
3. `next_auth.users` に、ログインしたアカウントの行が作成されていることを確認する
4. タスクの作成・更新・削除が動作することを確認する（Custom JWT + RLS の疎通確認になる）
5. 可能であれば、別アカウントでログインし、RLS によるユーザー間データ分離を確認する

---

## 14. 既知の制約

- **Preview デプロイからは GitHub ログインできない**。PR ごとに発行される一時 URL は、第 10 章で登録した Authorization callback URL と一致しないため、ログイン可能なのは Production デプロイのみである
- **HS256 legacy 鍵を revoke してはならない**（第 6 章の再掲）。revoke すると認証が全滅する
- **migration 追加時の運用は実施環境のネットワーク条件で分岐する**。制限のない回線からは通常経路（第 7.1 節）の `make db-push` を使う。制限のある回線からは第 7.2 節の Management API 経路を使う

---

## 15. トラブルシューティング

| 症状 | 原因 | 対処 |
|---|---|---|
| `make db-push` が Connection timed out になる | ネットワーク層の問題（Postgres ポート遮断、または IPv6 経路がない）。`SUPABASE_DB_PASSWORD` の設定を促すメッセージが出ても、パスワードは原因ではない | pooler ホストの 5432/6543 ポートへの TCP 疎通と、`https://<ref>.supabase.co/rest/v1/` への HTTPS 疎通（401 が返れば到達できている）を比較して判別する。制限のない回線から実行するか、第 7.2 節の Management API 経路を使う |
| GitHub 認可後、dagdo 側で 500 エラーになる | `next_auth` schema が Data API に公開されていない、または `SUPABASE_SECRET_KEY` が誤っている（`github-oauth-setup.md` §8 と同様） | 第 5 章の Exposed schemas 設定を確認する。あわせて `SUPABASE_SECRET_KEY` の値を確認する |
| Vercel の初回ビルドが `supabaseUrl is required` 等のエラーで失敗する | 環境変数が未設定のまま Vercel がビルドしている（第 8 章） | 第 11 章の環境変数を設定し、Redeploy する |
| ログイン後に `*.vercel.app` 側へ戻される、または callback 不一致になる | `*.vercel.app` ドメインの Redirect が未設定（第 9 章）、または Auth.js がデプロイ先ドメインの自動検出に失敗している | `*.vercel.app` の Redirect 設定を確認する。解消しない場合は `AUTH_URL=https://dagdo.ngmtine.com` を設定する（第 11 章） |
| Cloudflare 経由でアクセスするとリダイレクトループになる、または証明書エラーになる | DNS レコードの Proxy status が Proxied になっている（第 9 章） | Proxy status を DNS only に変更する |

---

## 16. 用語集

`Data API` / `exposed schemas` / `secret key` / `publishable key` / `RLS` の定義は `auth-design.md` 第 11 章の用語集を参照する。
本文書はここでは重複させず、本文書で新たに導入する用語のみを次に示す。

| 用語 | 説明 |
|---|---|
| **Vercel** | Next.js アプリケーションのホスティングサービス。dagdo の本番実行環境として使用する |
| **Cloudflare** | DNS 管理サービス。dagdo のカスタムドメインが属する `ngmtine.com` ゾーンを管理する |
| **CNAME レコード** | DNS レコードの一種で、あるホスト名を別のホスト名の別名として指す。カスタムドメインを Vercel のホスト名へ向けるために使う（第 9 章） |
| **Proxy status（Cloudflare）** | Cloudflare の DNS レコードが、通信を Cloudflare 経由（Proxied）にするか、DNS 解決のみ（DNS only）にするかを切り替える設定。dagdo は DNS only を要求する（第 9 章） |
| **JWT Signing Keys** | Supabase の新方式の JWT 署名鍵。非対称鍵（ES256 等）を使う。新規プロジェクトでは既定でこの方式が `in_use` になる（第 6 章） |
| **legacy JWT secret** | Supabase の旧方式の JWT 署名鍵（HS256）。dagdo の Custom JWT はこの鍵で署名する（第 6 章、`auth-design.md` §5.3） |
| **Management API（Supabase）** | Supabase プロジェクトの設定変更や SQL 実行を、HTTPS 経由の REST API で行う手段。Dashboard の代替として使う（第 5 章・第 7.2 節） |
| **project ref** | Supabase プロジェクトを一意に識別する文字列。Project URL（`https://<ref>.supabase.co`）に含まれる（第 4 章） |
| **Preview デプロイ（Vercel）** | Vercel が Pull Request ごとに発行する一時的なデプロイ URL。dagdo では GitHub ログインができない（第 14 章） |

---

- 対象リポジトリ: dagdo
- 対象コミット: 1a167fc
- 作成日: 2026-08-12
- 更新日: 2026-08-13
- 生成者: Claude Code
