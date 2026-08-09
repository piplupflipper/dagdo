import { describe, expect, it } from "vitest";
import { computeCreatePosition } from "@/features/outline/lib/flatten-for-dnd";
import type { AppTask } from "@/types/task";

/** 位置計算に効くカラムだけを指定してタスクを作る (残りは計算に関与しない固定値) */
const task = ({ id, parentId = null, position }: { id: string; parentId?: string | null; position: number }): AppTask => ({
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

/** ルート直下に a / b / c、b の子として b1 を持つツリー */
const tasks: readonly AppTask[] = [task({ id: "a", position: 0 }), task({ id: "b", position: 1 }), task({ id: "c", position: 2 }), task({ id: "b1", parentId: "b", position: 0 })];

describe("computeCreatePosition", () => {
    it("`O` (above) はカーソル行と同じ位置を返す (カーソル行は 1 つ下へ押し出される)", () => {
        expect(computeCreatePosition({ tasks, cursorTaskId: "b", placement: "above" })).toBe(1);
    });

    it("`o` (below) はカーソル行の次の位置を返す", () => {
        expect(computeCreatePosition({ tasks, cursorTaskId: "b", placement: "below" })).toBe(2);
    });

    it("先頭行の above は 0 になる", () => {
        expect(computeCreatePosition({ tasks, cursorTaskId: "a", placement: "above" })).toBe(0);
    });

    it("末尾行の below は兄弟グループ末尾への追加になる", () => {
        expect(computeCreatePosition({ tasks, cursorTaskId: "c", placement: "below" })).toBe(3);
    });

    it("子タスクの位置は同じ actual parent の兄弟グループ内で数える", () => {
        expect(computeCreatePosition({ tasks, cursorTaskId: "b1", placement: "above" })).toBe(0);
        expect(computeCreatePosition({ tasks, cursorTaskId: "b1", placement: "below" })).toBe(1);
    });

    // app_tasks View は論理削除済みを除外するため、表示上の並び順の添字を基準にすると
    // `o` で作ったタスクがカーソル行の手前に入ってしまう
    it("同じ兄弟グループに論理削除済みタスクが残っていても、表示上の添字ではなく実 position を基準にする", () => {
        // A(0) / B(1, 論理削除済みのため一覧に現れない) / C(2)
        const withDeletedSibling = [task({ id: "a", position: 0 }), task({ id: "c", position: 2 })];
        expect(computeCreatePosition({ tasks: withDeletedSibling, cursorTaskId: "c", placement: "below" })).toBe(3);
        expect(computeCreatePosition({ tasks: withDeletedSibling, cursorTaskId: "c", placement: "above" })).toBe(2);
    });

    it("カーソル未選択・未知のタスクでは null (兄弟グループ末尾への作成) を返す", () => {
        expect(computeCreatePosition({ tasks, cursorTaskId: null, placement: "below" })).toBeNull();
        expect(computeCreatePosition({ tasks, cursorTaskId: "unknown", placement: "below" })).toBeNull();
    });
});
