import type { useOutlineStore } from "@/store/outline-store";
import type { OutlineMode } from "@/store/types";

/**
 * DB アクセスを伴う keymap 操作 (x/o/J/K/</>/dd/Enter, docs/frontend-design.md §6.1)
 *
 * モード遷移のようなストア内完結の操作 (j/k/gg/G/za/V/Esc 等) は keymap エントリの `run` が
 * `context.store` を直接叩くため、ここには含まれない
 */
export type OutlineKeymapHandlers = {
    /** NORMAL の `x`。カーソル行を completeTask する */
    completeCursor: () => void;
    /** VISUAL の `x`。選択範囲の各タスクへ順に completeTask する */
    completeSelection: () => void;
    /** `o`。カーソル行の下に同じ actual parent の兄弟として createTask する */
    createBelowCursor: () => void;
    /** `Enter`。DetailPane の編集領域へフォーカスを移す */
    focusDetailEditor: () => void;
    /** `J`/`K`。同一 parent 内で 1 つ上/下へ reorderTasks する */
    moveCursorSibling: (direction: "up" | "down") => void;
    /** `>`。indent (直前行を新しい親にする) */
    indentCursor: () => void;
    /** `<`。outdent (親を 1 階層上げる) */
    outdentCursor: () => void;
    /** `dd`。ゴミ箱へ softDeleteTask する */
    softDeleteCursor: () => void;
};

/** keymap エントリの `run` に渡す実行コンテキスト */
type KeymapContext = {
    /** DB アクセスを伴う操作。OutlineShell が注入する */
    handlers: OutlineKeymapHandlers;
    /** キー押下時点のストアスナップショット (useOutlineStore.getState() の結果) */
    store: ReturnType<typeof useOutlineStore.getState>;
};

/** ヘルプ (Issue #16) でのグルーピング単位 */
type KeymapCategory = "移動" | "編集" | "構造変更" | "折りたたみ" | "モード";

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
     * 省略した場合、dispatcher は preventDefault せず何もしない。
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

    // NORMAL: 編集
    { keys: "x", mode: "NORMAL", category: "編集", description: "カーソル行を完了", run: ({ handlers }) => handlers.completeCursor() },
    { keys: "o", mode: "NORMAL", category: "編集", description: "カーソル行の下に新規タスクを作成", run: ({ handlers }) => handlers.createBelowCursor() },
    { keys: "Enter", mode: "NORMAL", category: "編集", description: "詳細ペインの編集領域へフォーカスを移す", run: ({ handlers }) => handlers.focusDetailEditor() },
    { keys: "d d", mode: "NORMAL", category: "編集", description: "カーソル行をゴミ箱へ移動", run: ({ handlers }) => handlers.softDeleteCursor() },

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

    // NORMAL: モード
    { keys: "V", mode: "NORMAL", category: "モード", description: "ビジュアルモードへ入る", run: ({ store }) => store.enterVisual() },
    { keys: "/", mode: "NORMAL", category: "モード", description: "検索モードへ入る", run: ({ store }) => store.enterSearch() },

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
