"use server";

import { defineTaskAction } from "@/features/task/lib/define-task-action";

/**
 * 同一 parent 内の並べ替え。reorder_tasks RPC を呼ぶ (req.md §55)
 *
 * 指定された actual sibling group を orderedTaskIds の順に position = 0, 1, 2, ... と
 * 再採番する。対象が同一ユーザー・同一 actual parent であることは RPC 側が検証する
 */
export const reorderTasks = defineTaskAction<{ parentId: string | null; orderedTaskIds: string[] }>(async ({ client }, { parentId, orderedTaskIds }) => {
    // p_parent_id は generated types 上 string 型だが、reorder_tasks RPC (uuid 引数) は
    // NULL (ルート直下の並べ替え) を受け付ける。move-task.ts と同様の理由で cast する
    return await client.rpc("reorder_tasks", {
        p_parent_id: parentId as string,
        p_ordered_task_ids: orderedTaskIds,
    });
});
