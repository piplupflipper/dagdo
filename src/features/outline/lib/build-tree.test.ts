import { describe, expect, it } from "vitest";
import { buildOutlineTree, collectCollapsibleTaskIds } from "@/features/outline/lib/build-tree";
import type { AppTask } from "@/types/task";

/** 親子関係と並び順に効くカラムだけを指定してタスクを作る (残りは判定に関与しない固定値) */
const task = ({ id, parentId = null, sortPath }: { id: string; parentId?: string | null; sortPath: number[] }): AppTask => ({
    id,
    user_id: "user-1",
    title: id,
    description: "",
    parent_id: parentId,
    effective_parent_id: parentId,
    position: sortPath[sortPath.length - 1] ?? 0,
    sort_path: sortPath,
    due_date: null,
    is_blocked: false,
    completed_at: null,
    created_at: "2026-08-09T00:00:00.000Z",
    updated_at: "2026-08-09T00:00:00.000Z",
});

/**
 * a / b / c の 3 兄弟。b は b1・b2 を持ち、b1 はさらに b1a を持つ
 *
 * 折りたたみが効く行 (子を持つ行) は b と b1 だけになる
 */
const tasks: readonly AppTask[] = [
    task({ id: "a", sortPath: [0] }),
    task({ id: "b", sortPath: [1] }),
    task({ id: "b1", parentId: "b", sortPath: [1, 0] }),
    task({ id: "b1a", parentId: "b1", sortPath: [1, 0, 0] }),
    task({ id: "b2", parentId: "b", sortPath: [1, 1] }),
    task({ id: "c", sortPath: [2] }),
];

describe("collectCollapsibleTaskIds", () => {
    it("子を持つ行だけを表示順で返す", () => {
        expect(collectCollapsibleTaskIds(buildOutlineTree(tasks))).toEqual(["b", "b1"]);
    });

    it("子を持たない行 (葉) は含めない", () => {
        const ids = collectCollapsibleTaskIds(buildOutlineTree(tasks));
        for (const leafId of ["a", "b1a", "b2", "c"]) {
            expect(ids, leafId).not.toContain(leafId);
        }
    });

    it("すべてが葉のツリーでは空になる", () => {
        expect(collectCollapsibleTaskIds(buildOutlineTree([task({ id: "a", sortPath: [0] }), task({ id: "b", sortPath: [1] })]))).toEqual([]);
    });

    it("タスクが 1 件も無ければ空になる", () => {
        expect(collectCollapsibleTaskIds(buildOutlineTree([]))).toEqual([]);
    });
});
