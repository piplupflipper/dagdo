# dagdo GitHub OAuth App セットアップ手順書

- 対象リポジトリ: dagdo
- 対象コミット: a9b61ed
- 作成日: 2026-08-09
- 更新日: 2026-08-13
- 生成者: Claude Code

本文中、`docs/auth-design.md` に根拠を持つ記述には `(auth-design.md §NN)` を付ける。
それ以外の記述は本手順書が下す判断であり、そのうち運用の分岐を決めているものは「確定事項」と明記する。

本文書は `docs/auth-design.md` の補完文書である。
GitHub OAuth App の dev/prod 分離運用（第3章）と、ローカル Supabase 環境での認証確認手順（第6章）を本文書が定める。

## 目次

1. [サマリ](#1-サマリ)
2. [前提](#2-前提)
3. [dev/prod 分離の方針](#3-devprod-分離の方針)
4. [dev 用 OAuth App の作成手順](#4-dev-用-oauth-app-の作成手順)
5. [.env.local への設定](#5-envlocal-への設定)
6. [動作確認手順](#6-動作確認手順)
7. [prod 用 OAuth App](#7-prod-用-oauth-app)
8. [トラブルシューティング](#8-トラブルシューティング)
9. [セキュリティ上の注意](#9-セキュリティ上の注意)

---

## 1. サマリ

dagdo の認証は GitHub OAuth App を経由する(`docs/auth-design.md` §3.1)。
GitHub OAuth App は Authorization callback URL を 1 つしか登録できないため、ローカル開発用の `http://localhost:3000` と本番デプロイ先のドメインを 1 つの OAuth App で兼用できない（第3章で詳述する）。
本文書は、この制約を根拠に dev 用と prod 用で別々の OAuth App を作成する運用を確定事項とし、それぞれの作成手順・環境変数への設定手順・動作確認手順・トラブルシューティングを示す。

対象読者は dagdo のローカル開発環境および Vercel 本番環境をセットアップする開発者である。

---

## 2. 前提

dagdo は Auth.js v5 系（`next-auth`）の GitHub Provider を用いた OAuth 2.0 ログインを採用し、`@auth/supabase-adapter` により認証情報を Supabase PostgreSQL の `next_auth` schema へ保存する(`docs/auth-design.md` §1, §3)。
Provider 設定・Adapter 設定・session strategy・callback の詳細設計は `docs/auth-design.md` 第3章に定義済みであり、本文書では重複させない。
本文書が扱うのは、この Auth.js 設定が要求する GitHub OAuth App 自体を、GitHub 側でどう作成し、どう運用するかである。

---

## 3. dev/prod 分離の方針

**確定事項**: dagdo は dev 用と prod 用に、別々の GitHub OAuth App を作成する。

命名例は次のとおりとする。

| 用途 | Application name の例 |
|---|---|
| ローカル開発用 | `dagdo (dev)` |
| 本番用 | `dagdo` |

### 3.1 分離が必須である根拠

GitHub OAuth App は、Authorization callback URL を 1 つの App につき 1 つしか登録できない。
dagdo のローカル開発環境は `http://localhost:3000` で待ち受け、コールバック先は `http://localhost:3000/api/auth/callback/github` になる。
一方、本番環境は Vercel 上のドメインで待ち受け、コールバック先は `https://<Vercelのドメイン>/api/auth/callback/github` になる。
この 2 つの URL は起動するホスト（`localhost` と本番ドメイン）が異なるため、1 つの OAuth App の Authorization callback URL 欄には両方を同時に登録できない。

したがって、ローカル開発と本番デプロイを 1 つの OAuth App で兼用することはできず、dev 用と prod 用の分離は事実上必須である。

### 3.2 callback URL のパス規約

コールバックパス `/api/auth/callback/github` は、Auth.js v5 の GitHub Provider が既定で要求するパスであり、dagdo では `src/app/api/auth/[...nextauth]/route.ts` の route handler がこのパスを含む `/api/auth/*` 配下のリクエストを受ける(`docs/auth-design.md` §3.6)。
dev 用・prod 用のいずれの OAuth App でも、ホスト部分のみが異なり、パス部分は共通してこの形式になる。

| 用途 | Authorization callback URL |
|---|---|
| dev | `http://localhost:3000/api/auth/callback/github` |
| prod | `https://<Vercelのドメイン>/api/auth/callback/github` |

---

## 4. dev 用 OAuth App の作成手順

GitHub の Settings → Developer settings → OAuth Apps → New OAuth App から作成する。

入力欄には次のとおり入力する。

| 入力欄 | 入力する値 |
|---|---|
| Application name | `dagdo (dev)` |
| Homepage URL | `http://localhost:3000` |
| Authorization callback URL | `http://localhost:3000/api/auth/callback/github` |

Application description は任意項目であり、dagdo の運用上は必須としない。

### 4.1 Client ID の確認

OAuth App の作成後、詳細画面に **Client ID** が表示される。
この値をそのまま控える。

OAuth App の Client ID は 20 桁の英数字である。
`Iv` で始まる Client ID (例: `Iv1.` / `Iv2` 始まり) は **GitHub App** のものであり、本手順書が前提とする OAuth App とは別物である。
GitHub の Developer settings では「GitHub Apps」と「OAuth Apps」が隣接したメニューにあるため、作成先を誤りやすい。
`Iv` 始まりの Client ID を控えていた場合は、OAuth Apps 側で作成し直す (第8章のトラブルシューティングも参照)。

### 4.2 Client Secret の生成

同じ詳細画面の **Generate a new client secret** ボタンから Client Secret を生成する。

生成直後の画面にのみ Client Secret の全体が平文で表示される。
この画面を閉じると再表示はできず、確認するには新しい Secret を再生成する必要がある。
そのため、生成直後にこの値をコピーし、次章の `.env.local` へ貼り付けるまでの間、他の場所に平文のまま保存しない。

---

## 5. .env.local への設定

`.env.local` は `make setup`（または `make env-local`）が `scripts/setup-env-local.sh` 経由で生成する。
このとき `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` の 2 行は**先頭に `#` が付いたコメントの状態で書き出される**(`scripts/setup-env-local.sh:49-50`)。

```text
# GitHub ログインに必要 (docs/github-oauth-setup.md の手順で OAuth App を作成後、
# コメントを外して実値を設定する。コメントのままなら未設定として扱われる)
#AUTH_GITHUB_ID=
#AUTH_GITHUB_SECRET=
```

前章で取得した dev 用 OAuth App の値を設定するには、この 2 行の `#` を外して値を書く。

```text
AUTH_GITHUB_ID=<dev 用 OAuth App の Client ID>
AUTH_GITHUB_SECRET=<dev 用 OAuth App の Client Secret>
```

コメントを外さないままだと 2 変数は未設定として扱われ、`/login` からのログインが失敗する。

`.env.local` は `.gitignore` の `.env*` に含まれ、リポジトリにコミットされない。
`AUTH_SECRET` / `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` / `SUPABASE_SECRET_KEY` / `SUPABASE_JWT_SECRET` は同スクリプトがローカル Supabase の接続情報から自動で書き出すため、本文書では扱わない(`docs/auth-design.md` §8)。

---

## 6. 動作確認手順

次の順序で確認する。

1. ローカル Supabase の稼働を確認する。

    ```sh
    make db-status
    ```

    `next_auth` schema を含むローカル Supabase が起動していない場合は、先に `make db-start` で起動する。

2. Next.js の開発サーバーを起動する。

    ```sh
    make fe-dev
    ```

3. ブラウザで `http://localhost:3000` を開く。

4. 未ログイン状態であるため `/login` へリダイレクトされる(`docs/auth-design.md` §6.3 が定める middleware の楽観的ガードによる)。

5. `/login` から GitHub でログインする。

6. GitHub の認可画面が表示される。
    要求されるスコープは Auth.js の GitHub Provider が既定で要求するスコープ（`read:user` + `user:email` 相当）であり、dagdo は追加のスコープを要求しない(`docs/auth-design.md` §3.1)。

7. GitHub 側で許可すると、dagdo のメイン画面が表示される。

8. Supabase Studio（`http://127.0.0.1:54323`）を開き、`next_auth.users` テーブルにログインしたアカウントの行が作成されていることを確認する。

---

## 7. prod 用 OAuth App

Vercel へデプロイする際は、dev 用とは別に prod 用の OAuth App を作成する（第3章で確定した方針による）。

### 7.1 作成手順の差分

第4章の手順と同様に GitHub の Settings → Developer settings → OAuth Apps → New OAuth App から作成するが、入力する値が異なる。

| 入力欄 | 入力する値 |
|---|---|
| Application name | `dagdo` |
| Homepage URL | `https://<Vercelのドメイン>` |
| Authorization callback URL | `https://<Vercelのドメイン>/api/auth/callback/github` |

Client ID の確認と Client Secret の生成は第4.1節・第4.2節と同じ手順である。

### 7.2 Vercel の環境変数への設定

Vercel の Settings → Environment Variables から、prod 用 OAuth App の Client ID / Client Secret を Production スコープで設定する。

| 変数名 | 値 |
|---|---|
| `AUTH_GITHUB_ID` | prod 用 OAuth App の Client ID |
| `AUTH_GITHUB_SECRET` | prod 用 OAuth App の Client Secret |

### 7.3 カスタムドメイン変更時の注意

Vercel のデプロイ先ドメイン（カスタムドメインを含む）を変更した場合、prod 用 OAuth App の Homepage URL と Authorization callback URL を新しいドメインに合わせて更新する必要がある。
更新を忘れると、ログイン時に第8章の redirect_uri mismatch エラーが発生する。

---

## 8. トラブルシューティング

| 症状 | 原因 | 対処 |
|---|---|---|
| GitHub の認可画面、またはコールバック後に `redirect_uri mismatch` エラーが表示される | OAuth App の Authorization callback URL と、実際にアクセスしているホストが一致していない | 該当環境（dev / prod）の OAuth App の Authorization callback URL を、実際のホストに合わせて修正する（第3.2節・第7.3節） |
| ログインボタンから GitHub へ遷移すると GitHub 側で 404 になる | `client_id` が authorize エンドポイントで受理されていない。典型的には OAuth App ではなく **GitHub App** を作成しており（Client ID が `Iv` 始まり、第4.1節）、GitHub App 側のユーザー認可 (Callback URL) が未構成 | OAuth Apps 側で作成し直して Client ID / Secret を差し替える（推奨）。GitHub App を使い続ける場合は App 設定の Identifying and authorizing users で Callback URL を設定する |
| ログイン試行後、GitHub の認可画面まで進まず認証エラーになる | `AUTH_GITHUB_ID` または `AUTH_GITHUB_SECRET` が誤っている、または未設定 | `.env.local`（dev）または Vercel の環境変数（prod）の値を、対応する OAuth App の Client ID / Client Secret と照合する |
| GitHub での認可後、dagdo 側で 500 エラーになる | `next_auth` schema が Supabase の Data API に公開されていない、または `SUPABASE_SECRET_KEY` が誤っている | `docs/auth-design.md` §4.3 の exposed schemas 設定を確認する。あわせて `SUPABASE_SECRET_KEY` の値を確認する |
| ログアウトしたはずのアカウントで再度ログインすると、以前のセッションのまま挙動する | ブラウザにセッション cookie が残っている | シークレットウィンドウ（プライベートブラウジング）で動作確認する |

---

## 9. セキュリティ上の注意

- Client Secret をリポジトリにコミットしない。`.env.local` は `.gitignore` の対象であり、コミットされないことを確認したうえで扱う（第5章）。
- Client Secret を Slack やチケットなど、リポジトリ外のチャネルであっても平文で共有しない。
- Client Secret が漏洩した、または漏洩した疑いがある場合は、該当する OAuth App の設定画面から Client Secret を revoke し、新しい Client Secret を再生成したうえで、dev 用・prod 用それぞれの環境変数を再生成後の値に差し替える。

---

- 対象リポジトリ: dagdo
- 対象コミット: a9b61ed
- 作成日: 2026-08-09
- 更新日: 2026-08-13
- 生成者: Claude Code
