import { useEffect, useRef } from "react";
import { useOutlineStore } from "@/store/outline-store";
import type { OutlineMode } from "@/store/types";

/**
 * DB アクセスを伴う keymap 操作 (x/o/J/K/</>/dd/Enter, docs/frontend-design.md §6.1)
 *
 * モード遷移のようなストア内完結の操作 (j/k/gg/G/za/V/Esc 等) はこのフックが直接
 * useOutlineStore を呼んで処理するため、ここには含まれない
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

type PendingKeyName = "d" | "g" | "z";

type PendingKey = {
    key: PendingKeyName;
    timestampMs: number;
};

/** `gg`/`dd`/`za` の連続 2 打鍵確定までの許容時間 (docs/frontend-design.md §6.2) */
const PENDING_KEY_TIMEOUT_MS = 500;

/** input / textarea / contenteditable にフォーカスがある間はグローバル keymap を無効化する (docs/frontend-design.md §6.2) */
const isEditableTarget = (target: EventTarget | null): boolean => {
    if (!(target instanceof HTMLElement)) {
        return false;
    }
    return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
};

type OutlineStoreApi = ReturnType<typeof useOutlineStore.getState>;

/**
 * NORMAL / VISUAL / SEARCH のキーボードディスパッチを 1 つの keydown ハンドラへ集約するフック (docs/frontend-design.md §6.2)
 *
 * `OutlineShell` がマウント時に 1 つだけ呼び出す想定。pending key (`gg`/`dd`、および za の折りたたみ操作) は
 * 再レンダーを発生させたくないため Zustand ストアではなく本フック内部の useRef で保持する
 */
export const useOutlineKeymap = (handlers: OutlineKeymapHandlers): void => {
    const mode = useOutlineStore((state) => state.mode);
    const pendingKeyRef = useRef<PendingKey | null>(null);

    useEffect(() => {
        const resolveDoubleTap = (key: PendingKeyName, nowMs: number): boolean => {
            const pending = pendingKeyRef.current;
            if (pending !== null && pending.key === key && nowMs - pending.timestampMs <= PENDING_KEY_TIMEOUT_MS) {
                pendingKeyRef.current = null;
                return true;
            }
            pendingKeyRef.current = { key, timestampMs: nowMs };
            return false;
        };

        const dispatchNormal = (event: KeyboardEvent, store: OutlineStoreApi): boolean => {
            const nowMs = event.timeStamp;
            switch (event.key) {
                case "j":
                    store.moveCursor("down");
                    return true;
                case "k":
                    store.moveCursor("up");
                    return true;
                case "g":
                    if (resolveDoubleTap("g", nowMs)) {
                        store.jumpToTop();
                    }
                    return true;
                case "G":
                    store.jumpToBottom();
                    return true;
                case "x":
                    handlers.completeCursor();
                    return true;
                case "o":
                    handlers.createBelowCursor();
                    return true;
                case "Enter":
                    handlers.focusDetailEditor();
                    return true;
                case "z":
                    resolveDoubleTap("z", nowMs);
                    return true;
                case "a": {
                    const pending = pendingKeyRef.current;
                    if (pending !== null && pending.key === "z" && nowMs - pending.timestampMs <= PENDING_KEY_TIMEOUT_MS) {
                        pendingKeyRef.current = null;
                        if (store.cursorTaskId !== null) {
                            store.toggleCollapsed(store.cursorTaskId);
                        }
                        return true;
                    }
                    return false;
                }
                case "J":
                    handlers.moveCursorSibling("down");
                    return true;
                case "K":
                    handlers.moveCursorSibling("up");
                    return true;
                case "<":
                    handlers.outdentCursor();
                    return true;
                case ">":
                    handlers.indentCursor();
                    return true;
                case "V":
                    store.enterVisual();
                    return true;
                case "d":
                    if (resolveDoubleTap("d", nowMs)) {
                        handlers.softDeleteCursor();
                    }
                    return true;
                case "/":
                    store.enterSearch();
                    return true;
                default:
                    return false;
            }
        };

        const dispatchVisual = (event: KeyboardEvent, store: OutlineStoreApi): boolean => {
            switch (event.key) {
                case "j":
                    store.extendVisual("down");
                    return true;
                case "k":
                    store.extendVisual("up");
                    return true;
                case "x":
                    handlers.completeSelection();
                    return true;
                case "Escape":
                    store.exitVisual();
                    return true;
                default:
                    return false;
            }
        };

        const dispatchSearch = (event: KeyboardEvent, store: OutlineStoreApi): boolean => {
            // SearchOverlay の入力欄がフォーカスを持つ間は isEditableTarget によりこのハンドラ自体が呼ばれない。
            // フォーカスが外れているような想定外の状態に備えた保険として Esc のみ拾う
            if (event.key === "Escape") {
                store.cancelSearch();
                return true;
            }
            return false;
        };

        const dispatchByMode: Record<OutlineMode, (event: KeyboardEvent, store: OutlineStoreApi) => boolean> = {
            NORMAL: dispatchNormal,
            VISUAL: dispatchVisual,
            SEARCH: dispatchSearch,
        };

        const handleKeyDown = (event: KeyboardEvent): void => {
            if (event.isComposing) {
                return;
            }
            if (isEditableTarget(event.target)) {
                return;
            }
            const store = useOutlineStore.getState();
            const handled = dispatchByMode[mode](event, store);
            if (handled) {
                event.preventDefault();
            }
        };

        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    }, [mode, handlers]);
};
