# entodo フロントエンド技術設計書

- 対象リポジトリ: entodo
- 対象コミット: 90c9c84
- 作成日: 2026-08-08
- 生成者: Claude Code

本文中、req.md に根拠を持つ記述には `(req.md §NN)` を付ける。
それ以外の記述は本設計書が下す設計判断であり、既に確定済みの前提（UI モック検討・技術選定）と、本設計書が新たに提案する事項の二種類を含む。
前者は「確定事項」として断定で書く。
後者は「提案」と明記し、未確定であることを示す。

## 目次

1. [サマリ](#1-サマリ)
2. [技術スタック一覧](#2-技術スタック一覧)
3. [コード規約](#3-コード規約)
4. [ディレクトリ構成](#4-ディレクトリ構成)
5. [状態設計](#5-状態設計)
6. [キーボード設計](#6-キーボード設計)
7. [コンポーネント構成](#7-コンポーネント構成)
8. [データフロー](#8-データフロー)
9. [dnd-kit 設計](#9-dnd-kit-設計)
10. [テーマ実装](#10-テーマ実装)
11. [テスト方針](#11-テスト方針)
12. [依存パッケージ一覧](#12-依存パッケージ一覧)
13. [未決事項](#13-未決事項)
14. [用語集](#14-用語集)

---

## 1. サマリ

本文書は Todo アプリ **entodo** のフロントエンド技術設計を定める。
対象は Next.js アプリケーション側の実装方針であり、DB スキーマ・RLS・Trigger・RPC 自体の設計は対象外とする（それらは `req.md` に既に定義済みであり、本文書はそれを消費する側の設計を扱う）。

決定事項は次の 3 系統からなる。

UI については、4 ラウンドのモック検討によりアウトライナー基盤 + vim ライクキーボード操作、PC 2 ペイン構成、クールグレー×ブルーの配色が確定済みであり、本文書はこれを前提として構成・実装方式へ落とし込む。

技術選定については、クライアント状態に **Zustand**、サーバー状態に **Server Actions + `useOptimistic` + revalidate**、Markdown に **react-markdown + remark-gfm**、並べ替えに **dnd-kit** を採用することが確定済みであり、本文書はこれらの配置場所と責務分割を定める。

規約については、本書が定めるコード規約（第 3 章）に従う。
entodo は単一アプリ・単一リポジトリであり、DB 型は `supabase gen types typescript` の生成型で扱う。

本文書がカバーする範囲は、コード規約、ディレクトリ構成、状態設計（Zustand ストアとサーバー状態の境界）、キーボード操作のディスパッチ方式、コンポーネント構成と依存レール／DAG の描画設計、データフローとエラー契約、dnd-kit の適用方式、テーマトークン、テスト方針、依存パッケージである。
Auth.js の設定詳細、Custom JWT 生成の実装、Supabase Migration 構成など DB・認証寄りの詳細設計（`req.md` §74 の一部）は対象外とし、第 13 章に未決事項として列挙する。

---

## 2. 技術スタック一覧

| 分類 | 採用技術 | バージョン方針 | 備考 |
|---|---|---|---|
| アプリケーションフレームワーク | Next.js（app router） | 最新 stable を実装開始時点で採用し、以後は破壊的変更を確認した上で計画的に追従する（提案） | サーバーレスで Vercel へデプロイする(req.md §1, §73) |
| 言語 | TypeScript | Next.js の peer 要件に合わせる（提案） | 型は `supabase gen types typescript` の生成型を正とする |
| ランタイム | Node.js | 22 固定 | `.node-version` で固定する（第 3 章） |
| UI ライブラリ | React + React Compiler | Next.js 同梱バージョンに追従 | 手書き `useMemo`/`useCallback` を禁止する（第 3 章） |
| スタイリング | Tailwind CSS v4 | v4 系最新 | `@theme` トークンでデザイントークンを管理する |
| UI コンポーネント | shadcn/ui | CLI で都度生成するためパッケージバージョン固定は行わない | style=new-york / baseColor=neutral / iconLibrary=lucide |
| クライアント状態管理 | Zustand | 最新 stable | カーソル・vim モード・折りたたみ・選択範囲のみを保持する（第 5 章） |
| サーバー状態 | Server Actions + `useOptimistic` + revalidate | Next.js 同梱 API のみで構成し追加のデータ取得ライブラリを導入しない | RSC 初回取得を正とする |
| Markdown | react-markdown + remark-gfm | 最新 stable | textarea 編集とプレビュー切替の二画面方式とする |
| 並べ替え | dnd-kit（`@dnd-kit/core` / `@dnd-kit/sortable`） | 最新 stable | キーボード代替（J/K/`<`/`>`）と共存させる（第 9 章） |
| データベース | Supabase PostgreSQL | Supabase 側の管理に従う | Data API・RLS・View・Trigger・RPC を利用する(req.md §2.2) |
| DB 型生成 | `supabase gen types typescript` | Supabase CLI に追従 | 手書き DB 型を禁止する（第 3 章） |
| 認証 | Auth.js（NextAuth）+ GitHub OAuth + `@auth/supabase-adapter` | Auth.js v5 系 | Auth.js session と Supabase Custom JWT を分離する(req.md §30, §33) |
| Lint / Format | biome | 本書が定める設定に従う（第 3 章） | スペース 4 / 200 桁 / ダブルクォート / セミコロン必須 |
| 型検査 | tsc | Next.js が要求するバージョンに追従 | 品質ゲートの型検査はこちらを正とする |
| 死蔵検出 | knip | 最新 stable | 生成物（shadcn 生成物・`database.types.ts`）は対象外とする |
| ビルド検証 | `next build` | Next.js 本体に追従 | 型検査も同時に走る |
| テスト | vitest + @testing-library/react、Playwright | 最新 stable | 単体はストア・keymap・tree 構築 util、E2E は主要フローのみ（第 11 章） |
| デプロイ（アプリ） | Vercel | 無料枠内での運用を想定する(req.md §73) | |
| デプロイ（DB） | Supabase | 無料枠内での運用を想定する(req.md §73) | |

---

## 3. コード規約

本章は entodo 自身が定めるコード規約である（確定事項）。
第 2 章以降で「（第 3 章）」として参照する規約は、すべて本章を指す。
外部リポジトリの規約を参照・継承する構成は取らず、本章のみで自己完結する。

### 3.1 biome

- インデントはスペース 4 とする
- 1 行の最大文字数は 200 文字とする
- 文字列リテラルはダブルクォートとする
- 文末のセミコロンを必須とする

### 3.2 TypeScript

- 関数宣言より arrow function を優先する。コンポーネントも named const の arrow function で定義する
- 複数の引数を取る関数は分割代入で受け取る
- 引数と返り値の型を明示する
- interface より type を優先する。宣言マージが必要な場合に限り interface を用いる
- `let` より `const` を優先する
- for ループより `for...of` を優先する
- Promise チェーンより async/await を優先する
- 公開関数・公開コンポーネント・非自明な型には最低限の JSDoc を付与する
- コメント・JSDoc は日本語で書き、ログ・エラーメッセージは英語で書く
- コメント・JSDoc の日本語文末に冗長な句点（。）を付けない

### 3.3 React

- React Compiler を有効にするため、手書きの `useMemo` / `useCallback` を禁止する

### 3.4 shadcn/ui

- `src/components/ui/` は shadcn CLI による生成物であり、CLI 管理下に置く
- 手編集を禁止する
- lint / format の対象外とする

### 3.5 DB 型

- `supabase gen types typescript` が生成する型を正とする
- 手書きの DB 型を禁止する

### 3.6 品質ゲート

次の 4 コマンドをすべて通過することを品質ゲートとする。

- `biome check`
- `tsc`
- `knip`
- `next build`

---

## 4. ディレクトリ構成

entodo は単一アプリ・単一リポジトリであり、npm workspaces によるパッケージ分割を行わない（提案）。
shadcn/ui もアプリを跨いだ共有パッケージ化はせず、`src/components/ui/` に直接生成する（提案。単一アプリ構成のため、UI コンポーネントを別パッケージへ分離する必要がないことによる）。

ディレクトリ構成は feature ベースとし、outline（アウトライナー本体）・task-detail（詳細ペイン）・dag（ローカル DAG）・search（検索）・trash（ゴミ箱）・auth（認証 UI）・task（タスクエンティティ操作の Server Actions）の 7 feature に分割する（提案）。

```text
src/
  app/                              # App Router（Server Component が既定）
    layout.tsx                      # 全体レイアウト。セッション確認とテーマ変数の注入
    globals.css                     # Tailwind v4 @theme トークン定義（第 10 章）
    page.tsx                        # メイン画面 (RSC)。app_tasks / task_dependencies を並列取得
    login/
      page.tsx                      # ログイン画面 (req.md §30 の /login)
    trash/
      page.tsx                      # ゴミ箱専用ルート (RSC)。deleted_at IS NOT NULL のみ取得
    api/
      auth/[...nextauth]/route.ts   # Auth.js route handler

  middleware.ts                     # src/ 直下 (app/ の外)。未ログイン時に /login へリダイレクト（詳細は第 13 章）

  features/
    outline/                        # アウトライナー本体
      components/
        outline-pane.tsx            # 左ペイン全体 (Client Component)
        outline-row.tsx             # 1 行（バレット+タイトル+期日チップ+🔒）
        dependency-rail.tsx         # ガターの依存レール SVG
        status-line.tsx             # モード・件数などを表示するステータス行
      hooks/
        use-outline-keymap.ts       # NORMAL/VISUAL/SEARCH のディスパッチ (第 6 章)
        use-row-refs.ts             # 行 DOM 位置測定用の ref Map 管理 (第 7 章)
      lib/
        build-tree.ts               # app_tasks + task_dependencies → 表示順フラットリスト構築
        flatten-for-dnd.ts          # dnd-kit 用のフラット化 + depth 投影 (第 9 章)

    task-detail/                    # 右ペイン上部・モバイル詳細シート
      components/
        detail-pane.tsx             # PC 右ペイン上部
        markdown-editor.tsx         # textarea 編集
        markdown-preview.tsx        # react-markdown + remark-gfm プレビュー
        blocked-reason-bar.tsx      # blocked 理由バー
        mobile-detail-sheet.tsx     # モバイル用詳細シート

    dag/                            # 右ペイン下部の常設ローカル DAG
      components/
        dag-panel.tsx               # 高さ 220px の DAG コンテナ
        dag-svg.tsx                 # ノード・エッジの SVG 描画
      lib/
        compute-local-subgraph.ts   # カーソルタスクから ±2 ホップの部分グラフ抽出

    search/
      components/
        search-overlay.tsx          # `/` で開く検索オーバーレイ
      lib/
        filter-tasks.ts             # title/description 部分一致フィルタ (req.md §28 相当をクライアント側で反映)

    trash/
      components/
        trash-view.tsx              # ゴミ箱一覧
        trash-row.tsx

    auth/
      components/
        login-button.tsx            # GitHub OAuth ログインボタン
      lib/
        get-session-user.ts         # Server Action から呼ぶセッション取得 util

    task/                           # タスクエンティティに対する Server Actions（req.md §59 の 11 Action）
      actions/
        create-task.ts
        update-task.ts
        complete-task.ts
        reopen-task.ts
        move-task.ts
        reorder-tasks.ts
        add-dependency.ts
        remove-dependency.ts
        soft-delete-task.ts
        restore-task.ts
        permanently-delete-task.ts
      lib/
        action-result.ts            # ActionResult<T> と TaskErrorCode (第 8 章)
        map-db-error.ts             # DB エラー → TaskErrorCode 変換

  store/
    outline-store.ts                # Zustand ストア本体 (第 5 章)
    types.ts                        # OutlineMode 等の型

  lib/
    supabase/
      database.types.ts             # `supabase gen types typescript` 生成物。手編集禁止
      service-client.ts             # Auth.js Adapter 用 client（secret key）(req.md §36)
      app-client.ts                 # Todo データ用 client（publishable key + Custom JWT）(req.md §36)
      custom-jwt.ts                 # Custom JWT 生成 (req.md §34)
    date/
      timezone.ts                   # Asia/Tokyo 基準の「今日」「期限切れ」判定 util (req.md §6)

  components/
    ui/                             # shadcn/ui 生成物。手編集禁止・lint 除外（第 3 章）

  types/
    task.ts                        # database.types.ts から導出するドメイン型 alias
```

Server Actions は entity 単位（`task` feature）に集約し、UI 側の `outline` / `task-detail` / `dag` / `search` / `trash` 各 feature はこれを import して利用する（提案）。
理由は、11 個の Action が全て `tasks` / `task_dependencies` の 2 テーブルのみを操作し、エラー変換（`map-db-error.ts`）を共通化する必要があるためである。
一方で `moveTask` / `reorderTasks` は構造操作であり `outline` feature（dnd-kit・`</>`/`J`/`K` の起点）から直接呼ばれるが、実装自体は `task/actions/` に置き、呼び出し元を分けても実装を分けない。

Supabase client は `req.md` §36 が定める 2 種分離をそのままディレクトリへ反映する。
`service-client.ts` は Auth.js Adapter 内部専用であり、`task/actions/` からは参照しない。
`app-client.ts` は Server Action 内で毎リクエスト生成し、Custom JWT を都度払い出す想定とする（生成タイミングの詳細は第 13 章）。

`build-tree.ts` は「表示上のグルーピング」と「実際の構造操作」を区別する責務を持つ。
表示上の親子は `effective_parent_id` を用い、削除済み祖先を透明化する(req.md §22)。
一方で `moveTask` / `reorderTasks` が対象とする sibling group は常に実際の `parent_id`（actual parent）である(req.md §17, §26)。
`build-tree.ts` はこの 2 つを混同しないよう、表示順序を `sort_path` で決定しつつ(req.md §46)、構造操作の入力には actual parent の値をそのまま保持して返す。

Zustand ストアはどの feature にも属さない横断的な UI 状態であるため、`features/` の外の `src/store/` に置く（提案）。
`outline` / `task-detail` / `dag` / `search` の各コンポーネントが同一ストアを参照するため、単一 feature に閉じ込めない。

---

## 5. 状態設計

### 5.1 Zustand ストア設計

モードは `NORMAL` / `VISUAL` / `SEARCH` の 3 状態を持つステートマシンとして実装する（確定事項）。

```typescript
type OutlineMode = "NORMAL" | "VISUAL" | "SEARCH";

type OutlineState = {
    mode: OutlineMode;
    cursorTaskId: string | null;
    collapsedTaskIds: Set<string>;
    visualAnchorTaskId: string | null;
    visualSelectedTaskIds: Set<string>;
    searchQuery: string;
    flashNodeId: string | null;
};

type OutlineActions = {
    moveCursor: (direction: "up" | "down") => void;
    jumpToTop: () => void;
    jumpToBottom: () => void;
    toggleCollapsed: (taskId: string) => void;
    enterVisual: () => void;
    extendVisual: (direction: "up" | "down") => void;
    exitVisual: () => void;
    enterSearch: () => void;
    setSearchQuery: (query: string) => void;
    confirmSearch: () => void;
    cancelSearch: () => void;
    flashNode: (taskId: string) => void;
};
```

`jumpToTop` / `jumpToBottom` は `moveCursor` と同様に、呼び出し側（`dispatchKeymap`）が保持する表示順タスク ID 配列の先頭・末尾を参照して `cursorTaskId` を更新する（確定事項）。
タスクデータそのものをストアへ複製しない方針（第 5.2 節）は `moveCursor` と共通であり、この 2 アクションのために例外を設けない。

状態遷移表を以下に定める。

| 現在モード | イベント | 遷移先モード | 状態への作用 |
|---|---|---|---|
| NORMAL | `j` / `k` | NORMAL | `cursorTaskId` を隣接タスクへ更新 |
| NORMAL | `gg`（連続 2 打鍵で確定） | NORMAL | `cursorTaskId` をアウトライン表示順の先頭タスク ID へ更新 |
| NORMAL | `G` | NORMAL | `cursorTaskId` をアウトライン表示順の末尾タスク ID へ更新 |
| NORMAL | `C-d` / `C-u` | NORMAL | `cursorTaskId` を表示順で 10 行下 / 上のタスク ID へ更新（端を越える場合は端で留まる） |
| NORMAL | `{` / `}` | NORMAL | `cursorTaskId` を同じ actual parent の 1 つ前 / 後の兄弟へ更新（端の兄弟では動かさない） |
| NORMAL | `V` | VISUAL | `visualAnchorTaskId` = 現在の `cursorTaskId`、`visualSelectedTaskIds` = `{cursorTaskId}` |
| NORMAL | `/` | SEARCH | `searchQuery` を空文字で初期化 |
| NORMAL | `za` | NORMAL | `collapsedTaskIds` に対象 ID を追加 or 削除 |
| NORMAL | `zo` / `zc` | NORMAL | `collapsedTaskIds` から対象 ID を削除 / へ追加 |
| NORMAL | `zR` / `zM` | NORMAL | `collapsedTaskIds` を空集合へ / 子を持つ行の ID 集合へ置き換え（`zM` の対象 ID は `OutlineShell` が算出する。第 6.1 節） |
| VISUAL | `j` / `k` | VISUAL | `cursorTaskId` を移動し、anchor から cursor までの範囲で `visualSelectedTaskIds` を再計算 |
| VISUAL | `x` | NORMAL | 選択範囲の各タスクへ `completeTask` を実行後、選択を解除（第 6 章） |
| VISUAL | `Esc` | NORMAL | `visualAnchorTaskId` / `visualSelectedTaskIds` をクリア |
| SEARCH | 文字入力 | SEARCH | `searchQuery` を更新 |
| SEARCH | `Enter` | NORMAL | `searchQuery` を確定として保持したままオーバーレイを閉じる |
| SEARCH | `Esc` | NORMAL | `searchQuery` を空文字に戻しオーバーレイを閉じる |

モード遷移とタスクデータの読み書きは明確に分離する。
モード遷移はストア内で完結する同期的な状態更新であり、DB へのアクセスを伴わない。
`x`（完了）のような DB アクセスを伴う操作は、モード遷移とは独立したイベントハンドラ（第 6 章・第 8 章）が担当し、ストアへは `flashNode` などの表示補助のみを書き戻す。

### 5.2 サーバー状態との境界

タスクデータ（`title` / `description` / `completed_at` / `is_blocked` など）を Zustand ストアへ複製しない（確定事項）。
タスクデータは RSC（`app/page.tsx`）が取得した props として `OutlinePane` 系コンポーネントへ渡り、クライアント側では読み取り専用として扱う。
書き込みが必要な操作は Server Action を呼び、成功後の `revalidatePath` によって RSC から流れ直す props で真値を更新する。

楽観的更新は `useOptimistic` を用いて props 由来のタスク配列に対するオーバーレイとして実装する。
Zustand には「どのタスクにカーソルがあるか」「どの範囲が選択されているか」といった UI 座標的な状態のみを置き、タスクの内容そのものは一切保持しない。
この分離により、ストアのシリアライズ範囲が小さく保たれ、タスクデータの再取得（revalidate）とカーソル位置のようなセッション的な UI 状態が互いに独立して更新できる。

### 5.3 派生値

`is_blocked` は `app_tasks` View 側で算出される派生値であり(req.md §44, §75 原則 2)、クライアントで再計算しない（確定事項）。
表示順序は View が提供する `sort_path` にそのまま従い(req.md §46)、クライアント側で独自にソートし直さない。

例外として、楽観的更新中に限り「暫定的な blocked 解除」の計算をクライアント側で行う（確定事項として明記する例外）。
あるタスクを `completeTask` で楽観的に完了させた瞬間、そのタスクに依存する他タスクの `is_blocked` は本来サーバー側の再計算を待つ必要があるが、revalidate 完了までの間 UI 上は blocked のままに見えてしまう。
これを避けるため、`useOptimistic` のリデューサ内でのみ「完了させたタスク ID を depends_on に持つタスクの `is_blocked` を `false` として一時的に描画する」計算を行う。
この暫定値は revalidate 完了後にサーバー由来の値へ必ず置き換わり、正とはしない。

`DetailPane` の `BlockedReasonBar` が表示する「どのタスクに blocked にされているか」というテキストも同様にクライアント側の導出値だが、これは `is_blocked` フラグの正当性を左右する計算ではなく、`task_dependencies`(req.md §69) と手元の `app_tasks` 一覧を突き合わせて表示用の文言を組み立てるだけの提示ロジックである。
この計算が古くなった場合の影響は表示文言のずれにとどまり、`is_blocked` 自体の信頼性には影響しない。

---

## 6. キーボード設計

### 6.1 keymap 一覧

NORMAL モード。

| キー | 動作 | 備考 |
|---|---|---|
| `j` | カーソルを次の行へ | ストア内完結 |
| `k` | カーソルを前の行へ | ストア内完結 |
| `gg` | アウトライン先頭行へジャンプ | 連続 2 打鍵で確定（pending key 方式、第 6.2 節） |
| `G` | アウトライン末尾行へジャンプ | 単打で確定 |
| `{` | 前の兄弟へ移動（子孫をスキップ） | 同じ actual parent の 1 つ前の兄弟へカーソルを移す。端の兄弟では動かさない。兄弟の判定に `parent_id` が要るため、対象 ID の解決は `flatten-for-dnd.ts` の純粋関数 `findSiblingTaskId` が行い、`OutlineShell` が `setCursor` へ渡す（第 5.2 節） |
| `}` | 次の兄弟へ移動（子孫をスキップ） | 向きが逆であること以外は `{` と同じ |
| `C-d` | カーソルを 10 行下へ | `visibleTaskIds` の添字を +10 する。画面の高さは実測せず固定行数とする（予測可能性と実装コストを優先する判断）。Chrome のブックマーク追加と衝突するが `preventDefault` で奪う |
| `C-u` | カーソルを 10 行上へ | `visibleTaskIds` の添字を -10 する。Chrome のソース表示と衝突するが `preventDefault` で奪う |
| `x` | 完了 | `completeTask` を呼ぶ。blocked の場合 `TASK_BLOCKED` エラーを受けトースト表示し DAG の原因ノードを点滅させる |
| `o` | 新規タスク作成（下） | カーソル行の下に同じ actual parent の兄弟として `createTask`。挿入位置は `createTask` が兄弟グループ末尾へ作ったうえで `move_task` RPC(req.md §54) へ委ねる（兄弟の position をずらす更新を 1 トランザクションにまとめるため） |
| `O` | 新規タスク作成（上） | カーソル行の上に同じ actual parent の兄弟として `createTask`。挿入位置の扱いは `o` と同じ |
| `i` | タイトルの行内編集（先頭） | カーソル行のタイトルを行内編集する。キャレットは先頭（第 6.4 節） |
| `A` | タイトルの行内編集（末尾） | カーソル行のタイトルを行内編集する。キャレットは末尾（第 6.4 節） |
| `Enter` | 選択行の編集 | フォーカスを `DetailPane` の編集領域へ移す（タイトルの行内編集は `i` / `A` で行う） |
| `za` | 折りたたみ切替 | ストア内完結。DB アクセスなし |
| `zo` / `zc` | カーソル行の折りたたみを開く / 閉じる | ストア内完結。`za` と同じく `collapsedTaskIds` の 1 要素の出し入れ |
| `zR` | すべて展開 | ストア内完結（`collapsedTaskIds` を空集合にするだけ） |
| `zM` | すべて折りたたむ | 「子を持つ行」の判定に木構造が要るため、対象 ID の算出だけ `OutlineShell` が行い（`collectCollapsibleTaskIds`）、ストアへは ID の集合を渡す。`zR` と置き場所が非対称なのはストアへタスクデータを複製しないため（第 5.2 節） |
| `J` | 同一 parent 内で 1 つ下へ移動 | `reorderTasks` |
| `K` | 同一 parent 内で 1 つ上へ移動 | `reorderTasks` |
| `<` | 親を 1 階層上げる（outdent） | `moveTask` |
| `>` | 親を 1 階層下げる（indent。直前行を新しい親にする） | `moveTask` |
| `V` | ビジュアルモードへ | 第 5.1 節参照 |
| `dd` | ゴミ箱へ移動 | `softDeleteTask`。連続 2 打鍵で確定する（vim の `dd` に倣う。pending key 方式、第 6.2 節） |
| `/` | 検索モードへ | 第 5.1 節参照 |
| `?` | キーバインドのヘルプを表示 | ヘルプオーバーレイを開く。表示内容は keymap テーブルから生成する（第 6.3 節） |
| `u` | undo | V1 のスコープ外とする（提案。`req.md` に undo の記載はなく、本設計書で明示的に対象外とする） |

VISUAL モード。

| キー | 動作 | 備考 |
|---|---|---|
| `j` / `k` | 選択範囲を拡張 | anchor から cursor までを選択とする |
| `x` | 範囲一括完了 | 選択された各タスクへ順に `completeTask` を実行し、失敗したタスクがあれば「N 件中 M 件を完了」の部分成功トーストを出す |
| `Esc` | NORMAL へ戻る | 選択を解除 |

SEARCH モード。

| キー | 動作 | 備考 |
|---|---|---|
| 文字入力 | クエリ更新 | IME 変換確定前は `isComposing` を見て無視する |
| `Enter` | 確定 | NORMAL へ戻り、クエリによる絞り込み表示を維持する |
| `Esc` | キャンセル | クエリを破棄して NORMAL へ戻る |

### 6.2 イベント処理方式

キーボード操作は単一の `keydown` ハンドラで受け、`store.mode` に応じてディスパッチする方式とする（確定事項）。
実装は `features/outline/hooks/use-outline-keymap.ts` に集約し、`OutlineShell` がマウント時に 1 つだけ登録する。

```typescript
const useOutlineKeymap = (): void => {
    const mode = useOutlineStore((state) => state.mode);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent): void => {
            if (event.isComposing) {
                return;
            }
            if (isEditableTarget(event.target)) {
                return;
            }
            dispatchKeymap(mode, event);
        };

        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    }, [mode]);
};
```

`isEditableTarget` は `event.target` が `input` / `textarea` / `contenteditable` 要素であるかを判定する util であり、`MarkdownEditor` や `SearchOverlay` の入力欄にフォーカスがある間はグローバル keymap を無効化する。

キーの一覧・説明・動作は宣言的テーブル `features/outline/lib/keymap-table.ts` を単一の正とする（確定事項）。
第 6.1 節の 3 表がそのままエントリの配列になっており、dispatcher はこのテーブルから構築した trie だけを読む。
テーブルに無いキーが処理されることはなく、ヘルプ表示もこのテーブルから生成する。

```typescript
type KeymapEntry = {
    keys: string; // スペース区切りのキーシーケンス表現（"j" / "g g" / "z a" / "C-d"）
    mode: OutlineMode;
    category: KeymapCategory; // ヘルプでのグルーピング用（移動 / 編集 / 行内編集 / 構造変更 / 折りたたみ / モード / ヘルプ）
    description: string; // ヘルプ表示用の説明
    run?: (context: KeymapContext) => void; // 省略時はヘルプにのみ表示する
};
```

`keys` の区切りをスペースにしているのは、`<` `>` のように単体でキーが割り当てられている文字をエスケープなしで書けるようにするため。
修飾キーは基底キーの前へ `C-`（Control）/ `A-`（Alt）/ `M-`（Meta）を付ける。
Shift は接頭辞にしない（`J` や `<` のように `event.key` へ既に反映されているため）。
`run` を任意にしているのは、行内編集中の `Esc` / `Enter` のように「コンポーネント側のローカルハンドラが処理するが、ヘルプには載せたいキー」を同じテーブルへ含めるためである。

`run` を持たないエントリ（ドキュメント専用エントリ）は trie に載せない（確定事項）。
dispatcher が読むのは `dispatchableKeymap`（`outlineKeymap` から `run` を持つものだけを抜いた派生）である。
除く理由は、同じ `mode` + `keys` が文脈違いで 2 度現れうるためである。
NORMAL の `Enter` は、行にフォーカスがあるときは `DetailPane` へ移り（第 6.1 節）、行内編集中は編集を確定する（第 6.4 節）。
前者だけが dispatcher の担当であり、後者は input のローカルハンドラが処理する。
文脈の違いは `category` が表すため、ヘルプ側の識別子（React の `key`）も `mode` + `category` + `keys` とする。

`gg`（第 6.1 節）と `dd`（第 6.1 節）と `z` で始まる各キー（`za` / `zo` / `zc` / `zR` / `zM`、第 6.1 節）は、1 回の `keydown` だけでは確定可否を判定できない（確定事項）。
これらはテーブルの `keys` から構築した prefix tree（trie）で扱う（確定事項）。
入力トークン列を trie の根から辿り、次の 3 通りに解決する。

- 完全一致するエントリのノードに到達した: そのエントリの `run` を実行する
- エントリのプレフィックスに一致した: 待機状態にして次のキーを待つ
- どのエントリにも繋がらない: **その入力を破棄し**、待機状態を解除する

待機のタイムアウトは 500ms とする（`PENDING_KEY_TIMEOUT_MS`）。
時間切れ後の入力は、通常どおり先頭から解決し直す。

3 番目の「破棄」は vim の挙動に倣ったものであり、プレフィックス待機中の未マッチキーが素通りする誤爆（`d` → `x` でタスクが完了し、続く `d` で削除まで走る）を防ぐ。
破棄時は `preventDefault` しない。keymap に無いキー（`Ctrl+R` 等）のブラウザ既定動作を奪わないためである。

trie の構築（`buildKeymapTries`）と 1 打鍵ぶんの待機状態遷移（`advanceKeySequence`）は `features/outline/lib/keymap-trie.ts` の純粋関数として実装し、DOM やタイマーに依存せず単体テストできるようにする。
待機状態そのものは UI 描画に影響しない値であるため、Zustand ストアには置かず、`use-outline-keymap.ts` 内部の `useRef` で保持する（確定事項）。
ストアに置かない理由は、待機状態の変化のたびにストア購読コンポーネントを再レンダリングする必要がなく、`useOutlineKeymap` 自身だけが参照できれば足りるためである。

### 6.3 キーバインドのヘルプオーバーレイ

`?`（第 6.1 節）で開くヘルプの表示内容は、keymap テーブルを `mode` → `category` でグルーピングして生成する（確定事項）。
ヘルプ側にキー一覧を直書きすると二重管理になり drift するためである。
変換は `features/outline/lib/keymap-help.ts` の `buildKeymapHelpSections` に純粋関数として置き、表示は `features/outline/components/keymap-help-overlay.tsx` が担う。
`keys` は `parseKeySequence`（第 6.2 節）でトークンへ分解し、1 トークン = 1 つの `kbd` として描画する。
`run` を持たないエントリも表示対象に含める（`run` を任意にしている目的がヘルプへの掲載であるため）。

開閉状態は `OutlineShell` のローカル state が持ち、`OutlineMode` にモードを追加しない（確定事項）。
モードを増やすと store・dispatcher・StatusLine の全体に状態機械が波及するのに対し、ヘルプは裏の状態を一切変えない一時的な表示にすぎないためである。

閉じるキー `q` / `Esc`（`HELP_CLOSE_KEYS`）は、テーブルではなく dispatcher 先頭のガードで処理する（確定事項）。
テーブルのエントリは `mode` でしか文脈を区別できず、「ヘルプ表示中だけ効く」という文脈をモードを増やさずに表現できないためである。
このガードはヘルプ表示中に閉じるキー以外の入力をすべて破棄し、オーバーレイの裏でカーソルが動くことを防ぐ。
破棄時に `preventDefault` しないのは、第 6.2 節の「破棄」と同じ理由による。

表示中は `OutlineShell` の背面要素（ヘッダ・2 ペイン・`MobileDetailSheet`）へ `inert` を付ける（確定事項）。
`role="dialog"` と `aria-modal="true"` で「背面は不活性」と宣言している以上、`Tab` で背面へ抜けられる状態は宣言と矛盾するためである。
加えて抜けた先が `textarea` の場合は `isEditableTarget`（第 6.2 節）が dispatcher の手前で return するため、`q` / `Esc` で閉じられなくなる実害がある。
`MobileDetailSheet` が閉じている間に使っている `inert` と同じ道具で揃える。

### 6.4 タイトルの行内編集

`i` / `A`（第 6.1 節）はカーソル行のタイトルを行内編集する。
キャレット位置は vim に倣い `i` が先頭、`A` が末尾とする（`DetailPane` のタイトル編集が全選択にしているのとは使い分ける）。
確定は `Enter` または blur、取り消しは `Esc` とする。
`Enter` による確定は NORMAL に戻すだけとし、`DetailPane` へは連鎖させない（移りたい場合は改めて `Enter` を押す）。
空文字（トリム後）は DB 制約 `tasks_title_not_blank` の CHECK 違反になり `TaskErrorCode` へ変換できないため、送信前にクライアント側で弾いてインラインにエラーを出す（第 8.2 節の `DetailPane` と同じ理由）。
blur 時に空文字だった場合は保存できないため取り消し扱いとし、元のタイトルへ戻す。
確定時に値が変わっていなければ `updateTask` を呼ばずに編集だけを畳む（blur 確定で無駄な Server Action が飛ぶのを防ぐ）。
確定した新しいタイトルは `useOptimistic`（第 5.2 節）でも重ねる。revalidate が届くまでの間、確定直後の行が編集前のタイトルへ一瞬戻って見えるのを防ぐためである。

編集状態は `OutlineShell` のローカル state が `{ taskId, caret }`（null 許容）という 1 個の値として持つ（確定事項）。
`OutlineMode` に `INSERT` を足さず、Zustand ストアにも置かない。
モードなしで成立するのは、グローバル keymap の抑止を `isEditableTarget`（第 6.2 節）が DOM のフォーカス先で行っているためである。
編集中はフォーカスが input にあるので `j` / `k` は発火せず、「カーソルは動いたが編集対象は元の行のまま」という同期のずれが構造的に起きない。
第二の状態機械（`editingMode` 等）は作らない。将来 `cc`（タイトル全体を置き換える）を足す場合も `caret` の値を増やすだけに留める。

フォーカス制御は次の 2 点を守る（確定事項）。これを誤るとフォーカスが `body` へ落ち、キー入力が一切効かなくなる。

- 編集開始時は callback ref で input へ即座にフォーカスし、`caret` に応じたキャレット位置を `setSelectionRange` で設定する。`useEffect` にしないのは、編集状態が立ってから実際にフォーカスが移るまでの隙間に `j` が滑り込むのを防ぐためである
- 編集終了時（確定・取り消しの両方）は、編集状態を畳む前に行の要素（`tabIndex={-1}` を持つ `role="option"`）へ明示的にフォーカスを戻す。ただし blur 由来の終了では既に別の要素へフォーカスが移っているため戻さない

編集中に別の行がクリックされてカーソルが移動した場合は編集状態を解除する。
`OutlineShell` がレンダー中の state 調整（`lastCursorTaskId` との比較）で行い、`useEffect` による同期にはしない。

編集中の行が表示行の集合から消えた場合も同じくレンダー中の state 調整で編集状態を解除する（確定事項）。
`zM` / `zc`（第 6.1 節）による折りたたみや検索の絞り込みは表示行の集合を変えるため、input が unmount されたまま編集状態だけが残りうるためである。
キー経由でこの状態に入ることはない（編集中はフォーカスが input にあり dispatcher が `isEditableTarget` で素通しする）が、折りたたみボタンのクリックのようにキーボード以外の経路があるため、カーソル移動による解除とは別に表示行の集合とも突き合わせる。

キー入力は input のローカルハンドラで処理し、行や祖先へは伝播させない（`stopPropagation`）。
行（`OutlineRow`）の `onKeyDown` が `Enter` / `Space` をカーソル選択として拾い `preventDefault` するため、そのままでは入力欄に空白を打てないためである。
IME 変換確定の `Enter` / `Esc` は `isComposing` を見て編集の確定・取り消しと取り違えない（`SearchOverlay` と同じ扱い）。

---

## 7. コンポーネント構成

### 7.1 コンポーネントツリーと Server/Client 境界

```text
app/page.tsx                          [Server Component]
  → app_tasks / task_dependencies を並列取得し build-tree.ts でフラットリスト化
  └ OutlineShell                      [Client Component] ("use client")
      ├ OutlinePane                   [Client]
      │   ├ DependencyRail            [Client] (SVG)
      │   └ OutlineRow (繰り返し)      [Client]
      ├ DetailPane                    [Client]
      │   ├ MarkdownPreview           [Client]
      │   ├ MarkdownEditor            [Client]
      │   └ BlockedReasonBar          [Client]
      ├ DagPanel                      [Client] (SVG)
      ├ StatusLine                    [Client]
      ├ SearchOverlay                 [Client] (mode === "SEARCH" のとき表示)
      ├ KeymapHelpOverlay             [Client] (? で開く。開閉は OutlineShell のローカル state。第 6.3 節)
      └ MobileDetailSheet             [Client] (モバイル幅のとき DetailPane の代わりに表示)

app/trash/page.tsx                    [Server Component]
  → deleted_at IS NOT NULL のタスクを取得
  └ TrashView                         [Client Component]
      └ TrashRow (繰り返し)            [Client]

app/login/page.tsx                    [Server Component]
  └ LoginButton                       [Client Component]
```

データ取得と初期描画は Server Component（`page.tsx` 系）に閉じ、以降のインタラクション（キーボード・DnD・楽観更新・SVG 描画）を担う部分はすべて Client Component とする。
`OutlineShell` を境界コンポーネントとし、これより下は "use client" を再宣言しない（App Router の Client Component 境界の伝播に従う）。

### 7.2 依存レール・DAG の SVG 描画設計

`DependencyRail`（ガター）と `DagPanel`（右ペイン下部）はいずれも「行または ノードの画面上の座標」を必要とする SVG 描画であり、同じ設計方針を採る（提案）。

行の DOM 位置測定には、`OutlineRow` がマウント時に自身の `HTMLElement` を `Map<taskId, HTMLElement>` へ登録する ref コールバック方式を用いる。
このマップは `features/outline/hooks/use-row-refs.ts` が保持し、`OutlinePane` のスクロールコンテナに対する `getBoundingClientRect()` の差分から各行の相対 y 座標を算出する。

再描画のタイミングは次の 4 種とし、いずれのタイミングで用いる間引き方式にするかを 3 段階に整理する（確定事項）。
`ResizeObserver` 起因の再計算には、必ず適切なデバウンスを入れる（確定事項）。

- マウント時（初回描画）: 間引きなしで即時に描画する
- スクロールイベント時: `requestAnimationFrame` によるスロットリングとし、フレームあたり 1 回に制限する（確定事項。方針自体はベース案から変更なし）
- `ResizeObserver` によるコンテナサイズ変化時（主にウィンドウリサイズのバースト対策）: トレーリングデバウンス 100ms を入れる（確定事項）
- 折りたたみ開閉などアプリ操作起因の単発変化、および `revalidatePath` 後の props 更新・楽観的更新の適用/巻き戻しなどツリー構造が変化した時: デバウンスを挟まず即時に再計算する（確定事項）

この 3 段構成は、発火源ごとに連続発火の性質が異なることに基づく（確定事項）。
スクロールは高頻度かつ滑らかな追従が要求されるため、rAF で 1 フレームに 1 回へ抑える。
ウィンドウリサイズは短時間に多数の `ResizeObserver` コールバックがバースト発生するため、トレーリングデバウンスで最後の 1 回だけを処理し、無駄な再計算を避ける。
一方、折りたたみ開閉やツリー構造変化はユーザー操作や revalidate に対応した単発のイベントであり、間引く対象となる連続発火が発生しないため、デバウンスを挟まず結果を即時に反映する。

折りたたみ操作はコンテナの高さ変化を伴うため `ResizeObserver` のコールバックも副次的に発火しうるが、当該コールバック経由の再計算は上記のトレーリングデバウンス（100ms）に従わせる。
即時反映が必要なのは、折りたたみ操作のイベントハンドラ自身が明示的に呼び出す再計算であり、`ResizeObserver` 経由の再計算とは呼び出し経路を分ける（確定事項）。

`DagPanel` はさらに `compute-local-subgraph.ts` によりカーソルタスクから ±2 ホップの部分グラフを抽出してからノード座標を計算する。
ホップ数の限定は、依存グラフ全体を毎回レイアウトし直すコストを避けるための設計判断であり、カーソル移動（`j`/`k`）に追従して都度再抽出する。

---

## 8. データフロー

### 8.1 初回ロード

```text
app/page.tsx (RSC)
  ↓ Promise.all
  ├ app_tasks を取得         (req.md §44, §69)
  └ task_dependencies を取得 (req.md §69)
  ↓
build-tree.ts (サーバー側 util)
  - effective_parent_id で表示グルーピング (req.md §22)
  - sort_path で表示順序を決定 (req.md §46)
  - actual parent_id / position を構造操作用に保持 (req.md §17)
  ↓
OutlineShell へ props として渡す
```

`app_tasks` と `task_dependencies` は個別に取得し、Task View に dependency 配列を埋め込む設計は取らない(req.md §69)。
関連付けはアプリケーション側（`build-tree.ts` および `compute-local-subgraph.ts`）で行う。

### 8.2 操作の流れ（`completeTask` を例に）

```text
1. keydown ("x", NORMAL) → dispatchKeymap
2. useOptimistic: cursorTaskId の completed_at を楽観的に確定
   + 依存先が cursorTaskId であるタスクの is_blocked を暫定 false に (第 5.3 節の例外)
3. startTransition(() => completeTask(cursorTaskId))
4a. 成功
    - Server Action 内で revalidatePath を呼ぶ (req.md §71)
    - RSC が再取得した実データで useOptimistic のオーバーレイが解消される
4b. 失敗 (TASK_BLOCKED)
    - 楽観的更新をロールバック
    - トースト表示 ("このタスクは依存先が未完了です" 相当)
    - store.flashNode(原因タスク ID) → DagPanel が該当ノードを点滅表示
```

### 8.3 エラー契約

`req.md` §66 が定める `TaskErrorCode` をそのまま採用する(req.md §66)。

```typescript
type TaskErrorCode =
    | "TASK_NOT_FOUND"
    | "TASK_PARENT_CYCLE"
    | "TASK_DEPENDENCY_CYCLE"
    | "TASK_BLOCKED"
    | "DEPENDENCY_ALREADY_EXISTS"
    | "INVALID_POSITION"
    | "INVALID_PARENT";
```

全 Server Action の戻り値を discriminated union の `ActionResult<T>` で統一する（提案）。

```typescript
type ActionResult<T> =
    | { ok: true; data: T }
    | { ok: false; code: TaskErrorCode; message: string };
```

`message` は英語のログ用文言とし（第 3 章）、UI 表示用の日本語文言は呼び出し側（keydown ハンドラ・トースト表示層）が `code` を見て組み立てる。
DB から返るエラー（Postgres エラーコードや RPC 例外メッセージ）から `TaskErrorCode` への変換は `task/lib/map-db-error.ts` に集約し、Server Action 本体にエラー文字列の判定ロジックを重複させない(req.md §71 の「DB エラー変換」をこの 1 箇所に置く設計)。

---

## 9. dnd-kit 設計

ツリーへの適用方針は、フラット化リスト + depth 投影方式とする（確定事項）。
`build-tree.ts` が生成する「actual parent 情報を保持したフラットリスト」に対し、`flatten-for-dnd.ts` が各行へ `depth`（= actual parent を辿った階層数）を付与し、dnd-kit の `useSortable` が扱える線形リストへ変換する。

ドラッグ中は、ポインタの水平方向オフセットから目標 depth を投影し、その depth に対応する新しい actual parent と挿入位置（新しい position）を算出する。
ドロップ確定時、算出結果に応じて次のいずれかを呼ぶ。

- actual parent が変わらない場合: `reorderTasks`
- actual parent が変わる場合: `moveTask`

キーボード代替（`J`/`K`/`<`/`>`）は、この算出結果を得る前段（新しい parent・position を決める部分）を dnd-kit のドラッグ操作と共有し、同じ `moveTask` / `reorderTasks` を呼ぶ（提案）。
共有の理由は、ドラッグ経路とキーボード経路で「同じ構造変更を表す入力」から異なる Server Action 呼び出しロジックが生まれることを避けるためであり、`features/outline/lib/` に置く「新 parent・新 position を決定する純粋関数」を両者から呼ぶ形にする。

---

## 10. テーマ実装

確定済みパレット(4 ラウンドのモック検討で確定)を Tailwind v4 の `@theme` トークンへ次の対応で落とす（確定事項）。

| CSS 変数名 | 値 | 用途 |
|---|---|---|
| `--color-bg` | `#ffffff` | 背景（基本） |
| `--color-bg-alt` | `#eef1f5` | 背景（サブ領域。右ペイン等） |
| `--color-bg-sunken` | `#e3e7ee` | 背景（沈み込み表現。DAG パネル等） |
| `--color-text` | `#1b2433` | 本文テキスト |
| `--color-text-dim` | `#5b6472` | 補助テキスト |
| `--color-border` | `#dde2ea` | 罫線・区切り |
| `--color-accent` | `#2454c9` | アクセント（カーソル行・リンク等） |
| `--color-blocked` | `#b45309` | blocked 表示（🔒・BlockedReasonBar） |
| `--color-overdue` | `#dc2626` | 期限切れ期日チップ |
| `--color-done` | `#97a1b0` | 完了済みタスクのグレーアウト |
| `--radius-base` | `6px` | 角丸 |

V1 における実装は上表のとおり、`--color-*` に直接 16 進値を割り当てる単層構成とする。

hover 時のみ極薄 shadow を付与する仕様(確定事項)は、専用の shadow トークンを常設せず、Tailwind のユーティリティクラス（`hover:shadow-sm` 相当）で表現し、`@theme` トークン化しない（提案。hover 限定の一時的な視覚効果であり、テーマ切替対象にする必要がないため）。

ダークモード対応は V1 では実装しないが、将来の対応を見据えてトークン設計を二層構造にしておくことを設計上の前提とする（確定事項）。
具体的には、上表の値を「パレット層」（`--palette-*`）として定義し、`--color-*` はパレット層を参照する「セマンティック層」として定義する（確定事項）。
将来ダークモードを追加する際は `--palette-*` 側の値を `prefers-color-scheme: dark` や `data-theme="dark"` で差し替えるだけで済み、コンポーネント側が参照する `--color-*` の名前は変更しない。

この前提から次の規則を定める（確定事項）。

- コンポーネントは常にセマンティック層（`--color-*`）のみを参照し、パレット層（`--palette-*`）や生の 16 進値を直接参照してはならない

---

## 11. テスト方針

単体テストは vitest + @testing-library/react を用いる（確定事項）。
対象は次の 3 領域とする（提案）。

- `outline-store.ts` のモード遷移（第 5.1 節の状態遷移表をそのままテストケース化する）
- `use-outline-keymap.ts` の keymap ディスパッチ（各モードでの各キー入力が正しい action を呼ぶか。`gg`/`dd` の pending key 判定（第 6.2 節）を含む）
- `build-tree.ts` / `flatten-for-dnd.ts` のツリー構築 util（`effective_parent_id` によるグルーピング、`sort_path` 順序、depth 投影）

E2E は Playwright を用い、V1 では主要キーボードフローに絞る（確定事項）。
対象は「`j`/`k` でのカーソル移動」「`x` による完了とその revalidate」「blocked タスクを `x` した際の `TASK_BLOCKED` エラー表示」「`V` によるビジュアルモードでの範囲一括完了と部分成功トースト」の 4 シナリオとする（提案）。
DnD 操作の E2E は V1 のスコープに含めない（提案。dnd-kit のポインタ操作は E2E での再現コストが高く、キーボード代替の E2E で構造変更ロジック自体は検証できるため）。

---

## 12. 依存パッケージ一覧

### 12.1 dependencies

| パッケージ | 採用理由 |
|---|---|
| `next` | アプリケーションフレームワーク本体(req.md §2.1) |
| `react` / `react-dom` | Next.js の UI ランタイム |
| `zustand` | クライアント状態管理として確定済み（第 5 章） |
| `@dnd-kit/core` | dnd-kit のドラッグ&ドロップ基盤 |
| `@dnd-kit/sortable` | フラット化リストの並べ替え（第 9 章） |
| `@dnd-kit/modifiers` | ドラッグ時の軸制限・投影補助 |
| `react-markdown` | description の Markdown プレビュー(req.md §7) |
| `remark-gfm` | GFM 記法（テーブル・チェックリスト等）への対応 |
| `next-auth` | Auth.js 本体(req.md §30) |
| `@auth/supabase-adapter` | Auth.js の永続化を `next_auth` schema へ委譲(req.md §31, §43) |
| `@supabase/supabase-js` | Supabase Data API クライアント(req.md §2.2) |
| `jose` | Custom JWT の署名・生成(req.md §34) |
| `class-variance-authority` | shadcn/ui コンポーネントのバリアント管理（shadcn 標準依存） |
| `clsx` | クラス名結合（shadcn 標準依存） |
| `tailwind-merge` | Tailwind クラスの重複解決（shadcn 標準依存） |
| `lucide-react` | shadcn/ui のアイコンライブラリ設定(iconLibrary=lucide) |
| `sonner` | トースト表示（blocked エラー・部分成功通知に使用） |

### 12.2 devDependencies

| パッケージ | 採用理由 |
|---|---|
| `typescript` | 型検査・型定義言語 |
| `@types/node` / `@types/react` / `@types/react-dom` | 型定義 |
| `tailwindcss` / `@tailwindcss/postcss` | Tailwind v4 本体とビルド統合 |
| `@biomejs/biome` | Lint / Format（第 3 章） |
| `knip` | 死蔵コード検出 |
| `vitest` | 単体テストランナー |
| `@testing-library/react` / `@testing-library/jest-dom` | コンポーネント・フックの単体テスト |
| `jsdom` | vitest のブラウザ API モック環境 |
| `@playwright/test` | E2E テスト |
| `supabase` (CLI) | `supabase gen types typescript` によるDB型生成、local Supabase 環境 |
| shadcn CLI（`shadcn@latest` を都度 `npx` 実行） | UI コンポーネント生成。常設の devDependency としては固定しない（提案） |

---

## 13. 未決事項

本文書はフロントエンドの構成・状態設計・UI 実装方式を定めるが、次の項目は決定していない。
これらは主に `req.md` §74 が「今後の詳細設計項目」として挙げているものであり、DB・認証側の実装と並行して確定させる必要がある(req.md §74)。

- Auth.js の詳細設定（Provider オプション、コールバック実装、`next_auth` schema とのマッピングの具体的なコード）
- Custom JWT 生成処理の具体的な実装（署名鍵の管理方法、有効期限の値、発行タイミングの詳細）(req.md §34)
- Supabase Migration の構成（migration ファイルの分割方針、local Supabase 環境のセットアップ、seed data）(req.md §74)
- DB Test の実装（`req.md` §74 が列挙する cycle 判定・blocked・復元・cross-user 制約のテストケース）
- Server Action からの Custom JWT 発行タイミングとキャッシュ方針（リクエスト毎に発行するか、セッション内で使い回すか）
- Cache / revalidate 方針の細部（`revalidatePath` の対象パス粒度、`trash` ルートとの整合）
- `middleware.ts` によるルート保護の具体的な実装（未ログイン時のリダイレクト先、除外パス）
- モバイルのロングタップ複数選択の正確な閾値・視覚フィードバックの詳細
- `u`（undo）を V1 スコープ外とする方針の最終合意（本設計書での提案であり、確定事項ではない）

---

## 14. 用語集

| 用語 | 説明 |
|---|---|
| **アウトライナー** | 階層構造を持つ箇条書きをインデントで表現し、折りたたみ・並べ替えを主な操作とする UI 形式。本アプリではタスクツリーの主表示形式として採用する |
| **依存レール** | アウトラインのガター（行頭余白）に描く git graph 風の SVG。タスク間の依存関係を縦方向のレーンとして表示する |
| **ローカル DAG** | 右ペイン下部に常設する、カーソルタスクから ±2 ホップの範囲に限定した依存グラフ（DAG: Directed Acyclic Graph、有向非巡回グラフ）の可視化パネル |
| **ビジュアルモード** | vim のビジュアルモードに倣った範囲選択モード。`V` で開始し、`j`/`k` で選択範囲を拡張する |
| **keymap テーブル** | キーの一覧・説明・動作を宣言的な配列で保持する単一の正（`features/outline/lib/keymap-table.ts`）。dispatcher もヘルプ表示もこのテーブルだけを読む（第 6.2 節） |
| **pending key（待機状態）** | `gg` や `dd` のような複数打鍵で確定する操作を判定するため、プレフィックスまで一致したトークン列とその打鍵時刻を一時的に保持する仕組み。keymap フック（`use-outline-keymap.ts`）内部の `useRef` で保持し、Zustand ストアには置かない（第 6.2 節） |
| **パレット層** | Tailwind v4 のテーマトークンにおいて、具体的な色の 16 進値を保持する `--palette-*` 層。将来のダークモード対応時にこの層の値を差し替える設計とする（第 10 章） |
| **セマンティック層** | パレット層を参照し、用途（背景・テキスト・アクセント等）ごとの意味で名付けられた `--color-*` 層。コンポーネントは常にこの層のみを参照する（第 10 章） |
| **blocked** | 未完了かつ未削除の依存先が 1 件以上存在する未完了タスクの状態。DB には保存されず `app_tasks` View で動的に算出する(req.md §12, §44) |
| **Ready** | blocked ではない未完了タスクを指す UI 上の分類（本設計書内での呼称。DB 上の専用カラムは持たない） |
| **actual parent** | `tasks.parent_id` が実際に指す親タスク。削除済み祖先を透明化した表示上の親（`effective_parent_id`）と区別するための呼称(req.md §22, §26) |
| **effective_parent_id** | 削除済み祖先を飛ばして得られる、表示上の最も近い未削除祖先の ID。View 上でのみ算出し、DB カラムには保存しない(req.md §22) |
| **sort_path** | 削除済み祖先を透明化してもツリー上の元の順序を保てるよう、View 上で算出する integer 配列の派生値(req.md §46) |
| **RSC** | React Server Component。サーバー側でのみ実行され、クライアントへは描画結果のみを送るコンポーネント |
| **RLS** | Row Level Security。PostgreSQL の行単位アクセス制御機構(req.md §40) |
| **RPC** | Remote Procedure Call。本文書では Supabase 経由で呼び出す PostgreSQL Function を指す(req.md §52) |
| **IME** | Input Method Editor。日本語入力等の変換確定前状態を指し、`isComposing` によるキーイベント抑制の対象となる |

---

- 対象リポジトリ: entodo
- 対象コミット: 90c9c84
- 作成日: 2026-08-08
- 生成者: Claude Code
