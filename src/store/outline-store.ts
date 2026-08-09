import { create } from "zustand";
import type { OutlineMode } from "@/store/types";

/**
 * アウトライナーの UI 状態ストア (docs/frontend-design.md §5.1)
 *
 * UI 座標的な状態のみを保持し、タスクデータ (title / completed_at / is_blocked 等) は複製しない。
 * タスクデータの正は RSC props + useOptimistic のオーバーレイ (docs/frontend-design.md §5.2)。
 *
 * visibleTaskIds は「現在表示中の行の順序」であり、OutlineShell が
 * ツリー構築結果 (折りたたみ反映後) から同期する。カーソル移動 (j/k/gg/G) の
 * 順序解決にのみ使い、タスク内容は含まない
 */
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
    /** `C-d` / `C-u`。表示順で CURSOR_JUMP_ROW_COUNT 行ぶんカーソルを動かす */
    jumpCursorRows: (direction: "up" | "down") => void;
    jumpToTop: () => void;
    jumpToBottom: () => void;
    toggleCollapsed: (taskId: string) => void;
    /** `z o` / `z c`。カーソル行の折りたたみを開く / 閉じる */
    setCollapsed: (taskId: string, collapsed: boolean) => void;
    /** `z R`。すべて展開する */
    expandAll: () => void;
    /**
     * `z M`。渡された ID 集合をそのまま折りたたみ集合にする
     *
     * 対象 (子を持つ行) の算出は呼び出し側 (OutlineShell) が行う。「子を持つか」の判定には木構造が要り、
     * ストアはタスクデータを複製しないためである (docs/frontend-design.md §5.2)。
     * 対になる expandAll がストア内で完結するのに対して非対称なのはこの理由による
     */
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

/** anchor から cursor までの範囲 (表示順) を選択集合として返す */
const rangeBetween = (ids: readonly string[], anchorId: string, cursorId: string): Set<string> => {
    const anchorIndex = ids.indexOf(anchorId);
    const cursorIndex = ids.indexOf(cursorId);
    if (anchorIndex < 0 || cursorIndex < 0) {
        return new Set(anchorIndex >= 0 ? [anchorId] : []);
    }
    const [start, end] = anchorIndex <= cursorIndex ? [anchorIndex, cursorIndex] : [cursorIndex, anchorIndex];
    return new Set(ids.slice(start, end + 1));
};

/** `C-d` / `C-u` で一度に動かす行数。画面の高さは実測せず固定値とする (予測可能性と実装コストを優先する判断) */
const CURSOR_JUMP_ROW_COUNT = 10;

/**
 * 表示順の ID 配列上で、現在位置から offset 行ぶん動かした先の ID を返す
 *
 * 端を越える移動は端に丸める (`j` / `k` / `C-d` / `C-u` はいずれも先頭・末尾で留まる)
 */
const offsetId = (ids: readonly string[], currentId: string | null, offset: number): string | null => {
    if (ids.length === 0) {
        return null;
    }
    if (currentId === null) {
        return ids[0] ?? null;
    }
    const index = ids.indexOf(currentId);
    if (index < 0) {
        return ids[0] ?? null;
    }
    const nextIndex = Math.min(Math.max(index + offset, 0), ids.length - 1);
    return ids[nextIndex] ?? null;
};

const neighborId = (ids: readonly string[], currentId: string | null, direction: "up" | "down"): string | null => offsetId(ids, currentId, direction === "down" ? 1 : -1);

export const useOutlineStore = create<OutlineState & OutlineActions>((set, get) => ({
    mode: "NORMAL",
    cursorTaskId: null,
    collapsedTaskIds: new Set<string>(),
    visualAnchorTaskId: null,
    visualSelectedTaskIds: new Set<string>(),
    searchQuery: "",
    flashTaskId: null,
    visibleTaskIds: [],

    setVisibleTaskIds: (ids) => {
        set({ visibleTaskIds: ids });
        const { cursorTaskId } = get();
        if (cursorTaskId !== null && !ids.includes(cursorTaskId)) {
            set({ cursorTaskId: ids[0] ?? null });
        }
    },

    setCursor: (taskId) => set({ cursorTaskId: taskId }),

    moveCursor: (direction) => {
        const { visibleTaskIds, cursorTaskId } = get();
        set({ cursorTaskId: neighborId(visibleTaskIds, cursorTaskId, direction) });
    },

    jumpCursorRows: (direction) => {
        const { visibleTaskIds, cursorTaskId } = get();
        set({ cursorTaskId: offsetId(visibleTaskIds, cursorTaskId, direction === "down" ? CURSOR_JUMP_ROW_COUNT : -CURSOR_JUMP_ROW_COUNT) });
    },

    jumpToTop: () => {
        const { visibleTaskIds } = get();
        set({ cursorTaskId: visibleTaskIds[0] ?? null });
    },

    jumpToBottom: () => {
        const { visibleTaskIds } = get();
        set({ cursorTaskId: visibleTaskIds[visibleTaskIds.length - 1] ?? null });
    },

    toggleCollapsed: (taskId) => get().setCollapsed(taskId, !get().collapsedTaskIds.has(taskId)),

    setCollapsed: (taskId, collapsed) => {
        const next = new Set(get().collapsedTaskIds);
        if (collapsed) {
            next.add(taskId);
        } else {
            next.delete(taskId);
        }
        set({ collapsedTaskIds: next });
    },

    expandAll: () => set({ collapsedTaskIds: new Set<string>() }),

    collapseAll: (taskIds) => set({ collapsedTaskIds: new Set(taskIds) }),

    enterVisual: () => {
        const { cursorTaskId } = get();
        if (cursorTaskId === null) {
            return;
        }
        set({
            mode: "VISUAL",
            visualAnchorTaskId: cursorTaskId,
            visualSelectedTaskIds: new Set([cursorTaskId]),
        });
    },

    extendVisual: (direction) => {
        const { visibleTaskIds, cursorTaskId, visualAnchorTaskId } = get();
        const nextCursor = neighborId(visibleTaskIds, cursorTaskId, direction);
        if (nextCursor === null || visualAnchorTaskId === null) {
            return;
        }
        set({
            cursorTaskId: nextCursor,
            visualSelectedTaskIds: rangeBetween(visibleTaskIds, visualAnchorTaskId, nextCursor),
        });
    },

    exitVisual: () =>
        set({
            mode: "NORMAL",
            visualAnchorTaskId: null,
            visualSelectedTaskIds: new Set<string>(),
        }),

    enterSearch: () => set({ mode: "SEARCH", searchQuery: "" }),

    setSearchQuery: (query) => set({ searchQuery: query }),

    confirmSearch: () => set({ mode: "NORMAL" }),

    cancelSearch: () => set({ mode: "NORMAL", searchQuery: "" }),

    flashTask: (taskId) => set({ flashTaskId: taskId }),
}));
