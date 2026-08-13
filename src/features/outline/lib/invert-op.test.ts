import { describe, expect, it } from "vitest";
import { invertOutlineOp } from "@/features/outline/lib/invert-op";
import type { AppTask } from "@/types/task";

/** 逆操作の材料になるカラムだけを指定してタスクを作る (残りは組み立てに関与しない固定値) */
const task = ({
    id,
    title = id,
    description = "",
    parentId = null,
    position = 0,
    dueDate = null,
}: {
    id: string;
    title?: string;
    description?: string;
    parentId?: string | null;
    position?: number;
    dueDate?: string | null;
}): AppTask => ({
    id,
    user_id: "user-1",
    title,
    description,
    parent_id: parentId,
    effective_parent_id: parentId,
    position,
    sort_path: [position],
    due_date: dueDate,
    is_blocked: false,
    completed_at: null,
    created_at: "2026-08-09T00:00:00.000Z",
    updated_at: "2026-08-09T00:00:00.000Z",
});

describe("invertOutlineOp", () => {
    it("complete の逆操作は reopen", () => {
        expect(invertOutlineOp({ type: "complete", taskId: "a" }, [task({ id: "a" })])).toEqual([{ type: "reopen", taskId: "a" }]);
    });

    it("reopen の逆操作は complete", () => {
        expect(invertOutlineOp({ type: "reopen", taskId: "a" }, [task({ id: "a" })])).toEqual([{ type: "complete", taskId: "a" }]);
    });

    it("complete / reopen は対象が tasksSnapshot に無くても組み立てられる (材料を要らないため)", () => {
        expect(invertOutlineOp({ type: "complete", taskId: "missing" }, [])).toEqual([{ type: "reopen", taskId: "missing" }]);
    });

    it("updateTitle の逆操作は変更前のタイトルへ戻す updateTitle", () => {
        const tasks = [task({ id: "a", title: "旧タイトル" })];
        expect(invertOutlineOp({ type: "updateTitle", taskId: "a", title: "新タイトル" }, tasks)).toEqual([{ type: "updateTitle", taskId: "a", title: "旧タイトル" }]);
    });

    it("updateDescription の逆操作は変更前の説明へ戻す updateDescription", () => {
        const tasks = [task({ id: "a", description: "旧説明" })];
        expect(invertOutlineOp({ type: "updateDescription", taskId: "a", description: "新説明" }, tasks)).toEqual([{ type: "updateDescription", taskId: "a", description: "旧説明" }]);
    });

    it("updateDueDate の逆操作は変更前の期日へ戻す updateDueDate (null も保つ)", () => {
        expect(invertOutlineOp({ type: "updateDueDate", taskId: "a", dueDate: "2026-08-20" }, [task({ id: "a", dueDate: null })])).toEqual([{ type: "updateDueDate", taskId: "a", dueDate: null }]);
        expect(invertOutlineOp({ type: "updateDueDate", taskId: "a", dueDate: null }, [task({ id: "a", dueDate: "2026-08-20" })])).toEqual([
            { type: "updateDueDate", taskId: "a", dueDate: "2026-08-20" },
        ]);
    });

    it("move の逆操作は移動前の parent_id / position (rank ではなく実 position) へ戻す move", () => {
        const tasks = [task({ id: "parent" }), task({ id: "a", parentId: "parent", position: 3 })];
        expect(invertOutlineOp({ type: "move", taskId: "a", newParentId: null, newPosition: 0 }, tasks)).toEqual([{ type: "move", taskId: "a", newParentId: "parent", newPosition: 3 }]);
    });

    it("reorder の逆操作は移動前の rank へ戻す reorder (position が飛び番でも rank は詰めた連番)", () => {
        const tasks = [task({ id: "a", position: 0 }), task({ id: "b", position: 5 }), task({ id: "c", position: 9 })];
        expect(invertOutlineOp({ type: "reorder", taskId: "c", newPosition: 0 }, tasks)).toEqual([{ type: "reorder", taskId: "c", newPosition: 2 }]);
    });

    it("reorder は対象が tasksSnapshot に無いとき rank -1 の reorder を返す (組み立て自体は失敗させない)", () => {
        expect(invertOutlineOp({ type: "reorder", taskId: "missing", newPosition: 0 }, [task({ id: "a" })])).toEqual([{ type: "reorder", taskId: "missing", newPosition: -1 }]);
    });

    it("softDelete の逆操作は restore と、削除前の位置へ戻す move の 2 Op 列", () => {
        const target = task({ id: "a", parentId: "parent", position: 2 });
        const tasks = [task({ id: "parent" }), target];
        expect(invertOutlineOp({ type: "softDelete", taskId: "a" }, tasks)).toEqual([
            { type: "restore", taskId: "a", snapshot: target },
            { type: "move", taskId: "a", newParentId: "parent", newPosition: 2 },
        ]);
    });

    it("softDelete の restore が持つ snapshot は削除直前の行そのもの", () => {
        const target = task({ id: "a", title: "消す前のタイトル" });
        const inverted = invertOutlineOp({ type: "softDelete", taskId: "a" }, [target]);
        expect(inverted?.[0]).toEqual({ type: "restore", taskId: "a", snapshot: target });
    });

    it("材料を要る Op は対象が tasksSnapshot に無ければ null", () => {
        expect(invertOutlineOp({ type: "updateTitle", taskId: "missing", title: "x" }, [])).toBeNull();
        expect(invertOutlineOp({ type: "updateDescription", taskId: "missing", description: "x" }, [])).toBeNull();
        expect(invertOutlineOp({ type: "updateDueDate", taskId: "missing", dueDate: null }, [])).toBeNull();
        expect(invertOutlineOp({ type: "move", taskId: "missing", newParentId: null, newPosition: 0 }, [])).toBeNull();
        expect(invertOutlineOp({ type: "softDelete", taskId: "missing" }, [])).toBeNull();
    });

    it("create / restore は履歴の組み立て対象外として null", () => {
        expect(invertOutlineOp({ type: "create", tempId: "temp-1", title: "新規タスク", parentId: null, position: null }, [])).toBeNull();
        expect(invertOutlineOp({ type: "restore", taskId: "a", snapshot: task({ id: "a" }) }, [])).toBeNull();
    });
});
