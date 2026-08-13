# dagdo 認証認可設計書

- 対象リポジトリ: dagdo
- 対象コミット: a9b61ed
- 作成日: 2026-08-08
- 更新日: 2026-08-13
- 生成者: Claude Code

本文書は dagdo の認証・認可の現在の設計を述べる。
実装と一体で改訂する文書であり、記述と実装が食い違っている場合は実装を正とみなして本文書を直す。

本文中、`req.md` に根拠を持つ記述には `(req.md §NN)` を付ける。
それ以外の記述は本文書が下す設計判断であり、根拠となる実装ファイルのパスを併記する。
まだ決めていない事項は第 10 章に集約する。

本文書は `docs/db-design.md` および `docs/frontend-design.md` の姉妹文書である。
DB スキーマ・RLS・Trigger・RPC の全体像は `docs/db-design.md` に、フロントエンドのディレクトリ構成・状態設計・コンポーネント構成は `docs/frontend-design.md` に委ねる。
本文書はこの 2 文書の間に位置する認証・認可の詳細設計を扱う。

## 目次

1. [サマリ](#1-サマリ)
2. [認証と認可の全体像](#2-認証と認可の全体像)
3. [Auth.js 設定](#3-authjs-設定)
4. [next_auth schema](#4-next_auth-schema)
5. [Custom JWT](#5-custom-jwt)
6. [ルート保護](#6-ルート保護)
7. [認可](#7-認可)
8. [環境変数一覧](#8-環境変数一覧)
9. [セキュリティ上の非目標・割り切り](#9-セキュリティ上の非目標割り切り)
10. [未決事項](#10-未決事項)
11. [用語集](#11-用語集)

---

## 1. サマリ

dagdo の認証は Auth.js（NextAuth v5 系）+ GitHub OAuth + `@auth/supabase-adapter` によって行い、認証データは Supabase PostgreSQL の `next_auth` schema に保存する（`req.md` §2.3, §30, §31）。

Session strategy は database とする（2026-08-08 ユーザー確定）。
`next_auth.sessions` テーブルにセッションを永続化し、Auth.js はセッション cookie の値からこのテーブルを参照してセッションの真正性を検証する。

Todo データへのアクセスは Auth.js session とは別の、Supabase Data API 向け Custom JWT によって行う（`req.md` §33, §34）。
Custom JWT は Server Action の呼び出し毎に発行し、有効期限（`exp`）はおよそ 5 分とする（2026-08-08 ユーザー確定）。
キャッシュや失効管理の仕組みは持たない。

認可は allowlist に頼らず、PostgreSQL の RLS（Row Level Security）と `user_id` 付き複合外部キー（以下 FK）制約の二重によって行う（`req.md` §3.1, §39〜43）。

ルート保護は二段構えとする。
`middleware.ts` は Edge Runtime 上でセッション cookie の存在チェックのみを行う楽観的ガードに徹し、真の認可は RSC（React Server Component）/ Server Action 層での `auth()` によるセッション検証と、DB 層の RLS が担う。
middleware をすり抜けた場合であっても、RLS が最終防衛線として機能する。

本文書がカバーする範囲は、Auth.js の設定詳細、`next_auth` schema の運用上の注意点、Custom JWT のクレーム仕様と発行方式、`middleware.ts` の設計方針、RLS/FK/RPC 権限による認可、環境変数一覧である。
UI 側のログイン画面デザインや、`docs/frontend-design.md` が扱うディレクトリ構成・状態設計そのものの再定義は対象外とする。

---

## 2. 認証と認可の全体像

### 2.1 2 系統の認証情報

dagdo は 2 種類の異なる認証情報を明確に分離して扱う（`req.md` §33）。

**Auth.js Session** の目的は、Next.js 側でログインユーザーを識別することである(`req.md` §33)。
GitHub OAuth ログイン後に Auth.js が発行し、`next_auth.sessions` に永続化する。

**Supabase Custom JWT** の目的は、PostgreSQL/RLS に対して「誰として DB アクセスしているか」を伝えることである(`req.md` §33)。
Auth.js Session とは別に、Server Action の実行毎に短命な JWT として発行する。

この 2 つを分離する理由は、Auth.js Session の生存期間（ログイン中はずっと有効）と、DB アクセスの認可単位（1 回のデータアクセス毎に検証したい）が本来異なるスコープを持つためである。
また、GitHub access token を Supabase へ直接渡さない(`req.md` §33)。
Custom JWT のクレームには GitHub access token を含めず、Auth.js user UUID のみを含める（第 5 章）。

### 2.2 ログインからデータアクセスまでのフロー

```text
ブラウザ
  │  GET /login
  ▼
Next.js (RSC: app/login/page.tsx)
  │  signIn("github") を呼ぶ LoginButton
  ▼
GitHub OAuth 認可画面
  │  ユーザーが許可
  ▼
Auth.js callback (app/api/auth/[...nextauth]/route.ts)
  │  service-client（secret key）経由で next_auth schema へ書き込み
  │  next_auth.users / next_auth.accounts / next_auth.sessions
  ▼
Auth.js が session cookie を発行 (session strategy = database)
  │
  ▼
ブラウザ（以後のリクエストに session cookie を添付）
  │
  ▼
middleware.ts
  │  session cookie の存在チェックのみ（楽観的ガード。第 6 章）
  │  cookie がなければ /login へリダイレクト
  ▼
RSC / Server Action
  │  auth() を呼ぶ
  │  → session cookie の値で next_auth.sessions を検索し、真正性・有効期限を検証
  │  → session.user.id（next_auth.users.id）を取得
  ▼
custom-jwt.ts（lib/supabase/custom-jwt.ts）
  │  sub = session.user.id
  │  role = "authenticated"
  │  exp = 発行時刻 + 約5分
  │  jose で HS256 署名（鍵: SUPABASE_JWT_SECRET）
  ▼
app-client.ts（lib/supabase/app-client.ts）
  │  publishable key + Custom JWT（Authorization ヘッダ）で Supabase Data API へアクセス
  ▼
Supabase Data API (PostgREST)
  │  JWT の role クレームから Postgres の authenticated ロールとして実行
  ▼
PostgreSQL RLS
  │  user_id = next_auth.uid()（JWT の sub から解決）
  ▼
tasks / task_dependencies
```

この図の要点は、cookie チェック（middleware）→ セッション検証（`auth()`）→ Custom JWT 発行 → RLS、という 4 段階のうち、実際にユーザーの正当性を検証しているのは 2 段階目の `auth()` と最終段階の RLS であり、middleware はあくまで UX 上のショートカット（未ログインユーザーを早期に `/login` へ導く最適化）に過ぎないという点である（第 6 章で詳述する）。

---

## 3. Auth.js 設定

### 3.1 Provider

GitHub OAuth を Provider として使用する(`req.md` §2.3, §30)。

要求スコープは追加せず、Auth.js の GitHub Provider が要求する既定スコープ（`read:user` + `user:email` 相当）をそのまま使用する。
理由は、GitHub access token を Supabase へ渡さない方針であり(`req.md` §33)、Todo 機能自体が GitHub API を呼び出さないため、ユーザー識別に必要な最小スコープ以上を要求する必要がないことによる。

### 3.2 Adapter

`@auth/supabase-adapter` を使用し、Auth.js の認証情報を `next_auth` schema へ永続化する(`req.md` §30, §31)。
Adapter には `SUPABASE_URL` と `SUPABASE_SECRET_KEY` を渡す(`req.md` §36)。
Adapter はこの 2 値から内部で自前の Supabase client を生成するため、`lib/supabase/service-client.ts` を渡す形は取らない（第 5.4 節）。

### 3.3 Session strategy

Session strategy は database とする（2026-08-08 ユーザー確定）。
`next_auth.sessions` にセッションレコードを持ち、セッション cookie にはセッショントークンのみを保持する。
JWT strategy（cookie 自体にセッション内容を署名して埋め込む方式）は採用しない。

### 3.4 callbacks

`session` コールバックで `session.user.id` に `next_auth.users.id` を載せる（`req.md` §31 が定める「Todo アプリのユーザー ID として `next_auth.users.id` を使用する」という方針をコールバック実装へ落とし込む）。
database strategy では `session` コールバックの引数は `{ session, user }` の形を取り、`user` は Adapter が `next_auth.users` から取得したレコードである（Auth.js の database strategy の一般的な仕様）。

### 3.5 pages

`pages.signIn` に `/login` を指定する(`req.md` §30 のログインフロー図が示す `/login` 起点に対応する)。

### 3.6 実装配置

`docs/frontend-design.md` 第 4 章のディレクトリ構成に整合させ、次の配置とする。

- `src/auth.ts`: Auth.js の設定本体（`NextAuth()` の呼び出しと `handlers` / `auth` / `signIn` / `signOut` のエクスポート）
- `src/app/api/auth/[...nextauth]/route.ts`: `src/auth.ts` の `handlers` を re-export する route handler
- `src/types/next-auth.d.ts`: `session.user.id` を型へ足す宣言マージ（第 3.4 節のコールバックが載せる値に対応する）

設定オブジェクトの骨格を次に示す（コード規約は `docs/frontend-design.md` 第 3 章に従う）。

```typescript
// src/auth.ts
import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import { SupabaseAdapter } from "@auth/supabase-adapter";

export const { handlers, auth, signIn, signOut } = NextAuth({
    adapter: SupabaseAdapter({
        url: process.env.SUPABASE_URL,
        secret: process.env.SUPABASE_SECRET_KEY,
    }),
    providers: [
        GitHub({
            clientId: process.env.AUTH_GITHUB_ID,
            clientSecret: process.env.AUTH_GITHUB_SECRET,
        }),
    ],
    session: {
        strategy: "database",
    },
    pages: {
        signIn: "/login",
    },
    callbacks: {
        session: ({ session, user }) => {
            session.user.id = user.id;
            return session;
        },
    },
});
```

```typescript
// src/app/api/auth/[...nextauth]/route.ts
import { handlers } from "@/auth";

export const { GET, POST } = handlers;
```

---

## 4. next_auth schema

### 4.1 4 テーブルの役割

Auth.js の認証情報は `next_auth` schema の 4 テーブルへ保存する(`req.md` §31)。

- `next_auth.users`: Auth.js user のレコード。`id`（UUID）が `tasks.user_id` の参照先となる(`req.md` §31, §32)
- `next_auth.accounts`: GitHub account と Auth.js user の紐付け。GitHub account 側の情報はここに閉じ、`tasks.user_id` には現れない(`req.md` §32)
- `next_auth.sessions`: session strategy = database で使用するセッションレコード（第 3.3 節）
- `next_auth.verification_tokens`: メール等のトークン系ログイン方式で使用するテーブル。dagdo は GitHub OAuth のみを使用するため実質的に利用しない

### 4.2 next_auth.uid()

PostgreSQL/RLS 上では `next_auth.uid()` をユーザー識別に利用する(`req.md` §35)。
`next_auth.uid()` は Custom JWT の `sub` クレームから Auth.js user UUID を取得する(`req.md` §35)。

この関数は本リポジトリの migration が定義する（`supabase/migrations/20260808000001_next_auth_schema.sql:40-48`）。

```sql
create function next_auth.uid() returns uuid
    language sql stable
    as $$
  select
    coalesce(
        nullif(current_setting('request.jwt.claim.sub', true), ''),
        (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    )::uuid
$$;
```

`@auth/supabase-adapter` は npm パッケージとして SQL を配布しない。
Adapter をインストールしただけでは `next_auth` schema も本関数も存在せず、schema 定義は利用側が用意する必要がある。
本リポジトリは Adapter が公開しているドキュメント上の schema 定義を migration へ取り込み、自身の履歴として管理する（`docs/migration-design.md` 5.1節）。

`current_setting` を 2 通り試すのは、JWT クレームの設定形式が経路によって異なるためである。
Supabase Data API は個別クレームを `request.jwt.claim.<name>` へ設定するが、pgTAP テスト（`docs/migration-design.md` 7.3節）は JSON 全体を `request.jwt.claims` へ設定する。
`coalesce` によっていずれの形式でも同じ結果になる。

したがって、次の等式が成立する(`req.md` §35)。

```text
JWT.sub = next_auth.users.id = tasks.user_id
```

### 4.3 exposed schemas 設定

`@auth/supabase-adapter` は Supabase の Data API（PostgREST）経由で `next_auth` schema のテーブルを操作する。
Data API は既定では `public` schema のみを外部公開の対象（exposed schema）とするため、Supabase プロジェクト側で `next_auth` schema を exposed schemas に追加する設定が必要である。
この設定を行わない場合、Adapter からの `next_auth.*` テーブルへの読み書きが Data API 層で失敗する。

`req.md` はこの設定自体を明記していない。
これは `req.md` が定める「next_auth schema へ保存する」という方針(`req.md` §31)を、Adapter が Data API 経由で動作するという `@auth/supabase-adapter` の実装方式に照らして導かれる、Supabase プロジェクト設定上必須の帰結である。

設定箇所は環境ごとに異なる。

ローカルスタックでは `supabase/config.toml:13` の `[api]` セクションが該当する。

```toml
schemas = ["public", "graphql_public", "next_auth"]
```

hosted Supabase では `config.toml` が反映されないため、Dashboard の Settings → API → Exposed schemas、または Management API の `PATCH /v1/projects/{ref}/postgrest` で設定する（`docs/deploy.md` 第 5 章）。

### 4.4 next_auth schema への GRANT

`public.tasks` / `public.task_dependencies` の RLS Policy は `user_id = next_auth.uid()` を `authenticated` ロールとして評価する（第 7.1 節）。
そのためには `authenticated` ロールが `next_auth` schema を参照でき、`next_auth.uid()` を実行できる必要がある。
これを次の GRANT で与える（`supabase/migrations/20260808000001_next_auth_schema.sql:125-126`）。

```sql
grant usage on schema next_auth to authenticated, anon;
grant execute on function next_auth.uid() to authenticated, anon;
```

Adapter が公開する schema 定義は Adapter 自身（`service_role` 経由）の利用のみを想定しており、これらの GRANT を含まない。
RLS Policy から `next_auth.uid()` を呼ぶという dagdo の構成では追加が必須であり、本リポジトリの migration で明示している。

付与先は `authenticated` と `anon` の 2 ロールである。
`req.md` はこの点に触れておらず、`anon` を含める理由はリポジトリ内に記録がない。

`anon` への付与が与える権限の範囲は次のとおりである。
`usage` は schema 名の解決だけを許すものであり、`next_auth` 配下のテーブルへのアクセスには別途テーブル権限が要る（同 migration はテーブル権限を `postgres` と `service_role` にのみ与えている）。
`next_auth.uid()` を `anon` として呼んだ場合、`sub` クレームが無いため関数は `NULL` を返す。
`user_id = next_auth.uid()` は `NULL` との比較になって真にならないため、RLS Policy を通過する行は生じない。
したがって `anon` への付与によって他ユーザーのデータが読めるようになることはない。
それでも最小権限の原則からは `anon` を外せるかどうかを検討する余地があり、第 9 章の非目標一覧には現れていない。

`public` schema 側のテーブル権限は `docs/db-design.md` 第 10 章が扱う。

---

## 5. Custom JWT

### 5.1 クレーム仕様

Custom JWT には少なくとも `sub` / `role` / `exp` を含める(`req.md` §34)。

| クレーム | 値 | 用途 |
|---|---|---|
| `sub` | Auth.js user UUID（`session.user.id`） | `next_auth.uid()` が抽出する識別子(`req.md` §34, §35) |
| `role` | `"authenticated"` | Supabase Data API が Postgres ロールを決定するために参照する。RLS Policy の `to authenticated` に対応する(`req.md` §34, §40〜43) |
| `exp` | 発行時刻 + 約 300 秒（5 分） | 短命化により漏洩時の悪用可能期間を限定する（2026-08-08 ユーザー確定） |

GitHub access token やその他の GitHub 由来の情報はクレームに含めない(`req.md` §33)。

### 5.2 発行タイミング

Custom JWT は Server Action の呼び出し毎に発行する（2026-08-08 ユーザー確定）。
セッション単位でのキャッシュや使い回しは行わない。

理由は次の 2 点である。

- 有効期限を 5 分程度の短命に保つ設計（第 5.1 節）と、キャッシュして使い回す設計は相性が悪い。キャッシュを導入すると「キャッシュした JWT の有効期限が Server Action 呼び出し時点で既に切れていないか」を確認する処理が別途必要になり、失効管理を持たないという設計判断（第 5.4 節）と矛盾する
- dagdo は個人利用を主用途とし(`req.md` §3.1)、Server Action の呼び出し頻度もそれに応じて低いため、リクエスト毎の署名コストは無視できる

### 5.3 署名方式

jose を用いた HS256 署名とする(`req.md` §34 が定める JWT 生成方針を具体化する)。
鍵には Supabase プロジェクトの JWT secret（legacy JWT secret）を用い、環境変数 `SUPABASE_JWT_SECRET` として保持する（第 8 章）。

### 5.4 責務分割

`lib/supabase/custom-jwt.ts` と `lib/supabase/app-client.ts` の責務を分離する(`docs/frontend-design.md` 第 4 章のディレクトリ構成に対応する)。

- `custom-jwt.ts`: Auth.js user UUID を受け取り、クレームを組み立てて署名済み JWT 文字列を返す。Supabase client の生成には関与しない
- `app-client.ts`: `custom-jwt.ts` を呼び出して JWT を取得し、`publishable key` + Custom JWT（`Authorization` ヘッダ）で Supabase client を生成する(`req.md` §36)。RSC の読み取り（`task/lib/queries.ts`）と Server Action の書き込みからリクエスト毎に生成する

3 つ目の `lib/supabase/service-client.ts` は secret key で client を生成する factory だが、現状は呼び出し元を持たない。
`next_auth` schema へのアクセスは `SupabaseAdapter()` が内部で自前の client を生成して行うため（`node_modules/@auth/supabase-adapter`）、`src/auth.ts` からこの factory を渡す必要がないためである。

意図的な未使用として残している。
アプリケーションコードから secret key でサーバー権限のアクセスが必要になった場合（管理用スクリプト、Adapter が提供しない操作）の受け皿である。
死蔵コード検出（knip）からは `knip.json` の `ignore` で除外している。

クレーム組み立て部分の骨格を次に示す。

```typescript
// lib/supabase/custom-jwt.ts
import { SignJWT } from "jose";

const JWT_TTL_SECONDS = 300;

type CustomJwtClaims = {
    sub: string;
    role: "authenticated";
};

export const createCustomJwt = async ({ userId }: { userId: string }): Promise<string> => {
    const secret = new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET);
    const claims: CustomJwtClaims = { sub: userId, role: "authenticated" };

    return await new SignJWT(claims)
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt()
        .setExpirationTime(`${JWT_TTL_SECONDS}s`)
        .sign(secret);
};
```

```typescript
// lib/supabase/app-client.ts
import { createClient } from "@supabase/supabase-js";
import { createCustomJwt } from "./custom-jwt";

export const createAppClient = async ({ userId }: { userId: string }) => {
    const token = await createCustomJwt({ userId });

    return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
        global: {
            headers: {
                Authorization: `Bearer ${token}`,
            },
        },
    });
};
```

### 5.5 失効管理を持たない設計判断の理由

Custom JWT には失効リスト（revocation list）やブラックリスト機構を設けない。

理由は次のとおりである。

- 有効期限が約 5 分と短く、発行毎に使い切りであるため、漏洩時の悪用可能期間はもともと 5 分以内に限定される
- 失効管理を実装するには、失効済み JWT の ID や有効期限を何らかのストア（DB やキャッシュ）に記録し、RLS または Data API 層で毎回照合する仕組みが必要になる。これは Custom JWT を「短命にしてステートレスに保つ」という設計方針（第 5.2 節、キャッシュを持たない理由と同根）と矛盾し、dagdo の個人利用中心という利用規模(`req.md` §3.1)に見合わない複雑さを持ち込む

この割り切りは第 9 章でも非目標として明記する。

---

## 6. ルート保護

### 6.1 middleware.ts の位置づけ

`docs/frontend-design.md` 第 4 章が定めるとおり、`middleware.ts` は `src/` 直下（`app/` の外）に配置する。
本設計書は、この `middleware.ts` を「軽量な楽観的ガード」に限定する設計とする（`docs/frontend-design.md` 第 13 章が未決事項として残していた項目を解決する）。

### 6.2 database strategy と middleware の制約

Session strategy を database とした（第 3.3 節）ことにより、セッションの真正性を検証するには `next_auth.sessions` を参照する DB アクセスが必要になる。
一方、Next.js の `middleware.ts` は既定で Edge Runtime 上で実行される。
本設計では、Edge 上で動作する middleware から Adapter 経由の DB 参照は行わない。

理由は、Edge Runtime から Supabase Data API への都度アクセスを挟むと、すべてのページ遷移・すべての Server Action 呼び出しの手前に DB ラウンドトリップが発生し、レイテンシとコストの両面で不利になるためである。
また、middleware 内で認可を完結させようとすると、認可ロジックが middleware と RSC/Server Action の 2 箇所に重複しやすく、`docs/db-design.md` 第 2 章が示す「データ整合性の最終防衛線は常に DB 側にある」という設計原則(`req.md` §75)とも位置づけが重なってしまう。

### 6.3 楽観的ガードの実装方針

`middleware.ts` はセッション cookie の存在チェックのみを行い、存在しない場合に `/login` へリダイレクトする。
cookie の値そのものの真正性（署名検証や `next_auth.sessions` との突き合わせ）は検証しない。

```typescript
// src/middleware.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const SESSION_COOKIE_NAMES = ["authjs.session-token", "__Secure-authjs.session-token"] as const;

export const middleware = (request: NextRequest): NextResponse => {
    const hasSessionCookie = SESSION_COOKIE_NAMES.some((name) => request.cookies.has(name));

    if (!hasSessionCookie) {
        return NextResponse.redirect(new URL("/login", request.url));
    }

    return NextResponse.next();
};

export const config = {
    matcher: ["/((?!login|api/auth|_next/static|_next/image|favicon.ico).*)"],
};
```

cookie 名を 2 つ見るのは、Auth.js v5 が HTTP と HTTPS で異なる名前を使うためである。
ローカル開発（HTTP）では `authjs.session-token`、Vercel 本番などの HTTPS 環境では secure cookie prefix 付きの `__Secure-authjs.session-token` になる。
どちらか一方だけを見ると、その環境では cookie を持つログイン済みユーザーが常に `/login` へ飛ばされる。

matcher は次のパスを除外する。

- `/login`: 未ログインユーザーの遷移先そのものであり、リダイレクトループを避けるため除外する
- `/api/auth/*`: Auth.js の route handler（GitHub OAuth のコールバック等）。認証フロー自体を middleware でブロックしないよう除外する
- `/_next/static/*` / `/_next/image/*`: Next.js の静的アセット配信経路
- `favicon.ico`: 静的ファイル

matcher の除外に `/trash` は含めない。
ゴミ箱もログイン済みユーザー専用のルートであるため、他のアプリケーションルートと同じく楽観的ガードの対象とする。

### 6.4 二段構えで認可する理由

真の認可は次の 2 段で行う。

1. **RSC / Server Action 層での `auth()` によるセッション検証**: `auth()` を呼ぶと、Adapter が session cookie の値で `next_auth.sessions` を検索し、レコードの存在と有効期限を確認したうえで `session.user.id` を返す。ここで初めてセッションの真正性が検証される
2. **DB 層の RLS**: `auth()` から得た `session.user.id` を基に発行した Custom JWT（第 5 章）を用いて Supabase Data API へアクセスし、`user_id = next_auth.uid()` という RLS 条件で行レベルの認可を行う(`req.md` §40〜43)

middleware の cookie 存在チェックをすり抜けた（あるいは middleware 自体が到達しない）リクエストがあったとしても、RSC/Server Action 層の `auth()` がセッションを検証できなければ `session` は `null` となり、Server Action はそこで処理を継続できない。
さらに万一 `auth()` の検証を経ずに Custom JWT が発行される経路が実装上できてしまったとしても、RLS は `next_auth.uid()` と `user_id` の一致を独立に検証するため、他ユーザーのデータへアクセスすることはできない。
すなわち middleware は UX 上の最適化（未ログインユーザーを早期に `/login` へ導く）に過ぎず、RLS が認可の最終防衛線であるという位置づけを本設計書の前提とする。

---

## 7. 認可

### 7.1 RLS と複合 FK の二重分離

dagdo は allowlist を設けず(`req.md` §3.1)、認可を RLS と `user_id` 付き複合 FK の二重で保証する(`req.md` §39〜43)。

RLS は `public.tasks` / `public.task_dependencies` の両方で有効化し(`req.md` §40)、基本条件を次のとおりとする(`req.md` §40)。

```sql
user_id = next_auth.uid()
```

`tasks` テーブルは `(user_id, id)` の UNIQUE 制約を持ち、`parent_id` への参照は `(user_id, parent_id)` から `(user_id, id)` への複合 FK として定義する(`req.md` §37)。
`task_dependencies` も同様に `(user_id, task_id)` / `(user_id, depends_on_task_id)` を `(user_id, id)` への複合 FK として定義する(`req.md` §38)。
これにより、RLS が万一機能しない経路（例えば別ユーザーの `id` を誤って `parent_id` に指定するような操作）があったとしても、複合 FK が異なるユーザーのタスク間の関連付けを構造的に拒否する(`req.md` §39)。
RLS と FK のどちらか一方が破られても、もう一方がユーザー間の分離を保証するという二重構成である(`req.md` §75 原則 6)。

RLS Policy の詳細（SELECT / INSERT / UPDATE / DELETE の各条件）は `docs/db-design.md` 第 10 章に既に定義済みであり、本文書では重複させない。

### 7.2 role = authenticated

Custom JWT の `role` クレームは `"authenticated"` に固定する（第 5.1 節、`req.md` §34）。
RLS Policy は `to authenticated` を対象ロールとして定義されており(`req.md` §41〜43)、Custom JWT の `role` クレームと一致させることで、Supabase Data API が該当リクエストを Postgres の `authenticated` ロールとして実行する。

### 7.3 RPC の execute 権限

RPC Function については実行権限を明示的に設定する(`req.md` §58)。

```sql
revoke execute
on function ...
from public, anon;

grant execute
on function ...
to authenticated;
```

`anon`（未認証ロール）および `public` からの実行権限を明示的に剥奪し、`authenticated` ロールにのみ許可する(`req.md` §58)。
これは Custom JWT を持たないリクエスト（未ログインユーザー、または Custom JWT を発行していない経路）から `move_task` 等の RPC(`req.md` §52) が呼び出せないようにするための権限設定であり、RLS とは別の防御層として機能する。

### 7.4 createTask における user_id 信頼境界

`createTask` Server Action は、クライアント入力の `user_id` を信用しない(`req.md` §60)。
信頼できる `user_id` の取得経路は次の 1 本のみとする(`req.md` §60)。

```text
Auth.js session.user.id (auth()で検証済み)
       ↓
Custom JWT の sub クレーム
       ↓
next_auth.uid() (RLS Policy内で解決)
```

クライアントから送られてきた `user_id` パラメータが存在したとしても、それを INSERT 文にそのまま用いない。
必要であれば Server Action 側で明示的に session user ID を設定し(`req.md` §60)、RLS の `with check (user_id = next_auth.uid())`(`req.md` §42) がこの経路以外で作られた `user_id` を伴う INSERT を拒否する。
`updateTask` 等の他の Server Action についても同様に、`user_id` はこの経路からのみ取得し、クライアント入力を経由させない（`createTask` に限らず全 Server Action 共通の原則として適用する）。

---

## 8. 環境変数一覧

| 変数名 | 用途 | 使用箇所 | 管理場所 |
|---|---|---|---|
| `AUTH_SECRET` | Auth.js が cookie の署名・CSRF トークン生成等に用いる秘密鍵（Auth.js 標準の必須環境変数） | `src/auth.ts` | ローカル: `.env.local` / 本番: Vercel 環境変数 |
| `AUTH_GITHUB_ID` | GitHub OAuth App のクライアント ID | `src/auth.ts`（GitHub Provider） | 同上 |
| `AUTH_GITHUB_SECRET` | GitHub OAuth App のクライアントシークレット | `src/auth.ts`（GitHub Provider） | 同上（Vercel ではサーバー専用変数として扱う） |
| `SUPABASE_URL` | Supabase プロジェクトの URL | `src/auth.ts`（Adapter）、`lib/supabase/app-client.ts`、`lib/supabase/service-client.ts`（第 5.4 節、現状は未使用） | 同上 |
| `SUPABASE_PUBLISHABLE_KEY` | Todo データアクセス用の publishable key(`req.md` §36) | `lib/supabase/app-client.ts` | 同上 |
| `SUPABASE_SECRET_KEY` | Auth.js Adapter 専用の secret key(`req.md` §36) | `src/auth.ts`（Adapter）、`lib/supabase/service-client.ts`（同上） | 同上（Vercel ではサーバー専用変数として扱い、クライアントバンドルへ含めない） |
| `SUPABASE_JWT_SECRET` | Custom JWT の署名鍵（HS256、Supabase プロジェクトの legacy JWT secret）(`req.md` §34) | `lib/supabase/custom-jwt.ts` | 同上（Vercel ではサーバー専用変数として扱う） |

`SUPABASE_SECRET_KEY` と `SUPABASE_JWT_SECRET` はいずれもクライアントバンドルに含めてはならない値であり、`NEXT_PUBLIC_` 接頭辞を付けない（Next.js の環境変数公開規則に基づく注意点であり、`req.md` には明記されていない）。

ローカル開発用の `.env.local` は `scripts/setup-env-local.sh`（`make env-local`、`make setup` に含まれる）が `supabase status` の出力から生成する。
`AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` はコメントアウトされた状態で書き出されるため、GitHub ログインを使うにはコメントを外して実値を設定する（`docs/github-oauth-setup.md` 第 5 章）。
本番の Vercel 環境変数の設定手順は `docs/deploy.md` 第 11 章が扱う。

---

## 9. セキュリティ上の非目標・割り切り

本設計書が明示的に「やらない」と決める事項を次に列挙する。

- **allowlist を設けない**(`req.md` §3.1)。GitHub OAuth でログインできた任意のアカウントを受け入れる。データの混在防止は RLS と複合 FK によるユーザー単位分離で行う(`req.md` §3.1, §39)
- **Custom JWT の失効管理を持たない**（第 5.5 節）。発行から約 5 分の自然失効のみに依存し、失効リストやブラックリストは実装しない
- **middleware すり抜けを許容する**（第 6.4 節）。middleware は cookie 存在チェックのみの楽観的ガードであり、これをすり抜けるリクエストがあっても RLS が最終防衛線として機能する設計とする。middleware 自体の堅牢化（署名検証・DB 照合の追加）は行わない
- **ログイン試行のレート制限を独自実装しない**。GitHub OAuth のレート制限・不正アクセス対策は GitHub 側に委ねる
- **多要素認証（MFA）を実装しない**。GitHub アカウント側の MFA 設定に依存する
- **認証イベントの監査ログを持たない**。ログイン履歴やセッション一覧の閲覧・強制ログアウト等の管理機能は設けない
- **GitHub access token をアプリケーション側で保持・利用しない**(`req.md` §33)。Auth.js Adapter が `next_auth.accounts` に保存する値をそのまま外部 API 呼び出し等へ転用しない

---

## 10. 未決事項

本文書は Auth.js・`next_auth` schema・Custom JWT・ルート保護・認可の設計を定めるが、次の項目は決まっていない。

- **JWT signing keys の新方式（非対称鍵）への移行**。現状は legacy JWT secret による HS256（第 5.3 節）である。hosted プロジェクトでは legacy 鍵を revoke してはならないという制約が確認されている（`docs/deploy.md` 第 6 章）。非対称鍵へ移行するかどうか、その場合の `custom-jwt.ts` の変更範囲は決めていない
- **`next_auth` schema への `anon` GRANT を維持するか**（第 4.4 節）。他ユーザーのデータが読める状態にはならないが、`anon` を外せるかどうかは検討していない
- **`next_auth.verification_tokens` の扱い**（第 4.1 節）。GitHub OAuth のみを使う構成では利用しないテーブルであり、schema から落とすかどうかは決めていない
- **`middleware.ts` を Node.js Runtime で動かすか**（第 6.2 節）。Edge Runtime 前提で cookie 存在チェックに留める現在の設計を変えるかどうかは決めていない

次の 3 項目は本文書の姉妹文書が解決している。

- `next_auth` schema の exposed schemas 設定（第 4.3 節）: ローカルは `supabase/config.toml:13`、hosted は `docs/deploy.md` 第 5 章
- GitHub OAuth App の dev/prod 分離運用: `docs/github-oauth-setup.md` 第 3 章
- ローカル Supabase 環境での認証確認手順: `docs/github-oauth-setup.md` 第 6 章

---

## 11. 用語集

| 用語 | 説明 |
|---|---|
| **Auth.js** | Next.js 等で使われるオープンソースの認証ライブラリ（旧称 NextAuth.js）。本文書は v5 系を前提とする |
| **GitHub OAuth** | GitHub アカウントを用いた OAuth 2.0 ログイン方式 |
| **`@auth/supabase-adapter`** | Auth.js の永続化層を Supabase PostgreSQL へ委譲する公式 Adapter パッケージ。npm パッケージとして SQL は配布せず、`next_auth` schema の定義は利用側が用意する（第 4.2 節） |
| **next_auth schema** | Auth.js の認証情報（users / accounts / sessions / verification_tokens）を保存する PostgreSQL schema(`req.md` §31) |
| **next_auth.uid()** | Custom JWT の `sub` クレームから Auth.js user UUID を解決する SQL 関数(`req.md` §35)。定義は本リポジトリの migration が持つ（第 4.2 節） |
| **Custom JWT** | Next.js Server Action から Supabase Data API へアクセスする際に都度発行する短命 JWT。Auth.js Session とは別物(`req.md` §33, §34) |
| **session strategy** | Auth.js がセッションをどこに保持するかの方式。本文書は database strategy（`next_auth.sessions` にセッションを永続化する方式）を採用する |
| **jose** | JWT の生成・検証を行う JavaScript/TypeScript ライブラリ |
| **HS256** | HMAC-SHA256 による JWT の対称鍵署名アルゴリズム |
| **RLS** | Row Level Security。PostgreSQL の行単位アクセス制御機構(`req.md` §40) |
| **RPC** | Remote Procedure Call。本文書では Supabase Data API 経由で呼び出す PostgreSQL Function を指す(`req.md` §52, §58) |
| **Data API** | Supabase が PostgreSQL の前段に提供する PostgREST ベースの REST API 層 |
| **exposed schemas** | Supabase の Data API が外部公開の対象とする PostgreSQL schema の一覧。既定は `public` のみであり、`next_auth` を追加する設定が必要になる（第 4.3 節） |
| **publishable key** | Supabase Data API へアクセスするためのクライアント向け鍵。Todo データアクセス用の app-client が使用する(`req.md` §36) |
| **secret key** | Supabase Data API へサーバー権限でアクセスするための鍵。Auth.js Adapter 専用の service-client が使用する(`req.md` §36) |
| **Edge Runtime** | Next.js の middleware 等が既定で実行される、Node.js とは別の軽量な実行環境 |
| **RSC** | React Server Component。サーバー側でのみ実行され、クライアントへは描画結果のみを送るコンポーネント |
| **楽観的ガード** | 本文書における `middleware.ts` の位置づけを指す語。cookie の存在のみを見て未ログインユーザーを早期にリダイレクトするが、真の認可判断は行わない（第 6 章） |

---

- 対象リポジトリ: dagdo
- 対象コミット: a9b61ed
- 作成日: 2026-08-08
- 更新日: 2026-08-13
- 生成者: Claude Code
