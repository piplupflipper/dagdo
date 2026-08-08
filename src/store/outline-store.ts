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

const neighborId = (ids: readonly string[], currentId: string | null, direction: "up" | "down"): string | null => {
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
    const nextIndex = direction === "down" ? Math.min(index + 1, ids.length - 1) : Math.max(index - 1, 0);
    return ids[nextIndex] ?? null;
};

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

    jumpToTop: () => {
        const { visibleTaskIds } = get();
        set({ cursorTaskId: visibleTaskIds[0] ?? null });
    },

    jumpToBottom: () => {
        const { visibleTaskIds } = get();
        set({ cursorTaskId: visibleTaskIds[visibleTaskIds.length - 1] ?? null });
    },

    toggleCollapsed: (taskId) => {
        const next = new Set(get().collapsedTaskIds);
        if (next.has(taskId)) {
            next.delete(taskId);
        } else {
            next.add(taskId);
        }
        set({ collapsedTaskIds: next });
    },

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
