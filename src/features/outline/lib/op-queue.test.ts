import { describe, expect, it } from "vitest";
import { EMPTY_OP_QUEUE, enqueueOp, type OpQueueEntry } from "@/features/outline/lib/op-queue";
import type { OutlineOp } from "@/features/outline/lib/outline-ops";
import type { AppTask } from "@/types/task";

const task = (id: string, position = 0): AppTask => ({
    id,
    user_id: "user-1",
    title: id,
    description: "",
    parent_id: null,
    effective_parent_id: null,
    position,
    sort_path: [position],
    due_date: null,
    is_blocked: false,
    completed_at: null,
    created_at: "2026-08-09T00:00:00.000Z",
    updated_at: "2026-08-09T00:00:00.000Z",
});

const snapshotA: AppTask[] = [task("a", 0)];
const snapshotB: AppTask[] = [task("a", 0), task("b", 1)];

const entry = (op: OutlineOp, tasksSnapshot: AppTask[] = snapshotA): OpQueueEntry => ({ op, tasksSnapshot });

describe("enqueueOp", () => {
    it("空キューへ末尾追加する", () => {
        const next = enqueueOp(EMPTY_OP_QUEUE, entry({ type: "complete", taskId: "a" }));
        expect(next).toHaveLength(1);
        expect(next[0]?.op).toEqual({ type: "complete", taskId: "a" });
    });

    it("元のキューを変更しない", () => {
        const original = enqueueOp(EMPTY_OP_QUEUE, entry({ type: "complete", taskId: "a" }));
        enqueueOp(original, entry({ type: "complete", taskId: "b" }));
        expect(original).toHaveLength(1);
    });

    it("coalesce 対象外の種別は連続しても末尾追加する", () => {
        const queued = enqueueOp(EMPTY_OP_QUEUE, entry({ type: "complete", taskId: "a" }));
        const next = enqueueOp(queued, entry({ type: "complete", taskId: "a" }));
        expect(next).toHaveLength(2);
    });

    it("同一 taskId の連続する updateTitle は後の Op で前を置き換える", () => {
        const queued = enqueueOp(EMPTY_OP_QUEUE, entry({ type: "updateTitle", taskId: "a", title: "one" }));
        const next = enqueueOp(queued, entry({ type: "updateTitle", taskId: "a", title: "two" }));
        expect(next).toHaveLength(1);
        expect(next[0]?.op).toEqual({ type: "updateTitle", taskId: "a", title: "two" });
    });

    it("同一 taskId の連続する updateDescription は後の Op で前を置き換える", () => {
        const queued = enqueueOp(EMPTY_OP_QUEUE, entry({ type: "updateDescription", taskId: "a", description: "one" }));
        const next = enqueueOp(queued, entry({ type: "updateDescription", taskId: "a", description: "two" }));
        expect(next).toHaveLength(1);
        expect(next[0]?.op).toEqual({ type: "updateDescription", taskId: "a", description: "two" });
    });

    it("同一 taskId の連続する updateDueDate は後の Op で前を置き換える", () => {
        const queued = enqueueOp(EMPTY_OP_QUEUE, entry({ type: "updateDueDate", taskId: "a", dueDate: "2026-08-01" }));
        const next = enqueueOp(queued, entry({ type: "updateDueDate", taskId: "a", dueDate: null }));
        expect(next).toHaveLength(1);
        expect(next[0]?.op).toEqual({ type: "updateDueDate", taskId: "a", dueDate: null });
    });

    it("同一 taskId の連続する reorder は後の Op で前を置き換え、tasksSnapshot は前のエントリのものを残す", () => {
        const queued = enqueueOp(EMPTY_OP_QUEUE, entry({ type: "reorder", taskId: "a", newPosition: 0 }, snapshotA));
        const next = enqueueOp(queued, entry({ type: "reorder", taskId: "a", newPosition: 2 }, snapshotB));
        expect(next).toHaveLength(1);
        expect(next[0]?.op).toEqual({ type: "reorder", taskId: "a", newPosition: 2 });
        expect(next[0]?.tasksSnapshot).toBe(snapshotA);
    });

    it("taskId が違う連続する同種 Op は coalesce しない", () => {
        const queued = enqueueOp(EMPTY_OP_QUEUE, entry({ type: "updateTitle", taskId: "a", title: "one" }));
        const next = enqueueOp(queued, entry({ type: "updateTitle", taskId: "b", title: "two" }));
        expect(next).toHaveLength(2);
    });

    it("種別が違う連続する Op は同一 taskId でも coalesce しない", () => {
        const queued = enqueueOp(EMPTY_OP_QUEUE, entry({ type: "updateTitle", taskId: "a", title: "one" }));
        const next = enqueueOp(queued, entry({ type: "updateDescription", taskId: "a", description: "two" }));
        expect(next).toHaveLength(2);
    });

    it("間に他の Op がある同種同 taskId は coalesce しない", () => {
        const first = enqueueOp(EMPTY_OP_QUEUE, entry({ type: "updateTitle", taskId: "a", title: "one" }));
        const interrupted = enqueueOp(first, entry({ type: "complete", taskId: "a" }));
        const next = enqueueOp(interrupted, entry({ type: "updateTitle", taskId: "a", title: "two" }));
        expect(next).toHaveLength(3);
        expect(next[0]?.op).toEqual({ type: "updateTitle", taskId: "a", title: "one" });
        expect(next[2]?.op).toEqual({ type: "updateTitle", taskId: "a", title: "two" });
    });

    it("連続 coalesce を繰り返しても reorder の snapshot は最初のエントリのまま", () => {
        const first = enqueueOp(EMPTY_OP_QUEUE, entry({ type: "reorder", taskId: "a", newPosition: 0 }, snapshotA));
        const second = enqueueOp(first, entry({ type: "reorder", taskId: "a", newPosition: 1 }, snapshotB));
        const third = enqueueOp(second, entry({ type: "reorder", taskId: "a", newPosition: 2 }, [task("c")]));
        expect(third).toHaveLength(1);
        expect(third[0]?.op).toEqual({ type: "reorder", taskId: "a", newPosition: 2 });
        expect(third[0]?.tasksSnapshot).toBe(snapshotA);
    });
});
