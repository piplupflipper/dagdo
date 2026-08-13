import { describe, expect, it } from "vitest";
import { resolveReorderedSiblingIds } from "@/features/outline/lib/outline-ops";
import { siblingRankOf } from "@/features/outline/lib/sibling-rank";
import type { AppTask } from "@/types/task";

/** rank の計算に効くカラムだけを指定してタスクを作る (残りは計算に関与しない固定値) */
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

describe("siblingRankOf", () => {
    it("同一 parent 内を position 昇順に並べたときの 0-based の位置を返す", () => {
        const tasks = [task({ id: "a", position: 0 }), task({ id: "b", position: 1 }), task({ id: "c", position: 2 })];
        expect(siblingRankOf(tasks, "a")).toBe(0);
        expect(siblingRankOf(tasks, "c")).toBe(2);
    });

    it("配列の並び順ではなく position を基準にする", () => {
        const tasks = [task({ id: "c", position: 2 }), task({ id: "a", position: 0 }), task({ id: "b", position: 1 })];
        expect(siblingRankOf(tasks, "c")).toBe(2);
    });

    it("position が飛び番でも rank は詰めた連番になる", () => {
        const tasks = [task({ id: "a", position: 0 }), task({ id: "b", position: 5 }), task({ id: "c", position: 9 })];
        expect(siblingRankOf(tasks, "b")).toBe(1);
        expect(siblingRankOf(tasks, "c")).toBe(2);
    });

    it("actual parent (parent_id) が異なる行は兄弟に数えない", () => {
        const tasks = [task({ id: "root", position: 0 }), task({ id: "x", parentId: "root", position: 0 }), task({ id: "y", parentId: "root", position: 1 })];
        expect(siblingRankOf(tasks, "y")).toBe(1);
        expect(siblingRankOf(tasks, "root")).toBe(0);
    });

    it("対象が tasks に無ければ -1", () => {
        expect(siblingRankOf([task({ id: "a" })], "missing")).toBe(-1);
    });

    it("引数の配列を破壊しない (ソートはコピーに対して行う)", () => {
        const tasks = [task({ id: "c", position: 2 }), task({ id: "a", position: 0 })];
        siblingRankOf(tasks, "a");
        expect(tasks.map((t) => t.id)).toEqual(["c", "a"]);
    });

    it("resolveReorderedSiblingIds と同じ rank 基準である (現在の rank を渡すと並びが変わらない)", () => {
        const tasks = [task({ id: "a", position: 0 }), task({ id: "b", position: 1 }), task({ id: "c", position: 2 })];
        const spec = resolveReorderedSiblingIds(tasks, { taskId: "b", newPosition: siblingRankOf(tasks, "b") });
        expect(spec?.orderedTaskIds).toEqual(["a", "b", "c"]);
    });
});
