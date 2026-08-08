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
npm install
npm run dev
```

`http://localhost:3000` を開く。

## 主なスクリプト

- `npm run dev` — 開発サーバー起動
- `npm run build` — 本番ビルド
- `npm run start` — 本番サーバー起動
- `npm run check` — biome check + tsc --noEmit + knip
- `npm run format` — biome check --write
