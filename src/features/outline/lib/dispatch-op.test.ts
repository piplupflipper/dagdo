import { beforeEach, describe, expect, it, vi } from "vitest";
import { callServerForOp } from "@/features/outline/lib/dispatch-op";
import type { OutlineOp } from "@/features/outline/lib/outline-ops";
import { completeTask } from "@/features/task/actions/complete-task";
import { createTask } from "@/features/task/actions/create-task";
import { moveTask } from "@/features/task/actions/move-task";
import { reopenTask } from "@/features/task/actions/reopen-task";
import { reorderTasks } from "@/features/task/actions/reorder-tasks";
import { restoreTask } from "@/features/task/actions/restore-task";
import { softDeleteTask } from "@/features/task/actions/soft-delete-task";
import { updateTask } from "@/features/task/actions/update-task";
import type { AppTask } from "@/types/task";

/**
 * Server Action 本体はセッションと Supabase クライアントを要するため、モジュールごと差し替える。
 * ここで確かめるのは「どの Op がどの Action へ、どの引数で振り分けられるか」だけである
 */
const ok = { ok: true, data: undefined } as const;
vi.mock("@/features/task/actions/create-task", () => ({ createTask: vi.fn(async () => ({ ok: true, data: { id: "created-1" } })) }));
vi.mock("@/features/task/actions/complete-task", () => ({ completeTask: vi.fn(async () => ok) }));
vi.mock("@/features/task/actions/reopen-task", () => ({ reopenTask: vi.fn(async () => ok) }));
vi.mock("@/features/task/actions/update-task", () => ({ updateTask: vi.fn(async () => ok) }));
vi.mock("@/features/task/actions/move-task", () => ({ moveTask: vi.fn(async () => ok) }));
vi.mock("@/features/task/actions/reorder-tasks", () => ({ reorderTasks: vi.fn(async () => ok) }));
vi.mock("@/features/task/actions/soft-delete-task", () => ({ softDeleteTask: vi.fn(async () => ok) }));
vi.mock("@/features/task/actions/restore-task", () => ({ restoreTask: vi.fn(async () => ok) }));

/** 並べ替えの再構成に効くカラムだけを指定してタスクを作る (残りは計算に関与しない固定値) */
const task = ({ id, parentId = null, position = 0 }: { id: string; parentId?: string | null; position?: number }): AppTask => ({
    id,
    user_id: "user-1",
    title: id,
    description: "",
    parent_id: parentId,
    effective_parent_id: parentId,
    position,
    sort_path: [position],
    due_date: null,
    is_blocked: false,
    completed_at: null,
    created_at: "2026-08-09T00:00:00.000Z",
    updated_at: "2026-08-09T00:00:00.000Z",
});

const siblings = [task({ id: "a", position: 0 }), task({ id: "b", position: 1 }), task({ id: "c", position: 2 })];

beforeEach(() => {
    vi.clearAllMocks();
});

describe("callServerForOp: Op から Server Action への振り分け", () => {
    it("create は tempId を渡さず title / parentId / position だけを渡す", async () => {
        await callServerForOp({ type: "create", tempId: "temp-1", title: "新しいタスク", parentId: "parent-1", position: 2 }, []);
        expect(createTask).toHaveBeenCalledWith({ title: "新しいタスク", parentId: "parent-1", position: 2 });
    });

    it("complete は completeTask を呼ぶ", async () => {
        await callServerForOp({ type: "complete", taskId: "t1" }, []);
        expect(completeTask).toHaveBeenCalledWith({ taskId: "t1" });
    });

    it("reopen は reopenTask を呼ぶ", async () => {
        await callServerForOp({ type: "reopen", taskId: "t1" }, []);
        expect(reopenTask).toHaveBeenCalledWith({ taskId: "t1" });
    });

    it("updateTitle / updateDescription / updateDueDate は updateTask の別フィールドへ振り分ける", async () => {
        await callServerForOp({ type: "updateTitle", taskId: "t1", title: "新題" }, []);
        expect(updateTask).toHaveBeenCalledWith({ taskId: "t1", title: "新題" });

        await callServerForOp({ type: "updateDescription", taskId: "t1", description: "説明" }, []);
        expect(updateTask).toHaveBeenCalledWith({ taskId: "t1", description: "説明" });

        await callServerForOp({ type: "updateDueDate", taskId: "t1", dueDate: "2026-08-20" }, []);
        expect(updateTask).toHaveBeenCalledWith({ taskId: "t1", dueDate: "2026-08-20" });
    });

    it("updateDueDate は期日の解除 (null) もそのまま渡す", async () => {
        await callServerForOp({ type: "updateDueDate", taskId: "t1", dueDate: null }, []);
        expect(updateTask).toHaveBeenCalledWith({ taskId: "t1", dueDate: null });
    });

    it("move は moveTask を呼ぶ", async () => {
        await callServerForOp({ type: "move", taskId: "t1", newParentId: null, newPosition: 3 }, []);
        expect(moveTask).toHaveBeenCalledWith({ taskId: "t1", newParentId: null, newPosition: 3 });
    });

    it("softDelete は softDeleteTask を呼ぶ", async () => {
        await callServerForOp({ type: "softDelete", taskId: "t1" }, []);
        expect(softDeleteTask).toHaveBeenCalledWith({ taskId: "t1" });
    });

    it("restore は snapshot を渡さず taskId だけで restoreTask を呼ぶ", async () => {
        await callServerForOp({ type: "restore", taskId: "t1", snapshot: task({ id: "t1" }) }, []);
        expect(restoreTask).toHaveBeenCalledWith({ taskId: "t1" });
    });
});

describe("callServerForOp: reorder の再構成", () => {
    it("rank (newPosition) を tasksSnapshot から orderedTaskIds へ再構成して渡す", async () => {
        await callServerForOp({ type: "reorder", taskId: "c", newPosition: 0 }, siblings);
        expect(reorderTasks).toHaveBeenCalledWith({ parentId: null, orderedTaskIds: ["c", "a", "b"] });
    });

    it("actual parent が同じ兄弟だけを並べ替えの対象にする", async () => {
        const tasks = [task({ id: "root", position: 0 }), task({ id: "x", parentId: "root", position: 0 }), task({ id: "y", parentId: "root", position: 1 })];
        await callServerForOp({ type: "reorder", taskId: "x", newPosition: 1 }, tasks);
        expect(reorderTasks).toHaveBeenCalledWith({ parentId: "root", orderedTaskIds: ["y", "x"] });
    });

    it("対象が tasksSnapshot に無ければ Server Action を呼ばず成功を返す", async () => {
        const result = await callServerForOp({ type: "reorder", taskId: "missing", newPosition: 0 }, siblings);
        expect(reorderTasks).not.toHaveBeenCalled();
        expect(result).toEqual({ ok: true, data: undefined });
    });
});

describe("callServerForOp: 戻り値", () => {
    it("Server Action の戻り値をそのまま返す (失敗もそのまま伝える)", async () => {
        vi.mocked(completeTask).mockResolvedValueOnce({ ok: false, code: "TASK_BLOCKED", message: "task is blocked" });
        const result = await callServerForOp({ type: "complete", taskId: "t1" }, []);
        expect(result).toEqual({ ok: false, code: "TASK_BLOCKED", message: "task is blocked" });
    });

    it("create の戻り値 (実 id) も欠落させずに返す", async () => {
        const result = await callServerForOp({ type: "create", tempId: "temp-1", title: "t", parentId: null, position: null }, []);
        expect(result).toEqual({ ok: true, data: { id: "created-1" } });
    });
});

describe("callServerForOp: 網羅性", () => {
    it("OutlineOp の全 type が Server Action へ振り分けられる (未処理の分岐で undefined を返さない)", async () => {
        const ops: readonly OutlineOp[] = [
            { type: "create", tempId: "temp-1", title: "t", parentId: null, position: null },
            { type: "complete", taskId: "a" },
            { type: "reopen", taskId: "a" },
            { type: "updateTitle", taskId: "a", title: "t" },
            { type: "updateDescription", taskId: "a", description: "d" },
            { type: "updateDueDate", taskId: "a", dueDate: null },
            { type: "move", taskId: "a", newParentId: null, newPosition: 0 },
            { type: "reorder", taskId: "a", newPosition: 1 },
            { type: "softDelete", taskId: "a" },
            { type: "restore", taskId: "a", snapshot: task({ id: "a" }) },
        ];
        for (const op of ops) {
            await expect(callServerForOp(op, siblings)).resolves.toBeDefined();
        }
    });
});
