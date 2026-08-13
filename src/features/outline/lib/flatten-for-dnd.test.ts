import { describe, expect, it } from "vitest";
import { buildOutlineTree, deriveVisibleRows, type OutlineTreeRow } from "@/features/outline/lib/build-tree";
import { computeCreatePosition, computeDropResult, findSiblingTaskId, flattenForDnd } from "@/features/outline/lib/flatten-for-dnd";
import { resolveReorderedSiblingIds } from "@/features/outline/lib/outline-ops";
import { filterTasks } from "@/features/search/lib/filter-tasks";
import type { AppTask } from "@/types/task";

/** 位置計算に効くカラムだけを指定してタスクを作る (残りは計算に関与しない固定値) */
const task = ({ id, parentId = null, position, title = id, sortPath = [position] }: { id: string; parentId?: string | null; position: number; title?: string; sortPath?: number[] }): AppTask => ({
    id,
    user_id: "user-1",
    title,
    description: "",
    parent_id: parentId,
    effective_parent_id: parentId,
    position,
    sort_path: sortPath,
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

describe("findSiblingTaskId", () => {
    it("`}` (down) は次の兄弟を返し、間の子孫を飛ばす", () => {
        // b の子 b1 は a と c の兄弟ではないため、a → c へ飛ぶ
        expect(findSiblingTaskId({ tasks, taskId: "b", direction: "down" })).toBe("c");
        expect(findSiblingTaskId({ tasks, taskId: "a", direction: "down" })).toBe("b");
    });

    it("`{` (up) は前の兄弟を返す", () => {
        expect(findSiblingTaskId({ tasks, taskId: "c", direction: "up" })).toBe("b");
    });

    it("兄弟の並びは表示上の添字ではなく position 順で見る", () => {
        // 配列の並びが position 順と食い違っていても結果は変わらない
        const shuffled = [task({ id: "c", position: 2 }), task({ id: "a", position: 0 }), task({ id: "b", position: 1 })];
        expect(findSiblingTaskId({ tasks: shuffled, taskId: "a", direction: "down" })).toBe("b");
        expect(findSiblingTaskId({ tasks: shuffled, taskId: "c", direction: "up" })).toBe("b");
    });

    it("兄弟グループの端では null を返す (呼び出し側はカーソルを動かさない)", () => {
        expect(findSiblingTaskId({ tasks, taskId: "a", direction: "up" })).toBeNull();
        expect(findSiblingTaskId({ tasks, taskId: "c", direction: "down" })).toBeNull();
    });

    it("兄弟が 1 件だけの階層ではどちらの向きでも null を返す (親や子へは移らない)", () => {
        expect(findSiblingTaskId({ tasks, taskId: "b1", direction: "up" })).toBeNull();
        expect(findSiblingTaskId({ tasks, taskId: "b1", direction: "down" })).toBeNull();
    });

    it("未知のタスクでは null を返す", () => {
        expect(findSiblingTaskId({ tasks, taskId: "unknown", direction: "down" })).toBeNull();
    });
});

/**
 * Issue #42 の例のツリー
 *
 * ルート直下に a(0) b(1) c(2) d(3) e(4)、b の子として b1(0) b2(1) を持つ。
 * タイトルは「買い物」で絞り込むと b と d だけが残るように付けてある
 */
const dropTasks: readonly AppTask[] = [
    task({ id: "a", position: 0, title: "書類を出す" }),
    task({ id: "b", position: 1, title: "買い物メモ" }),
    task({ id: "c", position: 2, title: "掃除する" }),
    task({ id: "d", position: 3, title: "買い物リスト" }),
    task({ id: "e", position: 4, title: "散歩する" }),
    task({ id: "b1", parentId: "b", position: 0, sortPath: [1, 0], title: "牛乳" }),
    task({ id: "b2", parentId: "b", position: 1, sortPath: [1, 1], title: "卵" }),
];

const rootIds = ["a", "b", "c", "d", "e"] as const;

/** ルート直下の 5 件について、ドラッグ元とドロップ先のすべての組み合わせ */
const rootDragPairs = rootIds.flatMap((activeId) => rootIds.filter((overId) => overId !== activeId).map((overId) => ({ activeId, overId })));

/** reorder になるドロップを実行し、並べ替え後の兄弟の並びを取り出す */
const droppedOrder = ({ tasks: source, activeId, overId, parentId = null }: { tasks: readonly AppTask[]; activeId: string; overId: string; parentId?: string | null }): readonly string[] => {
    const result = computeDropResult({ tasks: source, taskId: activeId, targetParentId: parentId, overTaskId: overId });
    if (result.kind !== "reorder") {
        throw new Error(`reorder を期待したが ${result.kind} が返った`);
    }
    return result.result.orderedTaskIds;
};

/**
 * 可視の兄弟だけを基準にしていた変更前の `handleDragEnd` (outline-pane.tsx) の並べ替え結果
 *
 * 「絞り込みが無ければ変更前と同じ結果になる」ことを比較で固定するために置く。
 * 変更前は可視行から作った兄弟の並びへ `arrayMove` を当てていた (対象を抜き、抜く前にドロップ先が
 * あった添字へ挿し込むのが `arrayMove` の規則である)
 */
const legacyDroppedOrder = ({ visibleRows, activeId, overId, parentId }: { visibleRows: readonly OutlineTreeRow[]; activeId: string; overId: string; parentId: string | null }): string[] => {
    const siblingIds = flattenForDnd(visibleRows)
        .filter((item) => item.parentId === parentId)
        .map((item) => item.id);
    const fromIndex = siblingIds.indexOf(activeId);
    const overIndex = siblingIds.indexOf(overId);
    if (fromIndex >= 0) {
        siblingIds.splice(fromIndex, 1);
    }
    siblingIds.splice(overIndex, 0, activeId);
    return siblingIds;
};

describe("computeDropResult", () => {
    it("上へのドラッグはドロップ先の直前へ入る", () => {
        expect(droppedOrder({ tasks: dropTasks, activeId: "d", overId: "b" })).toEqual(["a", "d", "b", "c", "e"]);
    });

    it("下へのドラッグはドロップ先の直後へ入る", () => {
        expect(droppedOrder({ tasks: dropTasks, activeId: "b", overId: "d" })).toEqual(["a", "c", "d", "b", "e"]);
    });

    it("兄弟の並びは配列の並びではなく position 順で見る", () => {
        const shuffled = [...dropTasks].reverse();
        expect(droppedOrder({ tasks: shuffled, activeId: "d", overId: "b" })).toEqual(["a", "d", "b", "c", "e"]);
    });

    it("絞り込みも折りたたみも無い場合、可視の兄弟を基準にしていた変更前と同じ並びになる", () => {
        const visibleRows = deriveVisibleRows(buildOutlineTree(dropTasks), new Set<string>());
        expect(visibleRows.map((row) => row.task.id)).toEqual(["a", "b", "b1", "b2", "c", "d", "e"]);
        for (const { activeId, overId } of rootDragPairs) {
            expect(droppedOrder({ tasks: dropTasks, activeId, overId })).toEqual(legacyDroppedOrder({ visibleRows, activeId, overId, parentId: null }));
        }
        expect(droppedOrder({ tasks: dropTasks, activeId: "b2", overId: "b1", parentId: "b" })).toEqual(legacyDroppedOrder({ visibleRows, activeId: "b2", overId: "b1", parentId: "b" }));
    });

    it("折りたたみがある場合も変更前と同じ並びになる", () => {
        const visibleRows = deriveVisibleRows(buildOutlineTree(dropTasks), new Set(["b"]));
        // 折りたたみは兄弟グループごと隠す。b を畳むと b1/b2 は 2 件とも消え、ルート直下の 5 件は全部見えたままである。
        // 隠れている b1/b2 へはドロップできないため、可視の兄弟が一部だけ欠けた状態で並べ替えることはない
        expect(visibleRows.map((row) => row.task.id)).toEqual(["a", "b", "c", "d", "e"]);
        for (const { activeId, overId } of rootDragPairs) {
            expect(droppedOrder({ tasks: dropTasks, activeId, overId })).toEqual(legacyDroppedOrder({ visibleRows, activeId, overId, parentId: null }));
        }
    });

    it("絞り込み中に、見えていない兄弟を飛び越えない", () => {
        const matchedIds = new Set(filterTasks({ tasks: dropTasks, query: "買い物" }).map((matched) => matched.id));
        const visibleRows = buildOutlineTree(dropTasks).filter((row) => matchedIds.has(row.task.id));
        expect(visibleRows.map((row) => row.task.id)).toEqual(["b", "d"]);
        // d を b の上へドラッグすると、d は b の直前 (見えていない a の後ろ) へ入る
        expect(droppedOrder({ tasks: dropTasks, activeId: "d", overId: "b" })).toEqual(["a", "d", "b", "c", "e"]);
        // Op が持つのは兄弟内の rank だけであり、Server Action へ渡す並びは全兄弟から再構成される
        expect(resolveReorderedSiblingIds(dropTasks, { taskId: "d", newPosition: 1 })).toEqual({ parentId: null, orderedTaskIds: ["a", "d", "b", "c", "e"] });
        // 変更前は可視の並び [d, b] から rank 0 を求めていたため、再構成後に a を飛び越えて先頭へ入っていた
        expect(legacyDroppedOrder({ visibleRows, activeId: "d", overId: "b", parentId: null }).indexOf("d")).toBe(0);
        expect(resolveReorderedSiblingIds(dropTasks, { taskId: "d", newPosition: 0 })).toEqual({ parentId: null, orderedTaskIds: ["d", "a", "b", "c", "e"] });
    });

    it("親を跨ぐドロップは、ドロップ先の兄弟の中での rank を newPosition にする", () => {
        expect(computeDropResult({ tasks: dropTasks, taskId: "e", targetParentId: "b", overTaskId: "b2" })).toEqual({ kind: "reparent", result: { newParentId: "b", newPosition: 1 } });
        expect(computeDropResult({ tasks: dropTasks, taskId: "b2", targetParentId: null, overTaskId: "c" })).toEqual({ kind: "reparent", result: { newParentId: null, newPosition: 2 } });
    });

    it("ドロップ先がその兄弟グループに属さない場合は末尾へ落とす", () => {
        expect(droppedOrder({ tasks: dropTasks, activeId: "d", overId: "b1" })).toEqual(["a", "b", "c", "e", "d"]);
    });
});
