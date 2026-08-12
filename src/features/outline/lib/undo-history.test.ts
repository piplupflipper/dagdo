import { describe, expect, it } from "vitest";
import { EMPTY_UNDO_HISTORY, popRedoEntry, popUndoEntry, pushToRedo, pushToUndo, recordEntry, type UndoEntry } from "@/features/outline/lib/undo-history";
import type { AppTask } from "@/types/task";

const entry = (label: string): UndoEntry => ({ label, undoOps: [{ type: "reopen", taskId: "t" }], redoOps: [{ type: "complete", taskId: "t" }] });

const snapshot = (id: string): AppTask => ({
    id,
    user_id: "user-1",
    title: id,
    description: "",
    parent_id: "parent-1",
    effective_parent_id: "parent-1",
    position: 2,
    sort_path: [0, 2],
    due_date: null,
    is_blocked: false,
    completed_at: null,
    created_at: "2026-08-09T00:00:00.000Z",
    updated_at: "2026-08-09T00:00:00.000Z",
});

/**
 * softDelete の undo エントリ (outline-shell.tsx の softDeleteCursor)。
 *
 * restore_task RPC が末尾へ position を移す仕様のため、undoOps は `restore` 単独ではなく
 * `[restore(snapshot), move(元の parent_id・position へ)]` の 2 Op 列になる (docs/frontend-design.md §5.2)。
 * redoOps (再 softDelete) は 1 Op のまま
 */
const softDeleteEntry = (taskId: string): UndoEntry => ({
    label: "ゴミ箱へ移動",
    undoOps: [
        { type: "restore", taskId, snapshot: snapshot(taskId) },
        { type: "move", taskId, newParentId: "parent-1", newPosition: 2 },
    ],
    redoOps: [{ type: "softDelete", taskId }],
});

describe("recordEntry", () => {
    it("undo スタックへ積む", () => {
        const state = recordEntry(EMPTY_UNDO_HISTORY, entry("a"));
        expect(state.undoStack.map((e) => e.label)).toEqual(["a"]);
    });

    it("新しい操作が確定すると redo スタックを破棄する (vim 準拠)", () => {
        const afterUndo = { undoStack: [], redoStack: [entry("undone")] };
        const state = recordEntry(afterUndo, entry("new"));
        expect(state.redoStack).toEqual([]);
        expect(state.undoStack.map((e) => e.label)).toEqual(["new"]);
    });

    it("100 件を超えると古いものから捨てる", () => {
        let state = EMPTY_UNDO_HISTORY;
        for (let i = 0; i < 105; i += 1) {
            state = recordEntry(state, entry(`entry-${i}`));
        }
        expect(state.undoStack.length).toBe(100);
        expect(state.undoStack[0]?.label).toBe("entry-5");
        expect(state.undoStack[99]?.label).toBe("entry-104");
    });
});

describe("popUndoEntry / popRedoEntry", () => {
    it("undo スタックの末尾を取り出す (LIFO)", () => {
        let state = recordEntry(EMPTY_UNDO_HISTORY, entry("a"));
        state = recordEntry(state, entry("b"));
        const popped = popUndoEntry(state);
        expect(popped?.entry.label).toBe("b");
        expect(popped?.rest.undoStack.map((e) => e.label)).toEqual(["a"]);
    });

    it("空の undo スタックは null を返す", () => {
        expect(popUndoEntry(EMPTY_UNDO_HISTORY)).toBeNull();
    });

    it("空の redo スタックは null を返す", () => {
        expect(popRedoEntry(EMPTY_UNDO_HISTORY)).toBeNull();
    });
});

describe("pushToRedo / pushToUndo", () => {
    it("undo (u) の実行後、対応する entry を redo スタックへ積む", () => {
        const initial = recordEntry(EMPTY_UNDO_HISTORY, entry("a"));
        const popped = popUndoEntry(initial);
        expect(popped).not.toBeNull();
        if (popped === null) {
            return;
        }
        const afterUndo = pushToRedo(popped.rest, popped.entry);
        expect(afterUndo.undoStack).toEqual([]);
        expect(afterUndo.redoStack.map((e) => e.label)).toEqual(["a"]);
    });

    it("redo (U) の実行後、対応する entry を undo スタックへ積み直す (元の undo スタックは保たれる)", () => {
        const initial = recordEntry(EMPTY_UNDO_HISTORY, entry("a"));
        const undone = pushToRedo(popUndoEntry(initial)?.rest ?? EMPTY_UNDO_HISTORY, entry("a"));
        const redone = recordEntry(EMPTY_UNDO_HISTORY, entry("kept")); // 別の確定操作が undo スタックに残っている前提を模す
        const state = { undoStack: redone.undoStack, redoStack: undone.redoStack };

        const popped = popRedoEntry(state);
        expect(popped).not.toBeNull();
        if (popped === null) {
            return;
        }
        const afterRedo = pushToUndo(popped.rest, popped.entry);
        expect(afterRedo.redoStack).toEqual([]);
        expect(afterRedo.undoStack.map((e) => e.label)).toEqual(["kept", "a"]);
    });

    it("undo を繰り返して積んだ redo は複数件 LIFO で取り出せる", () => {
        let state = recordEntry(EMPTY_UNDO_HISTORY, entry("a"));
        state = recordEntry(state, entry("b"));

        const firstPop = popUndoEntry(state);
        if (firstPop === null) {
            throw new Error("unreachable");
        }
        state = pushToRedo(firstPop.rest, firstPop.entry); // "b" を undo

        const secondPop = popUndoEntry(state);
        if (secondPop === null) {
            throw new Error("unreachable");
        }
        state = pushToRedo(secondPop.rest, secondPop.entry); // "a" を undo

        expect(state.redoStack.map((e) => e.label)).toEqual(["b", "a"]);
        const redoPop = popRedoEntry(state);
        expect(redoPop?.entry.label).toBe("a");
    });
});

describe("softDelete のような複数 Op のエントリ (restore + move)", () => {
    it("undoOps が [restore, move] の順のまま undo スタックへ積まれる", () => {
        const state = recordEntry(EMPTY_UNDO_HISTORY, softDeleteEntry("task-1"));
        expect(state.undoStack[0]?.undoOps.map((op) => op.type)).toEqual(["restore", "move"]);
        expect(state.undoStack[0]?.redoOps.map((op) => op.type)).toEqual(["softDelete"]);
    });

    it("pop しても undoOps の内容 (restore の snapshot・move の元位置) が変わらず取り出せる", () => {
        const state = recordEntry(EMPTY_UNDO_HISTORY, softDeleteEntry("task-1"));
        const popped = popUndoEntry(state);
        expect(popped).not.toBeNull();
        if (popped === null) {
            return;
        }
        const [restoreOp, moveOp] = popped.entry.undoOps;
        expect(restoreOp).toEqual({ type: "restore", taskId: "task-1", snapshot: snapshot("task-1") });
        expect(moveOp).toEqual({ type: "move", taskId: "task-1", newParentId: "parent-1", newPosition: 2 });
    });

    it("undo (u) 実行後、redo スタックへ積み直しても 2 Op のエントリが保たれる (U で再 softDelete する側は 1 Op のまま)", () => {
        const initial = recordEntry(EMPTY_UNDO_HISTORY, softDeleteEntry("task-1"));
        const popped = popUndoEntry(initial);
        expect(popped).not.toBeNull();
        if (popped === null) {
            return;
        }
        const afterUndo = pushToRedo(popped.rest, popped.entry);
        expect(afterUndo.undoStack).toEqual([]);
        expect(afterUndo.redoStack[0]?.undoOps.map((op) => op.type)).toEqual(["restore", "move"]);
        expect(afterUndo.redoStack[0]?.redoOps).toEqual([{ type: "softDelete", taskId: "task-1" }]);
    });
});
