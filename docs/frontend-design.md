# dagdo フロントエンド技術設計書

- 対象リポジトリ: dagdo
- 対象コミット: 2752573
- 作成日: 2026-08-08
- 更新日: 2026-08-13
- 生成者: Claude Code

本文書は dagdo のフロントエンドの現在の設計を述べる。
実装と一体で改訂する文書であり、記述と実装が食い違っている場合は実装を正とみなして本文書を直す。

本文中、`req.md` に根拠を持つ記述には `(req.md §NN)` を付ける。
それ以外の記述は本文書が下す設計判断であり、根拠となる実装ファイルのパスを併記する。
まだ決めていない事項は第 13 章に集約する。

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

本文書は Todo アプリ **dagdo** のフロントエンド技術設計を定める。
対象は Next.js アプリケーション側の実装方針であり、DB スキーマ・RLS・Trigger・RPC 自体の設計は対象外とする（それらは `req.md` に既に定義済みであり、本文書はそれを消費する側の設計を扱う）。

前提は次の 3 系統からなる。

UI は、4 ラウンドのモック検討で決めたアウトライナー基盤 + vim ライクキーボード操作、PC 2 ペイン構成である。
配色は mdblog-nextjs と同じ夜空パレットを用いた固定ダークテーマとし、テーマ切替は持たない（第 10 章）。

技術選定は、クライアント状態に **Zustand**、サーバー状態に **Server Actions + `useOptimistic` + revalidate**、Markdown に **react-markdown + remark-gfm**、並べ替えに **dnd-kit** である。
本文書はこれらの配置場所と責務分割を定める。

規約は本書のコード規約（第 3 章）に従う。
dagdo は単一アプリ・単一リポジトリであり、DB 型は `supabase gen types typescript` の生成型で扱う。

本文書がカバーする範囲は、コード規約、ディレクトリ構成、状態設計（Zustand ストアとサーバー状態の境界）、キーボード操作のディスパッチ方式、コンポーネント構成と依存レール／DAG の描画設計、データフローとエラー契約、dnd-kit の適用方式、テーマトークン、テスト方針、依存パッケージである。
Auth.js の設定詳細と Custom JWT 生成の実装は `docs/auth-design.md`、Supabase Migration の構成は `docs/migration-design.md` が扱う。

---

## 2. 技術スタック一覧

| 分類 | 採用技術 | バージョン方針 | 備考 |
|---|---|---|---|
| アプリケーションフレームワーク | Next.js（app router） | 最新 stable を採用し、以後は破壊的変更を確認した上で計画的に追従する | サーバーレスで Vercel へデプロイする(req.md §1, §73) |
| 言語 | TypeScript | Next.js の peer 要件に合わせる | 型は `supabase gen types typescript` の生成型を正とする |
| ランタイム | Node.js | 22 固定 | `.node-version` で固定する（第 3 章） |
| UI ライブラリ | React + React Compiler | Next.js 同梱バージョンに追従 | 手書き `useMemo`/`useCallback` を禁止する（第 3 章） |
| スタイリング | Tailwind CSS v4 | v4 系最新 | `@theme` トークンでデザイントークンを管理する |
| UI コンポーネント | なし（素の JSX + Tailwind ユーティリティ） | — | UI コンポーネントライブラリを導入しない（第 3 章） |
| クライアント状態管理 | Zustand | 最新 stable | カーソル・vim モード・折りたたみ・選択範囲・表示順 ID のみを保持する（第 5 章） |
| サーバー状態 | Server Actions + `useOptimistic` + revalidate | Next.js 同梱 API のみで構成し追加のデータ取得ライブラリを導入しない | RSC 初回取得を正とする |
| Markdown | react-markdown + remark-gfm | 最新 stable | textarea 編集とプレビュー切替の二画面方式とする |
| 並べ替え | dnd-kit（`@dnd-kit/core` / `@dnd-kit/sortable`） | 最新 stable | キーボード代替（J/K/`<`/`>`）と共存させる（第 9 章） |
| データベース | Supabase PostgreSQL | Supabase 側の管理に従う | Data API・RLS・View・Trigger・RPC を利用する(req.md §2.2) |
| DB 型生成 | `supabase gen types typescript` | Supabase CLI に追従 | 手書き DB 型を禁止する（第 3 章） |
| 認証 | Auth.js（NextAuth）+ GitHub OAuth + `@auth/supabase-adapter` | Auth.js v5 系 | Auth.js session と Supabase Custom JWT を分離する(req.md §30, §33) |
| Lint / Format | biome | 本書が定める設定に従う（第 3 章） | スペース 4 / 200 桁 / ダブルクォート / セミコロン必須 |
| 型検査 | tsc | Next.js が要求するバージョンに追従 | 品質ゲートの型検査はこちらを正とする |
| 死蔵検出 | knip | 最新 stable | 生成物（`database.types.ts`）と意図的未使用の factory（`service-client.ts`）のみ対象外とする（`knip.json`） |
| ビルド検証 | `next build` | Next.js 本体に追従 | `.next/types` を生成するため `tsc` の前提であり、品質ゲートの 1 段目に置く（第 3.6 節） |
| テスト | vitest + @testing-library/react | 最新 stable | 単体テストのみ。E2E は実装しない（第 11 章） |
| デプロイ（アプリ） | Vercel | 無料枠内での運用を想定する(req.md §73) | |
| デプロイ（DB） | Supabase | 無料枠内での運用を想定する(req.md §73) | |

---

## 3. コード規約

本章は dagdo 自身が定めるコード規約である。
設定の実体は `biome.json` / `tsconfig.json` / `knip.json` / `.node-version` にある。
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

### 3.4 UI コンポーネント

- UI コンポーネントライブラリを導入しない。ボタン・入力欄・オーバーレイはいずれも素の JSX と Tailwind ユーティリティで書く
- 例外は依存グラフと依存レールの SVG であり、これらは `features/dag/` / `features/outline/` が自前で描画する（第 7.2 節）

### 3.5 DB 型

- `supabase gen types typescript` が生成する型を正とする
- 手書きの DB 型を禁止する

### 3.6 品質ゲート

品質ゲートは `make check` が実行する 4 ターゲットとする（`Makefile:94`）。

```make
check: fe-build fe-check fe-test db-test
```

| 順序 | ターゲット | 実行内容 | 対象 |
|---|---|---|---|
| 1 | `fe-build` | `next build` | ビルド検証 |
| 2 | `fe-check` | `biome check && tsc --noEmit && knip` | lint / format・型検査・死蔵コード検出 |
| 3 | `fe-test` | `vitest run` | 単体テスト（第 11 章） |
| 4 | `db-test` | `supabase test db` | pgTAP（`docs/migration-design.md` 7章） |

`fe-build` を先頭に置くのは、`fe-check` の `tsc --noEmit` がビルド生成物へ順序依存するためである。
`src/app/layout.tsx:14` が使う `LayoutProps<"/">` は Next.js が `.next/types/routes.d.ts` へ生成するグローバル型であり、`tsconfig.json:25` の `include` がそれを拾うことで解決する。
`fe-build` が先に走ってこの生成型を用意することで、`.next` が無い状態から `make check` を叩いても `tsc` が通る。

この順序により `make setup` 直後や `rm -rf .next` 後でも `make check` は成立する。

---

## 4. ディレクトリ構成

dagdo は単一アプリ・単一リポジトリであり、npm workspaces によるパッケージ分割を行わない。

ディレクトリ構成は feature ベースとし、outline（アウトライナー本体）・task-detail（詳細ペイン）・dag（ローカル DAG）・search（検索）・trash（ゴミ箱）・auth（認証 UI）・task（タスクエンティティ操作の Server Actions とその周辺）の 7 feature に分割する。

各 feature の内部は `components/` / `hooks/` / `lib/` / `actions/` に分ける。
`lib/` には DOM にも React にも依存しない純関数だけを置き、単体テスト（第 11 章）はここを主な対象とする。
`components/` と `hooks/` は React に依存する層であり、判断のロジックは `lib/` へ切り出して薄く保つ。

feature 間の import は一方向に保つ。
`task-detail` は `outline` を import せず、両者が要る述語（`isSameLogicalRow`）や導出（`dependsOnTasksOf`）は中立な `task` feature へ置く。

テストファイル（`*.test.ts` / `*.test.tsx`）は対象と同じディレクトリに置く。
下のツリーでは省略する（一覧は第 11 章）。

```text
src/
  app/                              # App Router（Server Component が既定）
    layout.tsx                      # 全体レイアウト。夜空背景の設置と globals.css の読み込み
    globals.css                     # Tailwind v4 @theme トークン定義（第 10 章）
    page.tsx                        # メイン画面 (RSC)。getOutlineData → OutlineShell
    login/
      page.tsx                      # ログイン画面 (req.md §30 の /login)
    trash/
      page.tsx                      # ゴミ箱専用ルート (RSC)。deleted_at IS NOT NULL のみ取得
    api/
      auth/[...nextauth]/route.ts   # Auth.js route handler（src/auth.ts の handlers を re-export）

  auth.ts                           # Auth.js の設定本体 (docs/auth-design.md §3.6)
  middleware.ts                     # src/ 直下 (app/ の外)。未ログイン時に /login へリダイレクト (docs/auth-design.md §6)

  features/
    outline/                        # アウトライナー本体
      components/
        outline-shell.tsx           # クライアント境界。木の組み立てとレイアウト (第 7.1 節)
        outline-header.tsx          # 一覧上部のヘッダ（検索ボタン・V 切替・新規タスク・キーヒント）
        outline-pane.tsx            # 左ペイン全体（DndContext と行の一覧）
        outline-row.tsx             # 1 行（バレット+タイトル+期日チップ+🔒）
        inline-title-editor.tsx     # `i` / `A` の行内タイトル編集の input (第 6.4 節)
        dependency-rail.tsx         # ガターの依存レール SVG (第 7.2 節)
        pane-divider.tsx            # 2 ペインの幅比ドラッグハンドル (第 7.1 節)
        keymap-help-overlay.tsx     # `?` のヘルプオーバーレイ (第 6.3 節)
        status-line.tsx             # モード・件数・エラーを表示するステータス行
      hooks/
        use-outline-keymap.ts       # NORMAL/VISUAL/SEARCH のディスパッチ (第 6.2 節)
        use-outline-mutations.ts    # 書き換え操作の単一パイプライン `runOp` (第 5.2 節)
        use-pending-create.ts       # 楽観 create の tempId → 実 id 付け替えの調整 (第 5.2 節)
        use-row-refs.ts             # 行 DOM 位置測定用の ref Map 管理 (第 7.2 節)
      lib/
        build-tree.ts               # app_tasks → 表示順フラットリスト構築・折りたたみ反映
        flatten-for-dnd.ts          # dnd 用フラット化と新 parent・position の算出 (第 9 章)
        outline-ops.ts              # OutlineOp と楽観適用の純関数 applyOutlineOp (第 5.2 節)
        dispatch-op.ts              # OutlineOp → Server Action の振り分け callServerForOp
        invert-op.ts                # OutlineOp の逆操作を組み立てる invertOutlineOp
        sibling-rank.ts             # 同一 actual parent 内の現在 rank（逆操作の材料）
        undo-history.ts             # undo / redo の履歴スタック（純粋なスタック操作）
        action-error.ts             # ステータス行に出すエラー文言の組み立て (第 8.3 節)
        blocking-cause.ts           # TASK_BLOCKED の原因タスクを手元の依存関係から求める
        keymap-table.ts             # キー一覧の宣言的テーブル（単一の正、第 6.2 節）
        keymap-trie.ts              # テーブルから trie を構築し 1 打鍵ぶん遷移させる
        keymap-help.ts              # テーブルからヘルプの表示セクションを導く (第 6.3 節)
        key-sequence.ts             # キーシーケンス表現のトークン分解・整形
        inline-title-edit.ts        # 行内タイトル編集の状態型と判定 (第 6.4 節)
        pending-create-registry.ts  # tempId → 実 id の対応表・つなぎの行・行の論理キー・保留タイトルのキュー
        pane-ratio.ts               # ペイン比率の clamp と localStorage 値の解釈

    task-detail/                    # 右ペイン上部・モバイル詳細シート
      components/
        detail-pane.tsx             # PC 右ペイン上部。各フィールドの組み立てと編集状態の初期化
        title-field.tsx            # タイトルの表示と編集
        due-date-field.tsx         # 期日の表示と編集
        description-field.tsx      # 説明の表示と編集（プレビュー / エディタの切替）
        dependency-section.tsx     # 依存先の一覧・追加・削除
        markdown-editor.tsx        # textarea 編集
        markdown-preview.tsx       # react-markdown + remark-gfm プレビュー
        blocked-reason-bar.tsx     # blocked 理由バー
        mobile-detail-sheet.tsx    # モバイル用詳細シート（DetailPane と DagPanel を再利用）
      lib/
        task-status.ts             # completed_at / is_blocked から表示用状態を導く
        dependency-error.ts        # 依存操作の TaskErrorCode → 日本語文言

    dag/                            # 右ペイン下部の常設ローカル DAG
      components/
        dag-panel.tsx               # DAG コンテナ
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
      actions/
        sign-out.ts                 # signOut を呼ぶ Server Action
      components/
        login-button.tsx            # GitHub OAuth ログインボタン
        logout-button.tsx           # ステータス行に置くログアウトボタン
      lib/
        get-session-user.ts         # RSC / Server Action から呼ぶセッション取得 util

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
        define-task-action.ts       # Server Action の定型を集約する高階関数 (第 8.4 節)
        action-result.ts            # ActionResult<T> と TaskErrorCode (第 8.3 節)
        map-db-error.ts             # SQLSTATE / メッセージ → TaskErrorCode 変換 (第 8.3 節)
        queries.ts                  # RSC が呼ぶ読み取り関数 (第 8.1 節)
        depends-on-tasks.ts         # task_dependencies から依存先タスクの実体を引き直す
        temp-id-renames.ts          # tempId → 実 id の付け替えかを読む述語（outline / task-detail 共用）

  store/
    outline-store.ts                # Zustand ストア本体 (第 5.1 節)
    types.ts                        # OutlineMode の型

  lib/
    supabase/
      database.types.ts             # `supabase gen types typescript` 生成物。手編集禁止
      service-client.ts             # secret key の client。現状は未使用 (docs/auth-design.md §5.4)
      app-client.ts                 # Todo データ用 client（publishable key + Custom JWT）(req.md §36)
      custom-jwt.ts                 # Custom JWT 生成 (req.md §34)
    date/
      timezone.ts                   # Asia/Tokyo 基準の日付整形と「期限切れ」判定 (req.md §6)

  components/
    background/                     # 全ルート共通の固定夜空背景
      night-sky-background.tsx      # canvas と CSS フォールバックの DOM（Client Component）
      night-sky-renderer.ts         # WebGL シェーダー・描画ライフサイクル・省電力制御

  types/
    task.ts                         # database.types.ts から導出するドメイン型 alias
    next-auth.d.ts                  # session.user.id を足す型拡張 (docs/auth-design.md §3.4)
```

Server Actions は entity 単位（`task` feature）に集約し、UI 側の `outline` / `task-detail` / `dag` / `search` / `trash` 各 feature はこれを import して利用する。
理由は、11 個の Action が全て `tasks` / `task_dependencies` の 2 テーブルのみを操作し、エラー変換（`map-db-error.ts`）と定型処理（`define-task-action.ts`、第 8.4 節）を共通化する必要があるためである。
一方で `moveTask` / `reorderTasks` は構造操作であり `outline` feature（dnd-kit・`</>`/`J`/`K` の起点）から直接呼ばれるが、実装自体は `task/actions/` に置き、呼び出し元を分けても実装を分けない。

Supabase client は `req.md` §36 が定める 2 種分離をそのままディレクトリへ反映する。
`app-client.ts` は RSC の読み取り（`task/lib/queries.ts`）と Server Action の書き込みから毎リクエスト生成し、Custom JWT を都度払い出す（`docs/auth-design.md` §5.2）。
`service-client.ts` は `@auth/supabase-adapter` が内部で自前の client を生成するため現状は呼び出し元を持たない（`docs/auth-design.md` §5.4）。

`build-tree.ts` は「表示上のグルーピング」と「実際の構造操作」を区別する責務を持つ。
表示上の親子は `effective_parent_id` を用い、削除済み祖先を透明化する(req.md §22)。
一方で `moveTask` / `reorderTasks` が対象とする sibling group は常に実際の `parent_id`（actual parent）である(req.md §17, §26)。
`build-tree.ts` はこの 2 つを混同しないよう、表示順序を `sort_path` で決定しつつ(req.md §46)、構造操作の入力には actual parent の値をそのまま保持して返す。

Zustand ストアはどの feature にも属さない横断的な UI 状態であるため、`features/` の外の `src/store/` に置く。
`outline` / `task-detail` / `dag` / `search` の各コンポーネントが同一ストアを参照するため、単一 feature に閉じ込めない。

---

## 5. 状態設計

本章・第 6 章の個別設計に先立ち、編集 UI 全体を貫く 2 つの方針を定める。

第一に、入力時の `Esc` は下書きの破棄ではなく確定として扱い、確定後は一覧へフォーカスを戻す。
これは vim のノーマルモード復帰と同じメンタルモデルである。
下書きを破棄したい場合は各編集領域が持つ明示的な「キャンセル」ボタンを使う。
確定そのものを取り消したい場合は `u`（undo、第 5.2 節）を使う。
この方針の具体的な適用は、行内タイトル編集の `Esc`（第 6.4 節）と `DetailPane` 各編集領域の `Esc`（第 6.5 節）で個別に述べる。
依存先追加候補の `select`（第 6.5 節）はこの方針からの意図的な例外であり、理由も同節に明記する。

第二に、更新系の fetch（Server Action）は基本的に非同期で行い、UI をブロックしない。
`OutlineOp` リデューサ（第 5.2 節）による楽観反映で確定した瞬間に UI へ反映し、Server Action の応答は待たない。
失敗した場合はステータスライン（`StatusLine`）で通知する。
「保存中」のようなブロッキング表示・disabled は置かない。
この方針の適用範囲は第 5.2 節が扱う `OutlineOp` の対象操作全般であり、依存関係の追加・削除（`addDependency` / `removeDependency`）のように Op リデューサの対象外の操作には及ばない（第 5.2 節）。

### 5.1 Zustand ストア設計

モードは `NORMAL` / `VISUAL` / `SEARCH` の 3 状態を持つステートマシンとして実装する。

実装は `src/store/outline-store.ts` にあり、型は次のとおりである。

```typescript
type OutlineMode = "NORMAL" | "VISUAL" | "SEARCH";

type OutlineState = {
    mode: OutlineMode;
    cursorTaskId: string | null;
    collapsedTaskIds: ReadonlySet<string>;
    visualAnchorTaskId: string | null;
    visualSelectedTaskIds: ReadonlySet<string>;
    searchQuery: string;
    /** blocked 完了拒否時に DAG 上で点滅させる原因タスク ID */
    flashTaskId: string | null;
    /** 表示順の行 ID リスト (OutlineShell が同期する) */
    visibleTaskIds: readonly string[];
};

type OutlineActions = {
    setVisibleTaskIds: (ids: readonly string[]) => void;
    setCursor: (taskId: string | null) => void;
    moveCursor: (direction: "up" | "down") => void;
    jumpCursorRows: (direction: "up" | "down") => void;
    jumpToTop: () => void;
    jumpToBottom: () => void;
    toggleCollapsed: (taskId: string) => void;
    setCollapsed: (taskId: string, collapsed: boolean) => void;
    expandAll: () => void;
    collapseAll: (taskIds: readonly string[]) => void;
    enterVisual: () => void;
    extendVisual: (direction: "up" | "down") => void;
    exitVisual: () => void;
    enterSearch: () => void;
    setSearchQuery: (query: string) => void;
    confirmSearch: () => void;
    cancelSearch: () => void;
    flashTask: (taskId: string | null) => void;
};
```

表示順の行 ID 配列（`visibleTaskIds`）はストアが持つ。
`OutlineShell` が木の組み立てと折りたたみ・絞り込みの反映を終えた結果を `setVisibleTaskIds` で同期し、`moveCursor` / `jumpCursorRows` / `jumpToTop` / `jumpToBottom` / `extendVisual` はこの配列だけを見てカーソルを解決する。
保持するのは ID の並びのみであり、タスクデータそのものをストアへ複製しない方針（第 5.2 節）は保たれる。

`setVisibleTaskIds` は、同期後の配列にカーソル行が含まれなくなっていた場合にカーソルを先頭行へ寄せる。
折りたたみや検索の絞り込みでカーソル行が消えたまま、以後のキー操作が無反応になることを防ぐためである。

`collapseAll`（`zM`）だけは対象 ID の集合を引数で受け取る。
「子を持つ行」の判定には木構造が要り、`visibleTaskIds` は depth も `parent_id` も持たないためである。
対になる `expandAll`（`zR`）が `collapsedTaskIds` を空集合にするだけでストア内に閉じるのに対して非対称なのは、この理由による。

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
| SEARCH | `Enter` | NORMAL | `searchQuery` を保持したままオーバーレイを閉じる（`confirmSearch`）。絞り込みは NORMAL に戻っても残る |
| SEARCH | `Esc` | NORMAL | `searchQuery` を空文字に戻しオーバーレイを閉じる（`cancelSearch`）。絞り込みはここで解除される |

`confirmSearch` が `searchQuery` を消さないため、「`/` で検索 → `Enter` で確定 → そのまま NORMAL の操作」という流れでは絞り込みが残ったままになる。
絞り込みが残っている間の dnd 並べ替えも、挿入位置は可視行ではなく全兄弟を基準に決まる（第 9 章）。

モード遷移とタスクデータの読み書きは明確に分離する。
モード遷移はストア内で完結する同期的な状態更新であり、DB へのアクセスを伴わない。
`x`（完了）のような DB アクセスを伴う操作は、モード遷移とは独立したパイプライン（`use-outline-mutations.ts`、第 5.2 節）が担当し、ストアへは `flashTask` などの表示補助のみを書き戻す。

### 5.2 サーバー状態との境界

タスクデータ（`title` / `description` / `completed_at` / `is_blocked` など）を Zustand ストアへ複製しない。
タスクデータは RSC（`app/page.tsx`）が取得した props として `OutlineShell` へ渡り、クライアント側では読み取り専用として扱う。
書き込みが必要な操作は Server Action を呼び、成功後の `revalidatePath` によって RSC から流れ直す props で真値を更新する。

楽観的更新は `useOptimistic` を用いて props 由来のタスク配列に対するオーバーレイとして実装する。
Zustand には「どのタスクにカーソルがあるか」「どの範囲が選択されているか」といった UI 座標的な状態のみを置き、タスクの内容そのものは一切保持しない。
この分離により、ストアのシリアライズ範囲が小さく保たれ、タスクデータの再取得（revalidate）とカーソル位置のようなセッション的な UI 状態が互いに独立して更新できる。

全構造操作（作成・完了・再オープン・タイトル変更・移動・並べ替え・ゴミ箱への移動・復元）と `DetailPane` の説明・期日の編集を、「表示状態 = reduce(サーバー由来 tasks, pendingOps)」という単一リデューサ方式で表す。
1 回のユーザー操作（キー入力・dnd ドロップ・`DetailPane` の編集確定）を discriminated union の `OutlineOp`（`features/outline/lib/outline-ops.ts`）1 件に対応させる。

```typescript
type OutlineOp =
    | { type: "create"; tempId: string; title: string; parentId: string | null; position: number | null }
    | { type: "complete"; taskId: string }
    | { type: "reopen"; taskId: string }
    | { type: "updateTitle"; taskId: string; title: string }
    | { type: "updateDescription"; taskId: string; description: string }
    | { type: "updateDueDate"; taskId: string; dueDate: string | null }
    | { type: "move"; taskId: string; newParentId: string | null; newPosition: number | null } // indent/outdent/dnd reparent
    | { type: "reorder"; taskId: string; newPosition: number } // 同一 actual parent 内の rank
    | { type: "softDelete"; taskId: string }
    | { type: "restore"; taskId: string; snapshot: AppTask };
```

reducer は `outline-shell.tsx` が次の形で組む。

```typescript
const [optimisticTasks, applyOptimisticAction] = useOptimistic(initialTasks, (state: AppTask[], op: OutlineOp) => applyOutlineOp(state, dependencies, op, { fallbackUserId: userId }));
```

第 4 引数の `{ fallbackUserId }` は `create` の楽観行が持つ `user_id` を決めるための代替値である。
楽観行はサーバーの応答を待たずに組み立てるため、通常は手元の `tasks[0].user_id` を借りる。
アウトラインが空の状態で最初の 1 件を作る場合に借りる先が無いため、`OutlineShell` がセッションの `userId` をここから渡す。

`applyOutlineOp(tasks, dependencies, op, options)` は 1 Op を適用したうえで、`app_tasks` View（`supabase/migrations/20260808000003_app_tasks_view.sql`）と同じ意味論で `sort_path` / `effective_parent_id` / `is_blocked` を全行再計算する（normalize）純関数である。
`move` / `reorder` の position 採番規則は `move_task` / `reorder_tasks` RPC（`supabase/migrations/20260808000005_rpc_functions.sql`、`20260808000007_reorder_tasks_exclude_deleted_siblings.sql`）の挙動にそのまま合わせる。

`move` の `newPosition` は `move_task` の `p_new_position` と同じ意味であり、論理削除済みの行も含めた新しい actual parent 内の実 position である（`docs/db-design.md` 第12.2節）。
`null` は「新しい兄弟グループの末尾へ追加する」を表す（`supabase/migrations/20260813000002_move_task_append_to_tail.sql`）。
末尾だけをクライアントから実 position で表せないのは、`app_tasks` View が論理削除済みを除外するためである。
`applyMove`（`outline-ops.ts`）は RPC と同じ順序で処理を 2 段に分ける。
旧兄弟グループの隙間を詰め、次に末尾を解決し、最後に新兄弟グループの隙間を空ける。
移動先が移動元と同じ兄弟グループのとき、詰める前に末尾を求めると対象自身の分だけ 1 つ大きくなるためである。

末尾指定では楽観適用とサーバーで position の数値がずれる場合がある。
手元の `tasks` には論理削除済みの行が無いため（`softDelete` で配列から除いている）、`applyMove` が求める末尾は、移動先の兄弟グループの末尾に論理削除済みの行が並んでいる場合だけサーバーの採番より小さくなる。
末尾は `max(position) + 1` で求めるため、論理削除済みの行が末尾以外にいる場合は数値まで一致する。
ずれても可視の兄弟すべてより大きい値になるため表示順は一致し、revalidate 後にサーバーの値へ収束する。
`applyCreate` が `position` 省略時の末尾を手元の兄弟の件数から求める点も同じ妥協である（`createTask` は論理削除済みも含めた件数を採番に使う、`features/task/actions/create-task.ts`）。

`reorder` が持つのは同一 actual parent 内の rank（0-based）だけである。
Server Action（`reorderTasks`）が要求する `{ parentId, orderedTaskIds }` は、rank と実行前のタスク一覧から `resolveReorderedSiblingIds`（`outline-ops.ts`）が再構成する。
Op に ID 配列を持たせないのは、undo 履歴へ積む逆操作を「移動前の rank」という 1 個の値で表せるようにするためである。

`restore` だけ `taskId` に加えて `snapshot`（削除直前の行そのもの）を持つ。
`softDelete` は tasks 配列から行そのものを除去するため、`taskId` だけでは元の `title` / `parent_id` / `position` 等を再構成できないためである。

#### 単一パイプライン `runOp`

書き換え操作は `features/outline/hooks/use-outline-mutations.ts` の `runOp` 1 本に集約する。
`runOp` は「逆操作の組み立て → 楽観適用 → Server Action → ステータス行 → undo 履歴」の順に進む。

1. 実行前のタスク一覧（`optimisticTasks`）を `tasksSnapshot` として固定する
2. `invertOutlineOp(op, tasksSnapshot)`（`features/outline/lib/invert-op.ts`）で逆操作の Op 列を組み立てる。組み立てられない場合（`create` / `restore`、対象行が手元に無い場合）は楽観適用も Server Action も行わずに終える
3. `applyOptimisticAction(op)` で楽観適用する
4. `callServerForOp(op, tasksSnapshot)`（`features/outline/lib/dispatch-op.ts`）で対応する Server Action を呼ぶ
5. 失敗ならステータス行（`StatusLine`）へエラー文言を出す。成功なら `{ label, undoOps: 逆操作の Op 列, redoOps: [op] }` を undo 履歴へ積む

`invertOutlineOp` は Op と実行前のスナップショットだけを受け取る純関数であり、「いつ積むか」（Server Action の成功時のみ）の判断は `runOp` に残す。
`reorder` の逆操作は移動前の rank であり、`sibling-rank.ts` の `siblingRankOf` が求める。

`callServerForOp` は Op 種別から Server Action への振り分けを持つ唯一の場所である。
通常操作（`runOp`）と undo/redo の再実行（`runOpsForHistory`）がともにここを通るため、Op 種別を足したときに片方の経路だけを直し忘れる余地がない。

エラー処理の既定は `formatActionError`（`features/outline/lib/action-error.ts`）による文言表示である。
`runOp` の第 3 引数 `onError` はその差し替え口であり、使うのは `x`（完了）の `TASK_BLOCKED` 分岐だけである。
この分岐では `findBlockingCause`（`blocking-cause.ts`）が手元の依存関係から原因タスクを 1 件求め、その名前を含む日本語文言を出したうえで `flashTask` でそのノードを点滅させる。

表示文言は `TaskErrorCode` の記号名と本文だけで組み立て、表示専用の連番は持たない。
番号は migration が定める SQLSTATE（`ET001`〜`ET007`、第 8.3 節）の 1 系統に絞る。

#### undo / redo

Server Action が成功で確定した Op だけを対象に、undo（`u`）/ redo（`U`）の履歴スタックを持つ（第 6.1 節）。
履歴（`features/outline/lib/undo-history.ts`）は `{ label, undoOps, redoOps }` のエントリを積む純粋なスタック操作である。
新しい操作が確定すると redo スタックは破棄する（vim に倣う）。

undo / redo の再実行は `runOpsForHistory` が担い、Op 列を順に「楽観適用 → `callServerForOp`」で流す。
通常操作と同じ `callServerForOp` を通るため、undo の再実行だけが別の Server Action へ向かうことはない。
1 つでも失敗すればステータス行へエラーを出し、そのエントリは反対側のスタックへ積まずに破棄する。

`softDelete` の undo は `restore` 単独ではなく `[restore(snapshot), move(元の parent_id・position へ)]` の 2 Op 列である。
`restore_task` RPC は actual sibling group の末尾へ position を移す仕様であり、削除前の元の位置には戻さないためである。
`move` の楽観適用は old/new の parent_id・position が一致する（= snapshot の値）ときに隙間詰め・隙間空けが互いに打ち消して no-op になるため、ローカルの楽観表示は `restore` 直後の snapshot 位置のまま変わらない。
サーバー側だけ `restore_task` の末尾 → 元の位置へ `move_task` RPC で収束する。

VISUAL の一括完了（`completeSelection`）は `runOp` を通らない。
選択範囲の各タスクへ順に `completeTask` を呼び、成功した taskId 群を 1 エントリへまとめて履歴へ積む。
`runOp` は 1 Op = 1 エントリを前提とするため、部分成功を 1 エントリで表すこの操作だけ自前のループを持つ。
もう 1 つ `runOp` を通らないのは `create` であり、理由は本節後半で述べる。

履歴の対象は `OutlineOp` の対象操作と一致する。
`DetailPane` の依存関係の編集と、ゴミ箱画面からの復元・完全削除は対象外である。
依存関係が対象外なのは Op リデューサそのものの対象外だからであり（本節冒頭）、undo 履歴だけの制約ではない。

#### `DetailPane` の編集と依存関係

`DetailPane` の呼び出し窓口は `commitInlineTitleEdit` / `commitDescriptionEdit` / `commitDueDateEdit` であり、いずれも `use-outline-mutations.ts` が持つ。
3 つとも「値が変わっていなければ何もせず、変わっていれば `runOp` へ渡す」という同じ形である。
タイトルの窓口は行内タイトル編集（`i` / `A`、第 6.4 節）と共有しており、どちらの経路でも同じ `updateTitle` Op を通る。

楽観適用が同期的に効くため、`DetailPane` は Server Action の応答を待たずに編集領域を畳んでよい。
「保存中」のブロッキング表示・disabled は置かない。

依存関係（`task_dependencies`）の追加・削除は `OutlineOp` の対象外である。
`DependencySection` が `addDependency` / `removeDependency` を直接呼んで応答を待ち、失敗時は `dependency-error.ts` が組み立てた日本語文言を自身の中に表示する。

#### 楽観 `create` と tempId

`create` は `runOp` を通らないもう 1 つの例外である。
`invertOutlineOp` は `create` に対して `null` を返す。
逆操作（作成した行を消す `softDelete`）が対象とする実 id は Server Action の応答まで分からず、Op と実行前のスナップショットだけからは組み立てられないためである。
そのため `createSibling` が自前のパイプラインを持ち、settle 後に実 id で `{ undoOps: [softDelete(実 id)], redoOps: [restore(実 id, snapshot)] }` を積む。
この `snapshot` は `applyOutlineOp` を副作用なしで直接呼び、作成直後の行を先読みして得る。

`create` は `tempId`（`crypto.randomUUID()`）で楽観行を即時挿入し、カーソルも `tempId` へ合わせる。
Server Action 成功後、実 id へ `setCursor` し直す。

`tempId` はまだ実 DB に存在しないため、確定前にこれを対象とする構造操作・undo/redo は行わない。
`use-outline-mutations.ts` が `tempId` の集合を `useRef` で保持し、各ハンドラの入口で除外したうえで、settle（成功・失敗のいずれも）で集合から除く。

tempId から実 id への付け替えは「同一論理行の id 変更」であり、「別の行へ移った」とは区別する必要がある。
区別しないと、付け替えの瞬間に行内タイトル編集や `DetailPane` の下書きが破棄される。
対応表の型と操作は `pending-create-registry.ts` が持つ（実体は `OutlineShell` の `useRef`。理由は次の項）。
`use-pending-create.ts` がレンダー中の state 調整（カーソル移動の判定 → 対応表の剪定 → 表示行消失の判定）をこの順序で行う。
`DetailPane` へは対応表の読み取り専用ビューだけを渡し、`temp-id-renames.ts` の `isSameLogicalRow` で同じ判定をさせる。

settle 前に `Enter` / `Esc` でタイトルが確定された場合は、その値を保留キューへ置く。
settle 後に実 id で通常のパイプライン（楽観適用 → `updateTask` → 履歴）へ流す。
`create` 自体が失敗した場合は保留分を破棄する。

#### settle から revalidate 到着までの窓

settle で id が実 id へ切り替わっても、一覧の側はしばらく実 id の行を持たない。
`useOptimistic` の楽観 op は `startTransition` の完了で捨てられる一方、サーバー由来の一覧に実 id の行が現れるのは `revalidatePath` による RSC の再描画が届いてからだからである。
この窓の間、作成した行はどの一覧にも存在せず、次の連鎖でフォーカスと編集中の下書きが失われていた（Issue #60）。

1. 行が消えるため、カーソル（実 id）が可視行の集合に含まれなくなる
2. ストアの `setVisibleTaskIds` が「カーソルが可視行に無い」と見てカーソルを先頭行へ寄せる（この clamp は折りたたみ・絞り込みで行が消えたときに要る）
3. カーソルが動いたことで、上記のレンダー中の state 調整が行内タイトル編集を畳む。`input` が unmount され、フォーカスが `body` へ落ちる

`OutlineShell` は木を組み立てる前に `mergeSettledRows`（`pending-create-registry.ts`）を通し、この窓を埋める。
まだ生きている `tempId` の楽観行は実 id 名義に読み替え、楽観行も実 id の行も無くなった分は settle 時に預けたスナップショット（undo 履歴のために先読みしてある「作成直後の行」と同じもの）で埋める。
実 id の行がサーバー由来の一覧に現れた時点で、対応表もスナップショットも剪定する。

行の React `key` には、id ではなく「実 id → 最初の tempId」で解決した論理キーを使う（`resolveRowKey`）。
id をそのまま `key` にすると、付け替えの瞬間に行のサブツリーが作り直される。
行内タイトル編集中であれば `input` も作り直され、`attachInput`（第 6.4 節）が改めて `setSelectionRange` を行うためキャレットが `caret` の指定位置へ巻き戻る（Issue #62）。
この対応（`rowKeys`）だけは剪定しない。剪定すればその時点で `key` が実 id へ戻り、避けたい作り直しがそこで起きるためである。
保持量はページのセッション中に作成した行 1 件あたり 1 エントリに収まる。

対応表の実体を `use-pending-create.ts` ではなく `OutlineShell` が持つのはこのためである。
差し込みは木の組み立てより前に走る必要があり、木の組み立て後に呼ぶ `use-pending-create.ts` では間に合わない。
剪定の判定には差し込む前の一覧を使う。差し込んだ後の一覧で判定すると、自分が差し込んだ行を「現れた」と見て即座に剪定し、次のレンダーで行がまた消える。

### 5.3 派生値

`is_blocked` は `app_tasks` View 側で算出される派生値であり(req.md §44, §75 原則 2)、クライアントで再計算しない。
表示順序は View が提供する `sort_path` にそのまま従い(req.md §46)、クライアント側で独自にソートし直さない。

例外として、楽観的更新中に限り「暫定的な blocked 解除」の計算をクライアント側で行う。
あるタスクを `completeTask` で楽観的に完了させた瞬間、そのタスクに依存する他タスクの `is_blocked` は本来サーバー側の再計算を待つ必要があるが、revalidate 完了までの間 UI 上は blocked のままに見えてしまう。
これを避けるため、`useOptimistic` のリデューサ内でのみ「完了させたタスク ID を depends_on に持つタスクの `is_blocked` を `false` として一時的に描画する」計算を行う。
この暫定値は revalidate 完了後にサーバー由来の値へ必ず置き換わり、正とはしない。

`DetailPane` の `BlockedReasonBar` が表示する「どのタスクに blocked にされているか」というテキストも同様にクライアント側の導出値だが、これは `is_blocked` フラグの正当性を左右する計算ではなく、`task_dependencies`(req.md §69) と手元の `app_tasks` 一覧を突き合わせて表示用の文言を組み立てるだけの提示ロジックである。
この計算が古くなった場合の影響は表示文言のずれにとどまり、`is_blocked` 自体の信頼性には影響しない。

---

## 6. キーボード設計

### 6.1 keymap 一覧

実装は宣言的テーブル `features/outline/lib/keymap-table.ts` である（第 6.2 節）。
本節の各表はそのエントリと対応する。
ただし SEARCH モードの一部はエントリに `run` を持たず、その扱いは SEARCH の表の直後で述べる。

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
| `x` | 完了 | `complete` Op を `runOp` へ流す（第 5.2 節）。blocked の場合 `TASK_BLOCKED` を受けてステータス行へ原因タスク名を含む文言を出し、DAG の原因ノードを点滅させる |
| `o` | 新規タスク作成（下） | カーソル行の下に同じ actual parent の兄弟として `createTask`。挿入位置は `createTask` が兄弟グループ末尾へ作ったうえで `move_task` RPC(req.md §54) へ委ねる（兄弟の position をずらす更新を 1 トランザクションにまとめるため） |
| `O` | 新規タスク作成（上） | カーソル行の上に同じ actual parent の兄弟として `createTask`。挿入位置の扱いは `o` と同じ |
| `i` | タイトルの行内編集（先頭） | カーソル行のタイトルを行内編集する。キャレットは先頭（第 6.4 節） |
| `A` | タイトルの行内編集（末尾） | カーソル行のタイトルを行内編集する。キャレットは末尾（第 6.4 節） |
| `Enter` | 選択行の編集 | フォーカスを `DetailPane` の編集領域へ移す（タイトルの行内編集は `i` / `A` で行う） |
| `za` | 折りたたみ切替 | ストア内完結。DB アクセスなし |
| `zo` / `zc` | カーソル行の折りたたみを開く / 閉じる | ストア内完結。`za` と同じく `collapsedTaskIds` の 1 要素の出し入れ |
| `zR` | すべて展開 | ストア内完結（`collapsedTaskIds` を空集合にするだけ） |
| `zM` | すべて折りたたむ | 「子を持つ行」の判定に木構造が要るため、対象 ID の算出だけ `OutlineShell` が行い（`collectCollapsibleTaskIds`）、ストアへは ID の集合を渡す。`zR` と置き場所が非対称なのはストアへタスクデータを複製しないため（第 5.2 節） |
| `J` | 同一階層で 1 つ下へ移動 | `reorder` Op（第 5.2 節）。並びは `computeSiblingSwap` が全兄弟から求めるため、絞り込み中でも意図どおり動く |
| `K` | 同一階層で 1 つ上へ移動 | 向きが逆であること以外は `J` と同じ |
| `<` | 親を 1 階層上げる（outdent） | `move` Op。新しい parent・position は `computeOutdent` が求める |
| `>` | 親を 1 階層下げる（indent。直前行を新しい親にする） | `move` Op。新しい parent・position は `computeIndent` が求める |
| `V` | ビジュアルモードへ | 第 5.1 節参照 |
| `dd` | ゴミ箱へ移動 | `softDelete` Op。連続 2 打鍵で確定する（vim の `dd` に倣う。pending key 方式、第 6.2 節） |
| `/` | 検索モードへ | 第 5.1 節参照 |
| `?` | キーバインドのヘルプを表示 | ヘルプオーバーレイを開く。表示内容は keymap テーブルから生成する（第 6.3 節） |
| `u` | undo | 確定済み Op の履歴スタックの末尾を取り消す（第 5.2 節）。`req.md` に undo の記載はなく、対象は `OutlineOp` の対象操作に限る |
| `U` | redo | `u` で取り消した操作をやり直す（第 5.2 節）。Shift 付きだが `event.key` へ既に反映されているため `u` とは別トークンになる（第 6.2 節） |

行内タイトル編集中に効くキーは、テーブル上では NORMAL の `run` を持たないドキュメント専用エントリとして持つ（第 6.2 節）。

| キー | 動作 | 備考 |
|---|---|---|
| `Enter` | 行内編集を確定 | 詳細ペインへは移らない（第 6.4 節） |
| `Escape` | 行内編集を確定 | 取り消しではない。元に戻すには `u`（第 6.4 節） |

VISUAL モード。

| キー | 動作 | 備考 |
|---|---|---|
| `j` / `k` | 選択範囲を拡張 | anchor から cursor までを選択とする |
| `x` | 範囲一括完了 | 選択された各タスクへ順に `completeTask` を実行し、「N件中M件を完了」をステータス行の情報表示へ出す（第 5.2 節） |
| `Esc` | NORMAL へ戻る | 選択を解除 |

SEARCH モード。
3 つとも `keymap-table.ts` に登録がある。

| キー | 動作 | テーブル登録 | 備考 |
|---|---|---|---|
| 文字入力 | クエリ更新 | ドキュメント専用エントリ（`run` なし） | テーブル上の `keys` は `{char}` である（第 6.2 節）。実処理は `SearchOverlay` の入力欄が行う。IME 変換確定前は `isComposing` を見て無視する |
| `Enter` | クエリを確定し、絞り込みを残したまま NORMAL へ戻る | ドキュメント専用エントリ（`run` なし） | 実処理は `SearchOverlay` の入力欄が行う。絞り込みは解除されない（第 5.1 節の `confirmSearch`） |
| `Escape` | クエリを破棄して NORMAL へ戻る | `run` あり | `cancelSearch` |

SEARCH の文字入力と `Enter` の実処理は `SearchOverlay` の入力欄が担う。
入力欄がフォーカスを持つ間は `isEditableTarget`（第 6.2 節）が dispatcher の手前で return するため、テーブルへ `run` を持たせても dispatcher は到達しない。
そのため両者は `run` を持たないドキュメント専用エントリ（第 6.2 節）として登録し、ヘルプオーバーレイ（第 6.3 節）への掲載だけを担わせる。
`Escape` だけが `run` を持ち、これはフォーカスが入力欄から外れた想定外の状態への保険である。

### 6.2 イベント処理方式

キーボード操作は単一の `keydown` ハンドラで受け、`store.mode` に応じてディスパッチする方式とする。
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

キーの一覧・説明・動作は宣言的テーブル `features/outline/lib/keymap-table.ts` を単一の正とする。
dispatcher はこのテーブルから構築した trie だけを読み、ヘルプ表示（第 6.3 節）もこのテーブルから生成する。
dispatcher が処理するキーはテーブルにあるものだけである。

ただし逆は成り立たない。
テーブルにあるキーが必ず dispatcher に届くわけではない。
入力欄にフォーカスがある間は dispatcher 自体が動かないため、そこで効くキーは入力欄のローカルハンドラが処理する。
SEARCH の文字入力と `Enter`（第 6.1 節）、行内編集中の `Enter` / `Escape`（第 6.4 節）が実際にそうなっており、いずれもテーブルへは `run` を持たないエントリとして登録する。

```typescript
type KeymapEntry = {
    keys: string; // スペース区切りのキーシーケンス表現（"j" / "g g" / "z a" / "C-d"）
    mode: OutlineMode;
    category: KeymapCategory; // ヘルプでのグルーピング用（移動 / 編集 / 行内編集 / 構造変更 / 折りたたみ / 絞り込み / モード / ヘルプ）
    description: string; // ヘルプ表示用の説明
    run?: (context: KeymapContext) => void; // 省略時はヘルプにのみ表示する
};
```

`keys` の区切りをスペースにしているのは、`<` `>` のように単体でキーが割り当てられている文字をエスケープなしで書けるようにするため。
修飾キーは基底キーの前へ `C-`（Control）/ `A-`（Alt）/ `M-`（Meta）を付ける。
Shift は接頭辞にしない（`J` や `<` のように `event.key` へ既に反映されているため）。
`run` を任意にしているのは、「コンポーネント側のローカルハンドラが処理するが、ヘルプには載せたいキー」を同じテーブルへ含めるためである。
該当するのは行内編集中の `Esc` / `Enter`（第 6.4 節）と、SEARCH の文字入力 / `Enter`（第 6.1 節）である。

`run` を持たないエントリ（ドキュメント専用エントリ）は trie に載せない。
dispatcher が読むのは `dispatchableKeymap`（`outlineKeymap` から `run` を持つものだけを抜いた派生）である。
除く理由は、同じ `mode` + `keys` が文脈違いで 2 度現れうるためである。
NORMAL の `Enter` は、行にフォーカスがあるときは `DetailPane` へ移り（第 6.1 節）、行内編集中は編集を確定する（第 6.4 節）。
前者だけが dispatcher の担当であり、後者は input のローカルハンドラが処理する。
文脈の違いは `category` が表すため、ヘルプ側の識別子（React の `key`）も `mode` + `category` + `keys` とする。

SEARCH の文字入力の `keys` に置く `{char}` は、`event.key` に対応するキー名ではなく「特定のキーに割り当てられていない打鍵」を表すプレースホルダのトークンであり、ドキュメント専用エントリでのみ使う。
trie に載らないため、dispatcher が押下キーを変換する `keyEventToToken`（`features/outline/lib/key-sequence.ts`）の出力と衝突することはない。

`gg` と `dd` と `z` で始まる各キー（`za` / `zo` / `zc` / `zR` / `zM`、いずれも第 6.1 節）は、1 回の `keydown` だけでは確定可否を判定できない。
これらはテーブルの `keys` から構築した prefix tree（trie）で扱う。
入力トークン列を trie の根から辿り、次の 3 通りに解決する。

- 完全一致するエントリのノードに到達した: そのエントリの `run` を実行する
- エントリのプレフィックスに一致した: 待機状態にして次のキーを待つ
- どのエントリにも繋がらない: **その入力を破棄し**、待機状態を解除する

待機のタイムアウトは 500ms とする（`PENDING_KEY_TIMEOUT_MS`）。
時間切れ後の入力は、通常どおり先頭から解決し直す。

3 番目の「破棄」は vim の挙動に倣ったものであり、プレフィックス待機中の未マッチキーが素通りする誤爆（`d` → `x` でタスクが完了し、続く `d` で削除まで走る）を防ぐ。
破棄時は `preventDefault` しない。keymap に無いキー（`Ctrl+R` 等）のブラウザ既定動作を奪わないためである。

trie の構築（`buildKeymapTries`）と 1 打鍵ぶんの待機状態遷移（`advanceKeySequence`）は `features/outline/lib/keymap-trie.ts` の純粋関数として実装し、DOM やタイマーに依存せず単体テストできるようにする。
待機状態そのものは UI 描画に影響しない値であるため、Zustand ストアには置かず、`use-outline-keymap.ts` 内部の `useRef` で保持する。
ストアに置かない理由は、待機状態の変化のたびにストア購読コンポーネントを再レンダリングする必要がなく、`useOutlineKeymap` 自身だけが参照できれば足りるためである。

### 6.3 キーバインドのヘルプオーバーレイ

`?`（第 6.1 節）で開くヘルプの表示内容は、keymap テーブルを `mode` → `category` でグルーピングして生成する。
ヘルプ側にキー一覧を直書きすると二重管理になり drift するためである。
変換は `features/outline/lib/keymap-help.ts` の `buildKeymapHelpSections` に純粋関数として置き、表示は `features/outline/components/keymap-help-overlay.tsx` が担う。
`keys` は `parseKeySequence`（第 6.2 節）でトークンへ分解し、1 トークン = 1 つの `kbd` として描画する。
`run` を持たないエントリも表示対象に含める（`run` を任意にしている目的がヘルプへの掲載であるため）。
掲載されるドキュメント専用エントリは、NORMAL の行内編集の `Enter` / `Escape`（第 6.4 節）と、SEARCH の文字入力 / `Enter`（第 6.1 節）である。

`kbd` のラベルは `formatKeyToken` が読み替える。
`Escape` は `Esc` へ、`{char}` は `文字` へ変える。
`event.key` 由来の長い名前を狭い `kbd` へ収め、キー名でないプレースホルダのトークン（第 6.2 節）を読み下せる表記にするためである。

SEARCH の文字入力には `絞り込み` カテゴリを充てる。
モード遷移ではないため `モード` へは置けない。
SEARCH の `Enter` / `Escape` は NORMAL へ戻る操作なので `モード` に属するのに対し、文字入力は SEARCH に留まったまま `searchQuery` を更新するだけである（第 5.1 節）。

開閉状態は `OutlineShell` のローカル state が持ち、`OutlineMode` にモードを追加しない。
モードを増やすと store・dispatcher・StatusLine の全体に状態機械が波及するのに対し、ヘルプは裏の状態を一切変えない一時的な表示にすぎないためである。

閉じるキー `q` / `Esc`（`HELP_CLOSE_KEYS`）は、テーブルではなく dispatcher 先頭のガードで処理する。
テーブルのエントリは `mode` でしか文脈を区別できず、「ヘルプ表示中だけ効く」という文脈をモードを増やさずに表現できないためである。
このガードはヘルプ表示中に閉じるキー以外の入力をすべて破棄し、オーバーレイの裏でカーソルが動くことを防ぐ。
破棄時に `preventDefault` しないのは、第 6.2 節の「破棄」と同じ理由による。

表示中は `OutlineShell` の背面要素（ヘッダ・2 ペイン・`MobileDetailSheet`）へ `inert` を付ける。
`role="dialog"` と `aria-modal="true"` で「背面は不活性」と宣言している以上、`Tab` で背面へ抜けられる状態は宣言と矛盾するためである。
加えて抜けた先が `textarea` の場合は `isEditableTarget`（第 6.2 節）が dispatcher の手前で return するため、`q` / `Esc` で閉じられなくなる実害がある。
`MobileDetailSheet` が閉じている間に使っている `inert` と同じ道具で揃える。

### 6.4 タイトルの行内編集

`i` / `A`（第 6.1 節）はカーソル行のタイトルを行内編集する。
キャレット位置は vim に倣い `i` が先頭、`A` が末尾とする（`DetailPane` のタイトル編集が全選択にしているのとは使い分ける）。
確定は `Enter` / `Esc` / blur のいずれでも行う。
`Esc` も全体方針「Esc = 確定」（第 5 章冒頭）に従い、取り消しではなく確定として扱う。
行内編集に明示的な破棄の導線は無いが、確定した操作は `updateTitle` Op として undo 履歴（第 5.2 節）へ記録されるため、`u` で直前のタイトルへ戻せる。
この復元手段があるため、`Esc` から破棄の導線が無くなることを実害とはみなさない。
`Enter` による確定は NORMAL に戻すだけとし、`DetailPane` へは連鎖させない（移りたい場合は改めて `Enter` を押す）。
空文字（トリム後）は DB 制約 `tasks_title_not_blank` の CHECK 違反になり `TaskErrorCode` へ変換できないため、送信前にクライアント側で弾いてインラインにエラーを出す（第 8.2 節の `DetailPane` と同じ理由）。
blur 時に空文字だった場合は保存できないため取り消し扱いとし、元のタイトルへ戻す。
確定時に値が変わっていなければ `updateTask` を呼ばずに編集だけを畳む（blur 確定で無駄な Server Action が飛ぶのを防ぐ）。
確定した新しいタイトルは `useOptimistic`（第 5.2 節）でも重ねる。revalidate が届くまでの間、確定直後の行が編集前のタイトルへ一瞬戻って見えるのを防ぐためである。

編集状態は `OutlineShell` のローカル state が `{ taskId, caret }`（null 許容）という 1 個の値として持つ。
`OutlineMode` に `INSERT` を足さず、Zustand ストアにも置かない。
モードなしで成立するのは、グローバル keymap の抑止を `isEditableTarget`（第 6.2 節）が DOM のフォーカス先で行っているためである。
編集中はフォーカスが input にあるので `j` / `k` は発火せず、「カーソルは動いたが編集対象は元の行のまま」という同期のずれが構造的に起きない。
第二の状態機械（`editingMode` 等）は作らない。将来 `cc`（タイトル全体を置き換える）を足す場合も `caret` の値を増やすだけに留める。

フォーカス制御は次の 2 点を守る。これを誤るとフォーカスが `body` へ落ち、キー入力が一切効かなくなる。

- 編集開始時は callback ref で input へ即座にフォーカスし、`caret` に応じたキャレット位置を `setSelectionRange` で設定する。`useEffect` にしないのは、編集状態が立ってから実際にフォーカスが移るまでの隙間に `j` が滑り込むのを防ぐためである
- 編集終了時（確定・取り消しの両方）は、編集状態を畳む前に行の要素（`tabIndex={-1}` を持つ `role="option"`）へ明示的にフォーカスを戻す。ただし blur 由来の終了では既に別の要素へフォーカスが移っているため戻さない。フォーカスを戻す実装自体は `OutlineShell` が持つ共通ヘルパー `focusOutlineList` に委ねる（第 6.5 節）

編集中に別の行がクリックされてカーソルが移動した場合は編集状態を解除する。
`OutlineShell` がレンダー中の state 調整（`lastCursorTaskId` との比較）で行い、`useEffect` による同期にはしない。

編集中の行が表示行の集合から消えた場合も同じくレンダー中の state 調整で編集状態を解除する。
`zM` / `zc`（第 6.1 節）による折りたたみや検索の絞り込みは表示行の集合を変えるため、input が unmount されたまま編集状態だけが残りうるためである。
キー経由でこの状態に入ることはない（編集中はフォーカスが input にあり dispatcher が `isEditableTarget` で素通しする）が、折りたたみボタンのクリックのようにキーボード以外の経路があるため、カーソル移動による解除とは別に表示行の集合とも突き合わせる。

キー入力は input のローカルハンドラで処理し、行や祖先へは伝播させない（`stopPropagation`）。
編集中の入力を、行のクリックを止めるのと同じ境界で input の中に閉じるためである。
グローバル keymap の抑止そのものは `isEditableTarget`（第 6.2 節）が担っており、この `stopPropagation` には依存していない。
IME 変換確定の `Enter` / `Esc` は `isComposing` を見て編集の確定・取り消しと取り違えない（`SearchOverlay` と同じ扱い）。

### 6.5 編集領域からの Esc によるフォーカス復帰

`DetailPane`（タイトル・説明・期日・依存先追加候補）と `MobileDetailSheet` 内の同じ編集 UI は、`Esc` keydown でその編集領域を終え、一覧へフォーカスを戻す。
これにより、マウスで一覧外をクリックしなくても `Esc` だけでキーボード操作（NORMAL）へ復帰できる。

`Esc` はタイトル・説明・期日のいずれも確定として処理する（全体方針「Esc = 確定」、第 5 章冒頭）。

タイトルの確定は `onCommitTitle`（`commitInlineTitleEdit`、第 5.2 節）を呼ぶ。
空文字（トリム後）のまま `Esc` を押した場合は確定できないため、行内タイトル編集（`i`/`A`、第 6.4 節）の空 `Esc` と同じくインラインエラーを出して編集領域に留まり、フォーカスも一覧へ戻さない。
期日の確定は `onCommitDueDate`（`commitDueDateEdit`、第 5.2 節）を呼ぶ。
期日には空文字禁止のような検証がなく（空文字は「期日なし」として常に確定できる）、`Esc` は必ず確定して一覧へフォーカスを戻す。

説明の確定は `onCommitDescription`（`commitDescriptionEdit`、第 5.2 節）を呼ぶ。
説明編集では `Ctrl+Enter`（Mac の `Cmd+Enter` = `metaKey` も同様）でも確定できる。
`Esc` と `Ctrl+Enter` はいずれも同じ `commitDescriptionEdit` を呼ぶ点で同じだが、`Esc` はその後さらに一覧へフォーカスを戻す一方、`Ctrl+Enter` はテキストエリア内での確定操作のためフォーカスを戻さない。

タイトル・説明・期日のいずれも、編集前と同値のまま確定した場合は `commitInlineTitleEdit` と同じ規則で Server Action を投げずに編集領域だけを畳む。
明示的な「キャンセル」ボタンはタイトル・説明・期日のすべてに残しており、下書きを破棄したい場合はそちらを使う（全体方針が挙げる「破棄したい場合はキャンセルボタン」の受け皿）。

依存先追加候補の `select` だけは、この全体方針からの意図的な例外としてキャンセル（未確定の選択を破棄して未選択へ戻す）のままとする。
この `select` はタイトル・説明・期日のような「下書きを確定する」編集ではなく、依存先の候補を選ぶだけの一時的な選択であり、選択自体はまだ何も書き込んでいない（確定＝追加には別途「追加」ボタン押下 → `addDependency` の Server Action 呼び出しが要る）。
「入力中の値」という概念が薄く、`Esc` で確定したことにしても実際には何も追加されないまま編集領域だけ畳まれ、「確定したのに反映されない」という誤解を招くだけであるため、ここだけ従来通りのキャンセルを維持する。

フォーカスを一覧へ戻す実装は、`OutlineShell` が持つ 1 個の共通ヘルパー `focusOutlineList` に集約する。
`DetailPane` はこれを `onEscapeToOutline` として props で受け取り、各編集領域のローカルな `Esc` ハンドラから呼ぶ。
`focusOutlineList` はまずカーソル行（`[data-cursor="true"] [role="option"]`。第 6.4 節・`KeymapHelpOverlay` の `resolveRestoreTarget` と同じ探索対象）を探し、見つかればそこへ `focus()` する。
カーソル未選択などで見つからない場合は、一覧のスクロールコンテナ（`data-role="outline-scroll"`。`tabIndex={-1}` を付けて `focus()` 可能にしてある）へ戻す。
第 6.4 節の行内タイトル編集（`i` / `A` の `Esc` / `Enter` 終了時）のフォーカス復帰も、同じ `focusOutlineList` を `onFocusOutlineList` として受け取って呼ぶ。

フォーカスが一覧側の要素（`input` / `textarea` / `contenteditable` ではない要素）へ移ると、`isEditableTarget`（第 6.2 節）の抑止が外れ、document の keydown ハンドラが再びキーを受け取る。
`focusOutlineList` の呼び出しは、この抑止を外すための blur だけでは行われない「フォーカス位置を一覧側へ明示する」ことを目的としており、フォーカス復帰そのものは blur の時点で（抑止が外れる意味では）既に完了している。

IME 変換確定中の `Esc`（`event.nativeEvent.isComposing`）は、いずれの編集領域でも第 6.2 節・第 6.4 節と同じ扱いで無視し、その編集領域の確定・取り消しのどちらとしても処理しない。

### 6.6 カーソル行と DOM フォーカスの追従

カーソル（ストアの `cursorTaskId`）と DOM のフォーカス位置は別物である。
`j` / `k` はストアを書き換えるだけで、フォーカスは押した時点の要素に残る。
一方 `focusOutlineList`（第 6.5 節）は行の要素（`role="option"`）へフォーカスを載せる。
この 2 つが揃わないと「フォーカスは行 A、カーソルは行 B」というずれが残り、フォーカスリングがカーソルとは別の行に出たままになる（Issue #58）。

`OutlineShell` は `cursorTaskId` の変化を見て、カーソル行へフォーカスを移す。
移すのはフォーカスが行の要素にあるときだけで、それ以外（行内編集の `input`、`DetailPane` の `textarea`、ヘッダのボタン、`body`）からは奪わない。
行内編集中の `input` は行の内側にあるが `role="option"` を持たないため、この条件で区別できる。
奪ってはならない代表例が、`o` で作った行のタイトルを行内編集している最中の `createTask` の settle である（tempId → 実 id の付け替えで `cursorTaskId` が変わる。第 5.2 節）。

行（`OutlineRow`）にキーボードのローカルハンドラは置かない。
キーの担当は keymap テーブル（第 6.1 節）と、入力欄のローカルハンドラ（第 6.2 節が挙げる、`isEditableTarget` で dispatcher が素通しする文脈）の 2 つだけである。
行の `onKeyDown` はそのどちらでもないのに NORMAL の `Enter` を「この行をカーソルにする」として拾っており、テーブルの `Enter`（`focusDetailEditor`）と担当が二重になっていた。
フォーカスとカーソルがずれている間はこの二重の担当が衝突し、`Enter` がカーソルを古い行へ引き戻して編集領域を開けなくする（Issue #58）。
行のクリック（`onClick` によるカーソル選択）はマウス操作の導線として残す。

---

## 7. コンポーネント構成

### 7.1 コンポーネントツリーと Server/Client 境界

```text
app/page.tsx                          [Server Component]
  → getOutlineData で app_tasks / task_dependencies を並列取得 (第 8.1 節)
  └ OutlineShell                      [Client Component] ("use client")
      → build-tree.ts で表示順フラットリスト化・折りたたみと絞り込みの反映
      ├ OutlineHeader                 [Client] (検索ボタン・V 切替・新規タスク・キーヒント)
      ├ OutlinePane                   [Client] (DndContext / SortableContext)
      │   ├ DependencyRail            [Client] (SVG)
      │   └ OutlineRow (繰り返し)      [Client]
      │       └ InlineTitleEditor     [Client] (i / A で編集中の行のみ。第 6.4 節)
      ├ StatusLine                    [Client]
      │   └ LogoutButton              [Client]
      ├ PaneDivider                   [Client] (2 ペインの幅比ドラッグハンドル)
      ├ DetailPane                    [Client]
      │   ├ BlockedReasonBar          [Client] (status === "blocked" のみ)
      │   ├ TitleField                [Client]
      │   ├ DueDateField              [Client]
      │   ├ DependencySection         [Client]
      │   └ DescriptionField          [Client]
      │       ├ MarkdownPreview       [Client]
      │       └ MarkdownEditor        [Client]
      ├ DagPanel                      [Client] (SVG)
      ├ MobileDetailSheet             [Client] (モバイル幅のみ表示。DetailPane と DagPanel を再利用)
      ├ SearchOverlay                 [Client] (mode === "SEARCH" のとき表示)
      └ KeymapHelpOverlay             [Client] (? で開く。開閉は OutlineShell のローカル state。第 6.3 節)

app/trash/page.tsx                    [Server Component]
  → deleted_at IS NOT NULL のタスクを取得
  └ TrashView                         [Client Component]
      └ TrashRow (繰り返し)            [Client]

app/login/page.tsx                    [Server Component]
  └ LoginButton                       [Client Component]
```

`DetailPane` と `DagPanel` は PC 幅の右ペインと `MobileDetailSheet` の両方から使う。
モバイル幅への切り替えは `window.innerWidth` 等の JS 判定ではなく Tailwind のブレークポイントで行い、右ペイン側が `md:flex`、`MobileDetailSheet` 側が `md:hidden` で相互に排他になる。
`MobileDetailSheet` は `DetailPaneProps` をそのまま取り込んで素通しし、詳細表示のロジックを二重に持たない。

`DetailPane` の各フィールドは自身の下書きと編集中フラグをローカル state で持つ。
親（`DetailPane`）が配るのは「別のタスクへ切り替わったので初期化せよ」という合図（`resetToken`）だけである。
タイトル・期日・説明の 3 節はこの値を `key` に混ぜて作り直し、進行中の通信フラグを持つ `DependencySection` だけは値として受け取って初期化対象を自分で選ぶ。

データ取得と初期描画は Server Component（`page.tsx` 系）に閉じ、以降のインタラクション（キーボード・DnD・楽観更新・SVG 描画）を担う部分はすべて Client Component とする。
`OutlineShell` を境界コンポーネントとし、これより下は "use client" を再宣言しない（App Router の Client Component 境界の伝播に従う）。

PC 幅の 2 ペインの横幅比（左ペイン：右ペイン）は、既定値を 60%：40% とし、ドラッグで変更できる。
2 ペインの境界に `role="separator"` 相当（実装は `<hr>`。暗黙に `separator` role を持つ）のドラッグハンドル `PaneDivider` を置き、`pointerdown` + `setPointerCapture` + `pointermove` で左ペインの比率（%）を更新する。
可動域は 25%〜75% とし、範囲外の入力は `features/outline/lib/pane-ratio.ts` の `clampPaneRatio` で収める。
比率は CSS 変数（`--left-pane-percent`）経由で `md:flex-[0_0_var(--left-pane-percent)]` へ渡す。
`md:` 接頭辞の Tailwind responsive utility は `@media` でのみ効くため、この仕組みのままモバイル幅では素の `flex-1`（全幅）を維持し、2 ペイン用のドラッグ操作もモバイル幅には影響しない。
確定した比率は localStorage（キー `dagdo.pane-ratio`）へ保存し、次回訪問時に復元する。
SSR とのハイドレーション不整合を避けるため、初期レンダリングは常に既定値 60% とし、復元は mount 後の `useEffect` で行う（第 5.2 節の `useOptimistic` の初期値の扱いと同じ考え方）。
ドラッグ中は `body` へ `user-select: none` を当ててテキスト選択を防ぎ、ドラッグ終了で必ず外す。
`PaneDivider` は dnd-kit の `DndContext`（行の並べ替え、`OutlinePane` 内。第 9 章）の外側（`OutlineShell` 直下）に置き、行の dnd 操作とポインタ操作が競合しないようにする。
ドラッグ中は左ペイン幅の変化に追従して `DependencyRail` の `ResizeObserver` コールバックが発火するが、これは第 7.2 節のトレーリングデバウンス（100ms）にそのまま従う。

### 7.2 依存レール・DAG の SVG 描画設計

`DependencyRail`（ガター）と `DagPanel`（右ペイン下部）はいずれも「行または ノードの画面上の座標」を必要とする SVG 描画であり、同じ設計方針を採る。

行の DOM 位置測定には、`OutlineRow` がマウント時に自身の `HTMLElement` を `Map<taskId, HTMLElement>` へ登録する ref コールバック方式を用いる。
このマップは `features/outline/hooks/use-row-refs.ts` が保持し、`OutlinePane` のスクロールコンテナに対する `getBoundingClientRect()` の差分から各行の相対 y 座標を算出する。

再描画のタイミングは次の 4 種とし、いずれのタイミングで用いる間引き方式にするかを 3 段階に整理する。
`ResizeObserver` 起因の再計算には、必ず適切なデバウンスを入れる。

- マウント時（初回描画）: 間引きなしで即時に描画する
- スクロールイベント時: `requestAnimationFrame` によるスロットリングとし、フレームあたり 1 回に制限する
- `ResizeObserver` によるコンテナサイズ変化時（主にウィンドウリサイズのバースト対策）: トレーリングデバウンス 100ms を入れる
- 折りたたみ開閉などアプリ操作起因の単発変化、および `revalidatePath` 後の props 更新・楽観的更新の適用/巻き戻しなどツリー構造が変化した時: デバウンスを挟まず即時に再計算する

この 3 段構成は、発火源ごとに連続発火の性質が異なることに基づく。
スクロールは高頻度かつ滑らかな追従が要求されるため、rAF で 1 フレームに 1 回へ抑える。
ウィンドウリサイズは短時間に多数の `ResizeObserver` コールバックがバースト発生するため、トレーリングデバウンスで最後の 1 回だけを処理し、無駄な再計算を避ける。
一方、折りたたみ開閉やツリー構造変化はユーザー操作や revalidate に対応した単発のイベントであり、間引く対象となる連続発火が発生しないため、デバウンスを挟まず結果を即時に反映する。

折りたたみ操作はコンテナの高さ変化を伴うため `ResizeObserver` のコールバックも副次的に発火しうるが、当該コールバック経由の再計算は上記のトレーリングデバウンス（100ms）に従わせる。
即時反映が必要なのは、折りたたみ操作のイベントハンドラ自身が明示的に呼び出す再計算であり、`ResizeObserver` 経由の再計算とは呼び出し経路を分ける。

`DagPanel` はさらに `compute-local-subgraph.ts` によりカーソルタスクから ±2 ホップの部分グラフを抽出してからノード座標を計算する。
ホップ数の限定は、依存グラフ全体を毎回レイアウトし直すコストを避けるための設計判断であり、カーソル移動（`j`/`k`）に追従して都度再抽出する。

---

## 8. データフロー

### 8.1 初回ロード

```text
app/page.tsx (RSC)
  ↓ getSessionUserId() → createAppClient({ userId })
  ↓ task/lib/queries.ts の getOutlineData
  ↓ Promise.all
  ├ app_tasks を取得         (req.md §44, §69)
  └ task_dependencies を取得 (req.md §69)
  ↓
OutlineShell へ props として渡す (initialTasks / initialDependencies)
  ↓ build-tree.ts (クライアント側)
  - effective_parent_id で表示グルーピング (req.md §22)
  - sort_path で表示順序を決定 (req.md §46)
  - actual parent_id / position を構造操作用に保持 (req.md §17)
  - 折りたたみ (collapsedTaskIds) と検索の絞り込みを反映して表示行を導く
```

`app_tasks` と `task_dependencies` は個別に取得し、Task View に dependency 配列を埋め込む設計は取らない(req.md §69)。
関連付けはアプリケーション側（`build-tree.ts` / `depends-on-tasks.ts` / `compute-local-subgraph.ts`）で行う。

木の組み立ては RSC ではなく `OutlineShell` が行う。
楽観適用後の一覧（`optimisticTasks`）から毎レンダー組み直す必要があり、サーバー側で一度組んだ結果は楽観適用のたびに使えなくなるためである。

読み取りは `app_tasks` View から全件を取る（`queries.ts` の `.select("*")`）。
ページネーションは持たない(req.md §68)。
ローカルスタックの `supabase/config.toml:18` は `max_rows = 1000` であり、1 ユーザーの未削除タスクが 1000 件を超えると警告なく切り捨てられる（`docs/db-design.md` 第 15.2 節）。

### 8.2 操作の流れ（`x` による完了を例に）

```text
1. keydown ("x", NORMAL) → dispatchKeymap → handlers.completeCursor
2. runOp({ type: "complete", taskId }, "完了", onError) (第 5.2 節)
   ↓ invertOutlineOp → undoOps = [{ type: "reopen", taskId }]
3. applyOptimisticAction: completed_at を楽観的に埋める
   + 依存先が taskId であるタスクの is_blocked を暫定 false に (第 5.3 節の例外)
4. callServerForOp → completeTask({ taskId })
5a. 成功
    - Server Action 内で revalidatePath を呼ぶ (req.md §71)
    - RSC が再取得した実データで useOptimistic のオーバーレイが解消される
    - statusError を null へ戻し、undo 履歴へ { label: "完了", undoOps, redoOps: [op] } を積む
5b. 失敗 (TASK_BLOCKED)
    - useOptimistic のオーバーレイは transition の終了とともに巻き戻る
    - findBlockingCause で原因タスクを 1 件求め、StatusLine へ
      "TASK_BLOCKED — <原因タスク名> が未完了のため完了できません" を出す
    - store.flashTask(原因タスク ID) → DagPanel が該当ノードを点滅表示
```

エラー通知はステータス行（`StatusLine`）で行う。
トーストは使わず、トーストライブラリも導入しない（第 12 章）。
`StatusLine` は `errorMessage` を最優先で表示し、無ければ `infoMessage`（VISUAL の一括完了の件数）、それも無ければカーソル行の簡易情報を出す。

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

全 Server Action の戻り値を discriminated union の `ActionResult<T>` で統一する。

```typescript
type ActionResult<T = void> = { ok: true; data: T } | { ok: false; code: TaskErrorCode; message: string };
```

`message` は英語のログ用文言とし（第 3 章）、UI 表示用の日本語文言は呼び出し側が `code` を見て組み立てる。
組み立て先は 2 箇所ある。
アウトライン操作は `outline/lib/action-error.ts` の `formatTaskError` が `<code> — <message>` の形でステータス行へ出し、依存関係の操作は `task-detail/lib/dependency-error.ts` が code ごとの日本語文言へ変換して `DependencySection` 内に出す。

DB から返るエラーの `TaskErrorCode` への変換は `task/lib/map-db-error.ts` に集約し、Server Action 本体に判定ロジックを重複させない(req.md §71 の「DB エラー変換」をこの 1 箇所に置く設計)。
判定は SQLSTATE（`PostgrestError.code`）を最優先とし、次に `RAISE EXCEPTION` メッセージ先頭のコード文字列で判定する。
SQLSTATE `ET001`〜`ET007` は migration が定める契約であり（`supabase/migrations/20260808000004_triggers.sql:8-15`、`docs/db-design.md` 第 14 章）、メッセージ文言よりも変わりにくいためである。

どちらでも判別できない契約外のエラーは `TaskErrorCode` へ変換できないため、握りつぶさず re-throw する。

`ActionResult` は失敗時に `code` と `message` しか持たない。
`TASK_BLOCKED` の原因タスクは載らないため、必要な側（`blocking-cause.ts`）が手元の依存関係から求める（第 5.2 節）。

### 8.4 Server Action の定型

`req.md` §71 が Server Action の責務として挙げるのは、session 確認・DB/RPC 呼び出し・DB エラー変換・revalidation である。
このうち DB/RPC 呼び出し以外は 11 本すべてで同じ形になるため、高階関数 `defineTaskAction`（`task/lib/define-task-action.ts`）へ集約する。

```typescript
export const completeTask = defineTaskAction<{ taskId: string }>(
    ["/"],
    async ({ client, userId }, { taskId }) => await client.from("tasks").update({ completed_at: new Date().toISOString() }).eq("id", taskId).eq("user_id", userId),
);
```

`defineTaskAction` は revalidate 対象パスの配列と本体を受け取り、次を行う関数を返す。

1. `getSessionUserId()` でセッションから `userId` を取得する（クライアント入力の `user_id` は信用しない。`docs/auth-design.md` §7.4）
2. `createAppClient({ userId })` でリクエスト毎の Supabase client を生成する（第 4 章）
3. 本体を `{ client, userId }` と引数で呼ぶ
4. `error` があれば `mapDbErrorOrThrow` で `TaskErrorCode` へ変換し `{ ok: false, code, message }` を返す
5. 成功時のみ対象パスへ `revalidatePath` し、`{ ok: true, data: undefined }` を返す

本体は `{ error }` を持つ値を返せばよい。
supabase-js の query builder と `rpc` の戻り値がそのまま条件を満たすため、本体は Supabase 呼び出し 1 文で書ける。

revalidate 対象は操作が影響する画面で決める。
アウトラインだけが変わる 8 本は `["/"]`、ゴミ箱の中身も変わる `softDeleteTask` / `restoreTask` / `permanentlyDeleteTask` は `["/", "/trash"]` である。

11 本のうち 10 本がこの高階関数を通る。
`createTask` だけは個別実装であり、理由は `defineTaskAction` の前提を 3 点とも満たさないことである。

- DB 呼び出しが 3 つある（兄弟件数の取得・INSERT・位置指定時の `move_task`）
- 位置調整が失敗した場合は作成自体が成功しているため、`revalidatePath` してから失敗を返す
- 成功時に作成した `{ id }` を返す（`defineTaskAction` の戻り値は `ActionResult<void>` に固定される）

`"use server"` モジュールから高階関数の戻り値を `export const` する形が Server Action として登録されることは、Next.js 16.3.0 において `.next/server/server-reference-manifest.json` を確認する実測で確かめている（11 本すべて登録され、node エントリ 13 が `main` と一致する）。
同梱ドキュメント（`node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-server.md`）は `export async function` 形しか例示していないため、この点は文書ではなく実測に拠る。

---

## 9. dnd-kit 設計

ツリーへの適用方針はフラット化リスト方式である。
`build-tree.ts` が生成する「actual parent 情報を保持したフラットリスト」に対し、`flatten-for-dnd.ts` の `flattenForDnd` が各行へ `depth`（= actual parent を辿った階層数）を付与し、dnd-kit の `useSortable` が扱える線形リストへ変換する。
この `depth` は表示用の depth（`effective_parent_id` 由来、`build-tree.ts` の `OutlineTreeRow.depth`）とは別物である。

ドロップ確定（`outline-pane.tsx` の `handleDragEnd`）は次の順に進む。

1. ドロップ先の行（`over`）が可視行であることを確かめ、その行の `parentId` を得る
2. `computeDropResult` へ `{ tasks, taskId, targetParentId, overTaskId }` を渡す
3. actual parent が変わるかどうかで結果の種類を分ける
4. `parent` が変わらなければ `onReorder`（`reorder` Op）、変われば `onReparent`（`move` Op）を呼ぶ

`flattenForDnd` の結果を引くのは 1 のためだけである。

**ドロップ確定時の挿入位置は「全兄弟」基準である。**
`computeDropResult` は `tasks` の同一 `parent_id` を `position` 昇順に並べたものを基準に取り、ドロップ先の行の直前（上へのドラッグ）または直後（下へのドラッグ）へ対象を挿し込む。
可視行（`flattenForDnd(visibleRows)`）を基準にしてはならない。
絞り込み中は可視行からクエリに合わない兄弟が欠けるのに対し、`reorder` Op の rank を並びへ戻す `resolveReorderedSiblingIds`（第 5.2 節）は全兄弟へ適用するためである。
基準が食い違うと、見えていない兄弟を飛び越えた位置へ挿し込まれる。
折りたたみは兄弟グループごと隠れるため、この食い違いを生まない（`deriveVisibleRows` は折りたたんだ行より深い行をまとめて落とす）。

**`computeDropResult` の入力は `{ tasks, taskId, targetParentId, overTaskId }` である。**
ドロップ後の希望順序を呼び出し側が組み立てて渡す形は採らない。
可視行由来の並びを渡せてしまい、上の基準を関数の外側から破れるためである。

`targetParentId` を `overTaskId` と別引数にしているのは、将来ポインタの水平オフセットから depth を投影するときに、「親はポインタ位置から、挿入位置はドロップ先の行から」を別々に決められるようにするためである。

**`computeDropResult` の reparent 分岐が返す `newPosition` は rank ではなく、ドロップ先の行の実 position である。**
親を跨ぐドロップでは対象が移動先の兄弟グループに居ないため、挿入位置は常に「ドロップ先の直前へ挿す」になる。
これは `p_new_position` 以降の兄弟を +1 シフトする `move_task` の挙動と一致する（`docs/db-design.md` 第12.2節）。
ドロップ先の行が移動先の兄弟グループに属さない場合は `null`（末尾）を返す。

**可視の添字を DB の `position` として使わない。**
`app_tasks` View は論理削除済みを除外するため（`supabase/migrations/20260808000003_app_tasks_view.sql`）、同じ兄弟グループに論理削除済みの行が残っていると、可視の並びの添字や件数は実 position とずれる。
`move` Op の `newPosition` と `create` Op の `position` はいずれも実 position であり、可視の兄弟から数えた値を渡してはならない（`computeCreatePosition` のドキュメントコメント、`flatten-for-dnd.ts`）。
`computeOutdent` は親の実 position に +1 した値を、`computeCreatePosition` はカーソル行の実 position を基準にする。
末尾だけはクライアントから実 position を求められないため、`computeIndent` は `null` を返して `move_task` に解決させる（第 5.2 節）。

`reorder` Op が持つのは兄弟内の rank だけであり、Server Action へ渡す ID 配列は `resolveReorderedSiblingIds` が全兄弟から再構成する（第 5.2 節）。
`J` / `K` も同じ `reorder` Op を通るため、dnd とキーボードで並べ替えの経路は 1 本である。
`<` / `>` と dnd の reparent も同じ `move` Op を通る。
経路を分けないのは、「同じ構造変更を表す入力」から異なる Server Action 呼び出しロジックが生まれることを避けるためである。

ポインタ操作の完成度は最小限に留めており、水平オフセットからの depth 投影は未実装である。
ドロップ先の行が属する `parentId` をそのまま採用する（`outline-pane.tsx:93`）。
ポインタを右へずらして 1 階層下げる、といった操作はできない。
階層の変更はキーボード（`<` / `>`）で行う。

---

## 10. テーマ実装

mdblog-nextjs と同じ夜空パレットを Tailwind v4 の `@theme` トークンへ次の対応で落とす。テーマは固定ダークテーマとし、ライトモードおよびテーマ切替は実装しない。

| CSS 変数名 | 値 | 用途 |
|---|---|---|
| `--color-page-bg` | `#090d1b` | WebGL 背景の下地 |
| `--color-bg` | `rgba(15, 21, 42, 0.86)` | 基本サーフェス（アウトライン、入力欄等） |
| `--color-bg-alt` | `rgba(21, 29, 55, 0.72)` | サブサーフェス（右ペイン、ヘッダー等） |
| `--color-bg-sunken` | `rgba(9, 13, 27, 0.76)` | 沈み込み表現（DAG パネル等） |
| `--color-text` | `#eef1fa` | 本文テキスト |
| `--color-text-dim` | `#aab3cc` | 補助テキスト |
| `--color-border` | `rgba(185, 200, 242, 0.17)` | 罫線・区切り |
| `--color-accent` | `#b9c8f2` | アクセント（カーソル行・リンク等） |
| `--color-accent-strong` | `#dbe3fb` | hover 等の強いアクセント |
| `--color-accent-ink` | `#090d1b` | アクセント背景上の文字・アイコン |
| `--color-blocked` | `#dcb15f` | blocked 表示（🔒・BlockedReasonBar） |
| `--color-overdue` | `#ff8f8f` | 期限切れ期日チップ・エラー |
| `--color-done` | `#7f89a4` | 完了済みタスクのグレーアウト |
| `--color-overlay` | `rgba(0, 0, 0, 0.5)` | モーダルとモバイルシートの背面 |
| `--radius-base` | `6px` | 角丸 |

全ルート共通の背景は、固定配置した WebGL canvas で描画する。シェーダーの色は `#b9c8f2` / `#6e7fbf` / `#4a5aa0` / `#33406e` の 4 色とし、最大 30fps、device pixel ratio 1.25、描画領域 150 万ピクセルに制限する。画面が非表示の間は描画を止め、`prefers-reduced-motion: reduce` では静止画を 1 フレームだけ描画する。WebGL が利用できない場合は、同じ配色の CSS radial-gradient をフォールバックとして表示する。

アウトライン、右ペイン、ヘッダー、ステータスライン、モーダルは半透明サーフェスとして背景を透過させる。可読性が必要な入力欄とコンテンツ面は `--color-bg`、補助領域は `--color-bg-alt`、DAG のような沈み込み領域は `--color-bg-sunken` を使用する。ヘッダー、ステータスライン、モーダルには backdrop blur を適用する。

hover 時のみ極薄 shadow を付与する仕様は、専用の shadow トークンを常設せず、Tailwind のユーティリティクラス（`hover:shadow-sm` 相当）で表現し、`@theme` トークン化しない（hover 限定の一時的な視覚効果であり、テーマ切替対象にする必要がないため）。

上表の具体値は「パレット層」（`--palette-*`）として定義し、`--color-*` はパレット層を参照する「セマンティック層」として定義する。二層構造は用途と具体値を分離するためのものであり、テーマ切替を目的としない。

この前提から次の規則を定める。

- コンポーネントは常にセマンティック層（`--color-*`）のみを参照し、パレット層（`--palette-*`）や生の 16 進値を直接参照してはならない

---

## 11. テスト方針

単体テストは vitest + @testing-library/react を用いる。
設定は `vitest.config.mts` にあり、`environment` は jsdom、対象は `src/**/*.test.ts` と `src/**/*.test.tsx` である。
実行は `make fe-test`（`npm test` = `vitest run`）であり、品質ゲート `make check` の 3 段目に入る（第 3.6 節）。

テストは対象と同じディレクトリに置く。
主な対象は `lib/` 配下の純関数であり、次の 25 ファイル・304 件がある。

| 対象 | テストファイル |
|---|---|
| 表示順フラットリスト構築・折りたたみ反映 | `outline/lib/build-tree.test.ts` |
| dnd フラット化と新 parent・position の算出 | `outline/lib/flatten-for-dnd.test.ts` |
| `OutlineOp` の楽観適用と normalize | `outline/lib/outline-ops.test.ts` |
| Op → Server Action の振り分け（網羅性を含む） | `outline/lib/dispatch-op.test.ts` |
| Op の逆操作の組み立て | `outline/lib/invert-op.test.ts` |
| 同一 actual parent 内の rank 解決 | `outline/lib/sibling-rank.test.ts` |
| undo / redo の履歴スタック | `outline/lib/undo-history.test.ts` |
| エラー表示文言の組み立て | `outline/lib/action-error.test.ts` |
| `TASK_BLOCKED` の原因タスク解決 | `outline/lib/blocking-cause.test.ts` |
| keymap テーブルの整合（第 6.1 節との対応を含む） | `outline/lib/keymap-table.test.ts` |
| trie の構築と 1 打鍵ぶんの待機状態遷移 | `outline/lib/keymap-trie.test.ts` |
| ヘルプ表示セクションの導出 | `outline/lib/keymap-help.test.ts` |
| キーシーケンスのトークン分解・整形 | `outline/lib/key-sequence.test.ts` |
| 行内タイトル編集の状態判定 | `outline/lib/inline-title-edit.test.ts` |
| tempId → 実 id の対応表、settle 済みの行の差し込み、行の論理キー | `outline/lib/pending-create-registry.test.ts` |
| ペイン比率の clamp と保存値の解釈 | `outline/lib/pane-ratio.test.ts` |
| 表示用状態の導出（done / blocked / ready） | `task-detail/lib/task-status.test.ts` |
| 依存操作のエラー文言 | `task-detail/lib/dependency-error.test.ts` |
| 依存先タスクの実体の引き直し | `task/lib/depends-on-tasks.test.ts` |
| SQLSTATE / メッセージ → `TaskErrorCode` 変換 | `task/lib/map-db-error.test.ts` |
| 同一論理行の付け替え判定 | `task/lib/temp-id-renames.test.ts` |
| Asia/Tokyo 基準の日付整形と期限切れ判定 | `lib/date/timezone.test.ts` |
| 行内タイトル編集のフォーカス遷移 | `outline/components/inline-title-editor.test.tsx` |
| キー操作から Server Action までの結線、カーソル行とフォーカスの追従（第 6.6 節） | `outline/components/outline-shell.test.tsx` |
| 詳細ペインの編集状態の初期化 | `task-detail/components/detail-pane.test.tsx` |

`components` 配下の 3 ファイルだけ `@testing-library/react` で描画して確かめる。
フォーカスの遷移そのものが仕様である箇所（第 6.4 節・第 6.6 節）と、キー入力から Server Action の呼び出しまでの結線は、純関数の単体テストでは押さえられないためである。

E2E テストは実装しない（2026-08-13 の判断）。
ブラウザ自動化の依存とローカル Supabase を要する実行環境を V1 では持たず、キーボード操作の結線は `outline-shell.test.tsx` が Server Action をモックして確かめる範囲に留める。
DB 側の不変条件は pgTAP（`docs/migration-design.md` 7章）が担う。

---

## 12. 依存パッケージ一覧

本章は `package.json` の内容と 1 対 1 に対応する。

### 12.1 dependencies

| パッケージ | 採用理由 |
|---|---|
| `next` | アプリケーションフレームワーク本体(req.md §2.1) |
| `react` / `react-dom` | Next.js の UI ランタイム |
| `zustand` | クライアント状態管理（第 5.1 節） |
| `@dnd-kit/core` | dnd-kit のドラッグ&ドロップ基盤 |
| `@dnd-kit/sortable` | フラット化リストの並べ替え（第 9 章） |
| `@dnd-kit/utilities` | `@dnd-kit/sortable` が要求する補助ユーティリティ |
| `react-markdown` | description の Markdown プレビュー(req.md §7) |
| `remark-gfm` | GFM 記法（テーブル・チェックリスト等）への対応 |
| `next-auth` | Auth.js 本体(req.md §30) |
| `@auth/supabase-adapter` | Auth.js の永続化を `next_auth` schema へ委譲(req.md §31, §43) |
| `@supabase/supabase-js` | Supabase Data API クライアント(req.md §2.2) |
| `jose` | Custom JWT の署名・生成(req.md §34) |

### 12.2 devDependencies

| パッケージ | 採用理由 |
|---|---|
| `typescript` | 型検査・型定義言語 |
| `@types/node` / `@types/react` / `@types/react-dom` | 型定義 |
| `tailwindcss` / `@tailwindcss/postcss` | Tailwind v4 本体とビルド統合 |
| `babel-plugin-react-compiler` | React Compiler（第 3.3 節） |
| `@biomejs/biome` | Lint / Format（第 3.1 節） |
| `knip` | 死蔵コード検出 |
| `vitest` | 単体テストランナー（第 11 章） |
| `@testing-library/react` | コンポーネントの単体テスト |
| `jsdom` | vitest のブラウザ API モック環境 |

### 12.3 常設しないツール

Supabase CLI は devDependency として固定せず、`Makefile:10` の `npx -y supabase@latest` で都度取得する。
用途は DB 型生成（`make db-types`）・ローカルスタック（`make db-start`）・pgTAP（`make db-test`）・本番反映（`make db-push`）であり、いずれも Next.js のビルドには関わらないためである。

---

## 13. 未決事項

本文書はフロントエンドの構成・状態設計・UI 実装方式を定めるが、次の項目は決定していない。

- **ポインタの水平オフセットからの depth 投影**（第 9 章）。実装しておらず、V1 で実装するかどうかも決めていない
- **一覧取得の上限**（第 8.1 節）。`max_rows = 1000` を超える件数への対処（ページネーション、または上限引き上げ）は決めていない
- **モバイルのロングタップ複数選択**。閾値と視覚フィードバックの詳細を決めておらず、実装もしていない

第 5 章から第 12 章までが `req.md` §74 の「今後の詳細設計項目」のうちフロントエンド側を解決している。
認証・DB 側の項目は `docs/auth-design.md` 第 10 章と `docs/migration-design.md` 10章がそれぞれ扱う。

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
| **パレット層** | Tailwind v4 のテーマトークンにおいて、固定ダークテーマの具体的な色を保持する `--palette-*` 層（第 10 章） |
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
| **`OutlineOp`** | 1 回のユーザー操作を表す discriminated union（`features/outline/lib/outline-ops.ts`）。楽観適用・Server Action の振り分け・undo 履歴のすべてがこの 1 種類の値を介する（第 5.2 節） |
| **rank** | 同一 actual parent 内での 0 始まりの並び順。`reorder` Op が持つ値であり、DB の `position` とは別物（削除済みの兄弟が挟まると両者はずれる。第 9 章） |
| **tempId** | 楽観 `create` が採番する一時的な行 ID（`crypto.randomUUID()`）。Server Action の応答で実 id へ付け替わる（第 5.2 節） |
| **ドキュメント専用エントリ** | keymap テーブルのうち `run` を持たないエントリ。dispatcher の trie には載らず、ヘルプにのみ現れる（第 6.2 節） |

---

- 対象リポジトリ: dagdo
- 対象コミット: 2752573
- 作成日: 2026-08-08
- 更新日: 2026-08-13
- 生成者: Claude Code
