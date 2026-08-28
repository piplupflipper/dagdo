import { describe, expect, it } from "vitest";
import { validateOutlineOp } from "@/features/outline/lib/validate-op";
import type { AppTask, TaskDependency } from "@/types/task";

const task = ({
    id,
    parentId = null,
    position = 0,
    isBlocked = false,
    completedAt = null,
}: {
    id: string;
    parentId?: string | null;
    position?: number;
    isBlocked?: boolean;
    completedAt?: string | null;
}): AppTask => ({
    id,
    user_id: "user-1",
    title: id,
    description: "",
    parent_id: parentId,
    effective_parent_id: parentId,
    position,
    sort_path: [position],
    due_date: null,
    is_blocked: isBlocked,
    completed_at: completedAt,
    created_at: "2026-08-09T00:00:00.000Z",
    updated_at: "2026-08-09T00:00:00.000Z",
});

const dependency = (taskId: string, dependsOnTaskId: string): TaskDependency => ({
    user_id: "user-1",
    task_id: taskId,
    depends_on_task_id: dependsOnTaskId,
    created_at: "2026-08-09T00:00:00.000Z",
});

describe("validateOutlineOp: TASK_BLOCKED", () => {
    it("complete 対象の is_blocked が true なら TASK_BLOCKED", () => {
        const tasks = [task({ id: "blocker", position: 0 }), task({ id: "blocked", position: 1, isBlocked: true })];
        const result = validateOutlineOp({ type: "complete", taskId: "blocked" }, tasks, [dependency("blocked", "blocker")]);
        expect(result).toEqual({ ok: false, code: "TASK_BLOCKED" });
    });

    it("is_blocked が false でも未完了の依存先が手元にあれば TASK_BLOCKED (View 相当の再計算)", () => {
        const tasks = [task({ id: "blocker", position: 0 }), task({ id: "blocked", position: 1, isBlocked: false })];
        const result = validateOutlineOp({ type: "complete", taskId: "blocked" }, tasks, [dependency("blocked", "blocker")]);
        expect(result).toEqual({ ok: false, code: "TASK_BLOCKED" });
    });

    it("依存先が完了済みなら complete を通す", () => {
        const tasks = [task({ id: "blocker", position: 0, completedAt: "2026-08-09T00:00:00.000Z" }), task({ id: "blocked", position: 1 })];
        const result = validateOutlineOp({ type: "complete", taskId: "blocked" }, tasks, [dependency("blocked", "blocker")]);
        expect(result).toEqual({ ok: true });
    });

    it("依存先が手元に無い (削除済み相当) なら complete を通す", () => {
        const tasks = [task({ id: "blocked", position: 0 })];
        const result = validateOutlineOp({ type: "complete", taskId: "blocked" }, tasks, [dependency("blocked", "gone")]);
        expect(result).toEqual({ ok: true });
    });

    it("complete 対象が手元に無くても TASK_NOT_FOUND にはしない", () => {
        const result = validateOutlineOp({ type: "complete", taskId: "missing" }, [], []);
        expect(result).toEqual({ ok: true });
    });
});

describe("validateOutlineOp: TASK_PARENT_CYCLE", () => {
    it("move の新しい親が対象自身なら TASK_PARENT_CYCLE", () => {
        const tasks = [task({ id: "a", position: 0 })];
        const result = validateOutlineOp({ type: "move", taskId: "a", newParentId: "a", newPosition: 0 }, tasks, []);
        expect(result).toEqual({ ok: false, code: "TASK_PARENT_CYCLE" });
    });

    it("move の新しい親が子孫なら TASK_PARENT_CYCLE", () => {
        const tasks = [task({ id: "a", position: 0 }), task({ id: "b", parentId: "a", position: 0 }), task({ id: "c", parentId: "b", position: 0 })];
        const result = validateOutlineOp({ type: "move", taskId: "a", newParentId: "c", newPosition: 0 }, tasks, []);
        expect(result).toEqual({ ok: false, code: "TASK_PARENT_CYCLE" });
    });

    it("move の新しい親が祖先なら通す", () => {
        const tasks = [task({ id: "a", position: 0 }), task({ id: "b", parentId: "a", position: 0 })];
        const result = validateOutlineOp({ type: "move", taskId: "b", newParentId: null, newPosition: 1 }, tasks, []);
        expect(result).toEqual({ ok: true });
    });
});

describe("validateOutlineOp: INVALID_PARENT", () => {
    it("move の新しい親が手元に無ければ INVALID_PARENT", () => {
        const tasks = [task({ id: "a", position: 0 })];
        const result = validateOutlineOp({ type: "move", taskId: "a", newParentId: "missing", newPosition: 0 }, tasks, []);
        expect(result).toEqual({ ok: false, code: "INVALID_PARENT" });
    });

    it("move の新しい親が null (ルート) なら通す", () => {
        const tasks = [task({ id: "a", parentId: "b", position: 0 }), task({ id: "b", position: 0 })];
        const result = validateOutlineOp({ type: "move", taskId: "a", newParentId: null, newPosition: 1 }, tasks, []);
        expect(result).toEqual({ ok: true });
    });
});

describe("validateOutlineOp: INVALID_POSITION", () => {
    it("create の負の position は INVALID_POSITION", () => {
        const result = validateOutlineOp({ type: "create", id: "t", title: "n", parentId: null, position: -1 }, [], []);
        expect(result).toEqual({ ok: false, code: "INVALID_POSITION" });
    });

    it("create の position は可視兄弟数を超えても通す (削除済み兄弟がいる階層での o の退行防止、Issue #72)", () => {
        // A(0) / B(1, 論理削除済みで手元に無い) / C(2) の兄弟グループで C にカーソルを置いて `o` を押すと、
        // computeCreatePosition は C の実 position + 1 = 3 を返す。手元の可視件数 (2 件) を上限にすると
        // この作成が INVALID_POSITION で弾かれる。create も RPC と同じ負数チェックのみとする
        const tasks = [task({ id: "a", position: 0 }), task({ id: "c", position: 2 })];
        const result = validateOutlineOp({ type: "create", id: "t", title: "n", parentId: null, position: 3 }, tasks, []);
        expect(result).toEqual({ ok: true });
    });

    it("create の position が兄弟数と等しい (末尾挿入) なら通す", () => {
        const tasks = [task({ id: "a", position: 0 })];
        const result = validateOutlineOp({ type: "create", id: "t", title: "n", parentId: null, position: 1 }, tasks, []);
        expect(result).toEqual({ ok: true });
    });

    it("create の position が null なら通す", () => {
        const result = validateOutlineOp({ type: "create", id: "t", title: "n", parentId: null, position: null }, [], []);
        expect(result).toEqual({ ok: true });
    });

    it("move の負の newPosition は INVALID_POSITION", () => {
        const tasks = [task({ id: "a", position: 0 })];
        const result = validateOutlineOp({ type: "move", taskId: "a", newParentId: null, newPosition: -1 }, tasks, []);
        expect(result).toEqual({ ok: false, code: "INVALID_POSITION" });
    });

    it("move の newPosition は可視兄弟数を超えても通す (削除済み兄弟がいる行の dd → undo の退行防止)", () => {
        // A(0) / B(1, 論理削除済みで手元に無い) / C(2) の兄弟グループで C を dd → undo すると、
        // undo は restore + 元の実 position (2) への move になる。手元の可視件数 (restore 後 2 件) を
        // 上限にするとこの move が INVALID_POSITION で黙って弾かれる。move は RPC と同じ負数チェックのみとする
        const tasks = [task({ id: "a", position: 0 }), task({ id: "c", position: 2 })];
        const result = validateOutlineOp({ type: "move", taskId: "c", newParentId: null, newPosition: 2 }, tasks, []);
        expect(result).toEqual({ ok: true });
    });

    it("move の newPosition が null なら通す", () => {
        const tasks = [task({ id: "a", position: 0 })];
        const result = validateOutlineOp({ type: "move", taskId: "a", newParentId: null, newPosition: null }, tasks, []);
        expect(result).toEqual({ ok: true });
    });

    it("reorder の負の newPosition は INVALID_POSITION", () => {
        const tasks = [task({ id: "a", position: 0 }), task({ id: "b", position: 1 })];
        const result = validateOutlineOp({ type: "reorder", taskId: "a", newPosition: -1 }, tasks, []);
        expect(result).toEqual({ ok: false, code: "INVALID_POSITION" });
    });

    it("reorder の newPosition が兄弟数以上なら INVALID_POSITION", () => {
        const tasks = [task({ id: "a", position: 0 }), task({ id: "b", position: 1 })];
        const result = validateOutlineOp({ type: "reorder", taskId: "a", newPosition: 2 }, tasks, []);
        expect(result).toEqual({ ok: false, code: "INVALID_POSITION" });
    });

    it("reorder の newPosition が末尾 rank なら通す", () => {
        const tasks = [task({ id: "a", position: 0 }), task({ id: "b", position: 1 })];
        const result = validateOutlineOp({ type: "reorder", taskId: "a", newPosition: 1 }, tasks, []);
        expect(result).toEqual({ ok: true });
    });

    it("reorder 対象が手元に無くても TASK_NOT_FOUND にはしない", () => {
        const result = validateOutlineOp({ type: "reorder", taskId: "missing", newPosition: 99 }, [], []);
        expect(result).toEqual({ ok: true });
    });
});

describe("validateOutlineOp: 対象外の Op", () => {
    it("updateTitle / reopen / softDelete は常に通す", () => {
        const tasks = [task({ id: "a", position: 0 })];
        expect(validateOutlineOp({ type: "updateTitle", taskId: "a", title: "x" }, tasks, [])).toEqual({ ok: true });
        expect(validateOutlineOp({ type: "reopen", taskId: "a" }, tasks, [])).toEqual({ ok: true });
        expect(validateOutlineOp({ type: "softDelete", taskId: "a" }, tasks, [])).toEqual({ ok: true });
    });
});
