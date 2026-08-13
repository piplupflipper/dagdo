import type { AppTask } from "@/types/task";

/**
 * 同一 actual parent 内での、タスクの現在の並び順 (0-based rank) を返す (undo/redo の逆操作の材料)
 *
 * `reorder` Op の `newPosition` (rank) と同じ基準で「今どこにいるか」を求める。
 * `outline-ops.ts` の `resolveReorderedSiblingIds` と対になる、逆方向の解決。
 * 対象が `tasks` に無い場合は rank を決められないため `-1` を返す
 */
export const siblingRankOf = (tasks: readonly AppTask[], taskId: string): number => {
    const target = tasks.find((task) => task.id === taskId);
    if (target === undefined) {
        return -1;
    }
    return [...tasks]
        .filter((task) => task.parent_id === target.parent_id)
        .sort((a, b) => a.position - b.position)
        .findIndex((task) => task.id === taskId);
};
