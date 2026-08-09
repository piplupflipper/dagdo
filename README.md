# entodo

entodo は、アウトライナー形式 + vim ライクなキーボード操作でタスクを管理する Todo アプリケーションである。Next.js (App Router) 上に構築し、データベースには Supabase PostgreSQL を用いる。要件定義は `req.md` に、フロントエンド技術設計は `docs/frontend-design.md` に記載する。

## ドキュメント

- 要件定義: [req.md](./req.md)
- フロントエンド技術設計: [docs/frontend-design.md](./docs/frontend-design.md)
- 認証設計: [docs/auth-design.md](./docs/auth-design.md)
- DB 設計: [docs/db-design.md](./docs/db-design.md)
- マイグレーション設計: [docs/migration-design.md](./docs/migration-design.md)

## セットアップ

Node.js は 22 系を使用する（`.node-version` 参照）。[mise](https://mise.jdx.dev/) 等のバージョンマネージャでのピン解決を推奨する。

```bash
make setup   # 依存インストール + ローカル Supabase 起動 + DB 構築 + 型生成 + .env.local 生成
make fe-dev  # 開発サーバー起動
```

`http://localhost:3000` を開く。
GitHub ログインには OAuth App の設定が必要（[docs/github-oauth-setup.md](./docs/github-oauth-setup.md) 参照）。
作成した Client ID / Secret は、`make setup` が生成した `.env.local` の `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` のコメントを外して設定する。

## 主な操作

操作はリポジトリルートの Makefile に集約している。一覧は `make help`。

- `make fe-dev` / `make fe-build` / `make fe-check` / `make fe-format` — Next.js アプリ
- `make db-start` / `make db-reset` / `make db-test` / `make db-types` — ローカル Supabase
- `make check` — 全品質ゲート（fe-check + db-test）
