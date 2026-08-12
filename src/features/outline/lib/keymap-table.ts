import type { SiblingPlacement } from "@/features/outline/lib/flatten-for-dnd";
import type { InlineTitleCaret } from "@/features/outline/lib/inline-title-edit";
import type { useOutlineStore } from "@/store/outline-store";
import type { OutlineMode } from "@/store/types";

/**
 * `OutlineShell` が注入する副作用 (docs/frontend-design.md §6.1)
 *
 * DB アクセスを伴う操作 (x/o/O/J/K/</>/dd/Enter)、ストアに置かない UI ローカル state の操作
 * (ヘルプ開閉・行内編集の開始)、そしてストアが持たない木構造を要する操作 ({ / } / zM) を持つ。
 * モード遷移のようなストア内完結の操作 (j/k/gg/G/C-d/C-u/za/zo/zc/zR/V/Esc 等) は keymap エントリの `run` が
 * `context.store` を直接叩くため、ここには含まれない
 */
export type OutlineKeymapHandlers = {
    /** NORMAL の `x`。カーソル行を completeTask する */
    completeCursor: () => void;
    /** VISUAL の `x`。選択範囲の各タスクへ順に completeTask する */
    completeSelection: () => void;
    /** `o`/`O`。カーソル行の下/上に同じ actual parent の兄弟として createTask する */
    createSibling: (placement: SiblingPlacement) => void;
    /** `i`/`A`。カーソル行のタイトルの行内編集を開始する (キャレット位置は先頭/末尾) */
    startInlineTitleEdit: (caret: InlineTitleCaret) => void;
    /** `Enter`。DetailPane の編集領域へフォーカスを移す */
    focusDetailEditor: () => void;
    /**
     * `{`/`}`。同じ actual parent の 1 つ前/後の兄弟へカーソルを移す (子孫はスキップされる)
     *
     * 兄弟の判定に parent_id が要り、`visibleTaskIds` の添字演算では解けないためハンドラ側に置く
     */
    jumpToSibling: (direction: "up" | "down") => void;
    /**
     * `zM`。子を持つ行をすべて折りたたむ
     *
     * 「子を持つ行」の判定に木構造が要るためハンドラ側で対象 ID を算出し、ストアへは ID の集合だけを渡す。
     * 対になる `zR` がストアのアクション (expandAll) だけで済むのと非対称なのはこの理由による
     */
    collapseAll: () => void;
    /** `J`/`K`。同一 parent 内で 1 つ上/下へ reorderTasks する */
    moveCursorSibling: (direction: "up" | "down") => void;
    /** `>`。indent (直前行を新しい親にする) */
    indentCursor: () => void;
    /** `<`。outdent (親を 1 階層上げる) */
    outdentCursor: () => void;
    /** `dd`。ゴミ箱へ softDeleteTask する */
    softDeleteCursor: () => void;
    /** `u`。undo スタックの末尾を実行する (Phase 2、docs/frontend-design.md §5.2) */
    undo: () => void;
    /** `U`。redo スタックの末尾を実行する (Phase 2、docs/frontend-design.md §5.2) */
    redo: () => void;
    /** `?`。キーバインドのヘルプオーバーレイを開く */
    openHelp: () => void;
    /**
     * ヘルプオーバーレイを閉じる
     *
     * テーブルのエントリからではなく dispatcher 先頭のガードから呼ばれる。
     * 閉じるキーは「ヘルプ表示中」という文脈でのみ効くべきだが、モードを増やさない制約 (Issue #16) により
     * テーブルの `mode` 軸ではその文脈を表現できないため (lib/keymap-help.ts の `HELP_CLOSE_KEYS`)
     */
    closeHelp: () => void;
};

/** keymap エントリの `run` に渡す実行コンテキスト */
type KeymapContext = {
    /** DB アクセスを伴う操作。OutlineShell が注入する */
    handlers: OutlineKeymapHandlers;
    /** キー押下時点のストアスナップショット (useOutlineStore.getState() の結果) */
    store: ReturnType<typeof useOutlineStore.getState>;
};

/**
 * ヘルプオーバーレイでのグルーピング単位 (lib/keymap-help.ts)
 *
 * `行内編集` は「行内編集中だけ効くキー」という文脈を表すためのカテゴリである。
 * 行内編集はモードではない (OutlineMode は NORMAL/VISUAL/SEARCH の 3 値を維持する) ため
 * `mode` 軸では文脈を表現できず、ヘルプ表示専用の軸である `category` に持たせている
 */
export type KeymapCategory = "移動" | "編集" | "行内編集" | "構造変更" | "折りたたみ" | "モード" | "ヘルプ";

/**
 * keymap の 1 エントリ。キーの一覧・説明・動作の単一の正 (docs/frontend-design.md §6.1)
 *
 * dispatcher はこのテーブルのみを読んで動作するため、ここに無いキーは処理されない
 */
export type KeymapEntry = {
    /** スペース区切りのキーシーケンス表現 (例: `"j"` / `"g g"` / `"C-d"`)。詳細は key-sequence.ts */
    keys: string;
    mode: OutlineMode;
    category: KeymapCategory;
    /** ヘルプ表示用の説明 */
    description: string;
    /**
     * キー確定時の動作
     *
     * 省略したエントリ (ドキュメント専用エントリ) は dispatcher の解決対象に含めず、ヘルプにのみ表示する。
     * 「コンポーネント側のローカルハンドラが処理するが、ヘルプには載せたいキー」を表現するために任意としている
     */
    run?: (context: KeymapContext) => void;
};

/**
 * アウトライナーの keymap テーブル (docs/frontend-design.md §6.1)
 *
 * 並び順はヘルプでの表示順を兼ねるため、モード → カテゴリの順にまとめている
 */
export const outlineKeymap: readonly KeymapEntry[] = [
    // NORMAL: 移動
    { keys: "j", mode: "NORMAL", category: "移動", description: "カーソルを次の行へ", run: ({ store }) => store.moveCursor("down") },
    { keys: "k", mode: "NORMAL", category: "移動", description: "カーソルを前の行へ", run: ({ store }) => store.moveCursor("up") },
    { keys: "g g", mode: "NORMAL", category: "移動", description: "アウトライン先頭行へジャンプ", run: ({ store }) => store.jumpToTop() },
    { keys: "G", mode: "NORMAL", category: "移動", description: "アウトライン末尾行へジャンプ", run: ({ store }) => store.jumpToBottom() },
    { keys: "{", mode: "NORMAL", category: "移動", description: "前の兄弟へ移動 (子孫をスキップ)", run: ({ handlers }) => handlers.jumpToSibling("up") },
    { keys: "}", mode: "NORMAL", category: "移動", description: "次の兄弟へ移動 (子孫をスキップ)", run: ({ handlers }) => handlers.jumpToSibling("down") },
    // Ctrl-d / Ctrl-u は Chrome のブックマーク追加・ソース表示と衝突するが、dispatcher が preventDefault で奪う (Issue #18 で合意済み)
    { keys: "C-d", mode: "NORMAL", category: "移動", description: "カーソルを 10 行下へ", run: ({ store }) => store.jumpCursorRows("down") },
    { keys: "C-u", mode: "NORMAL", category: "移動", description: "カーソルを 10 行上へ", run: ({ store }) => store.jumpCursorRows("up") },

    // NORMAL: 編集
    { keys: "x", mode: "NORMAL", category: "編集", description: "カーソル行を完了", run: ({ handlers }) => handlers.completeCursor() },
    { keys: "o", mode: "NORMAL", category: "編集", description: "カーソル行の下に新規タスクを作成", run: ({ handlers }) => handlers.createSibling("below") },
    { keys: "O", mode: "NORMAL", category: "編集", description: "カーソル行の上に新規タスクを作成", run: ({ handlers }) => handlers.createSibling("above") },
    { keys: "Enter", mode: "NORMAL", category: "編集", description: "詳細ペインの編集領域へフォーカスを移す", run: ({ handlers }) => handlers.focusDetailEditor() },
    { keys: "d d", mode: "NORMAL", category: "編集", description: "カーソル行をゴミ箱へ移動", run: ({ handlers }) => handlers.softDeleteCursor() },
    // undo/redo は Server Action が成功で確定した操作のみを対象とする履歴スタックを辿る (Phase 2、docs/frontend-design.md §5.2)。
    // `U` は Shift 付きだが key-sequence.ts は Shift を接頭辞にせず event.key へ反映済みの値をそのまま使うため、`u` と衝突しない
    { keys: "u", mode: "NORMAL", category: "編集", description: "undo (直前の確定操作を取り消す)", run: ({ handlers }) => handlers.undo() },
    { keys: "U", mode: "NORMAL", category: "編集", description: "redo (取り消した操作をやり直す)", run: ({ handlers }) => handlers.redo() },

    // NORMAL: 行内編集
    // Enter / Escape は InlineTitleEditor のローカルハンドラが処理するためのドキュメント専用エントリ (run なし)。
    // 編集中はフォーカスが input にあり、dispatcher は isEditableTarget で手前から素通しするため、
    // ここに run を持たせても呼ばれない。
    // Escape は以前「取り消す」だったが、確定に変更した (改修 2)。破棄の導線は無くなるが、
    // 確定後は `u` (undo) で直前のタイトルへ戻せるため実害はない
    { keys: "i", mode: "NORMAL", category: "行内編集", description: "カーソル行のタイトルを行内編集 (キャレットは先頭)", run: ({ handlers }) => handlers.startInlineTitleEdit("start") },
    { keys: "A", mode: "NORMAL", category: "行内編集", description: "カーソル行のタイトルを行内編集 (キャレットは末尾)", run: ({ handlers }) => handlers.startInlineTitleEdit("end") },
    { keys: "Enter", mode: "NORMAL", category: "行内編集", description: "行内編集を確定 (詳細ペインへは移らない)" },
    { keys: "Escape", mode: "NORMAL", category: "行内編集", description: "行内編集を確定する (取り消しではない。元に戻すには u)" },

    // NORMAL: 構造変更
    { keys: "J", mode: "NORMAL", category: "構造変更", description: "同一階層で 1 つ下へ移動", run: ({ handlers }) => handlers.moveCursorSibling("down") },
    { keys: "K", mode: "NORMAL", category: "構造変更", description: "同一階層で 1 つ上へ移動", run: ({ handlers }) => handlers.moveCursorSibling("up") },
    { keys: "<", mode: "NORMAL", category: "構造変更", description: "親を 1 階層上げる (outdent)", run: ({ handlers }) => handlers.outdentCursor() },
    { keys: ">", mode: "NORMAL", category: "構造変更", description: "直前行を新しい親にする (indent)", run: ({ handlers }) => handlers.indentCursor() },

    // NORMAL: 折りたたみ
    {
        keys: "z a",
        mode: "NORMAL",
        category: "折りたたみ",
        description: "カーソル行の折りたたみを切り替える",
        run: ({ store }) => {
            if (store.cursorTaskId === null) {
                return;
            }
            store.toggleCollapsed(store.cursorTaskId);
        },
    },
    {
        keys: "z o",
        mode: "NORMAL",
        category: "折りたたみ",
        description: "カーソル行の折りたたみを開く",
        run: ({ store }) => {
            if (store.cursorTaskId === null) {
                return;
            }
            store.setCollapsed(store.cursorTaskId, false);
        },
    },
    {
        keys: "z c",
        mode: "NORMAL",
        category: "折りたたみ",
        description: "カーソル行の折りたたみを閉じる",
        run: ({ store }) => {
            if (store.cursorTaskId === null) {
                return;
            }
            store.setCollapsed(store.cursorTaskId, true);
        },
    },
    // zR と zM で置き場所が非対称なのは、ストアへタスクデータを複製しない方針 (docs/frontend-design.md §5.2) による。
    // zR は collapsedTaskIds を空にするだけでフラットな集合操作に閉じるためストアのアクションで足りるが、
    // zM は「子を持つ行」の判定に木構造が要り、ストアの visibleTaskIds (depth も parent_id も持たない ID 配列) では解けない。
    // そのため対象 ID の算出だけを OutlineShell のハンドラへ出し、ストアへは ID の集合を渡す
    { keys: "z R", mode: "NORMAL", category: "折りたたみ", description: "すべて展開する", run: ({ store }) => store.expandAll() },
    { keys: "z M", mode: "NORMAL", category: "折りたたみ", description: "すべて折りたたむ", run: ({ handlers }) => handlers.collapseAll() },

    // NORMAL: モード
    { keys: "V", mode: "NORMAL", category: "モード", description: "ビジュアルモードへ入る", run: ({ store }) => store.enterVisual() },
    { keys: "/", mode: "NORMAL", category: "モード", description: "検索モードへ入る", run: ({ store }) => store.enterSearch() },

    // NORMAL: ヘルプ
    { keys: "?", mode: "NORMAL", category: "ヘルプ", description: "キーバインドのヘルプを表示", run: ({ handlers }) => handlers.openHelp() },

    // VISUAL
    { keys: "j", mode: "VISUAL", category: "移動", description: "選択範囲を 1 行下へ拡張", run: ({ store }) => store.extendVisual("down") },
    { keys: "k", mode: "VISUAL", category: "移動", description: "選択範囲を 1 行上へ拡張", run: ({ store }) => store.extendVisual("up") },
    { keys: "x", mode: "VISUAL", category: "編集", description: "選択範囲を一括で完了", run: ({ handlers }) => handlers.completeSelection() },
    { keys: "Escape", mode: "VISUAL", category: "モード", description: "選択を解除して NORMAL へ戻る", run: ({ store }) => store.exitVisual() },

    // SEARCH
    // SearchOverlay の入力欄がフォーカスを持つ間は isEditableTarget により dispatcher 自体が動かない。
    // フォーカスが外れているような想定外の状態に備えた保険として Esc のみ登録する
    { keys: "Escape", mode: "SEARCH", category: "モード", description: "クエリを破棄して NORMAL へ戻る", run: ({ store }) => store.cancelSearch() },
];

/**
 * dispatcher が解決の対象にするエントリ (`run` を持つもの)
 *
 * ドキュメント専用エントリを除くのは、同じ `mode` + `keys` で実行されるエントリと共存しうるためである。
 * 例えば NORMAL の `Enter` は、行にフォーカスがあるときは詳細ペインへ移り、行内編集中は編集を確定する。
 * 前者だけが dispatcher の担当であり、後者は input のローカルハンドラが処理する。
 * この 2 つは文脈が異なるだけで同じ `mode` に属するため、trie (keymap-trie.ts) には前者のみを載せる
 */
export const dispatchableKeymap: readonly KeymapEntry[] = outlineKeymap.filter((entry) => entry.run !== undefined);
