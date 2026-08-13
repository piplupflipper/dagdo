"use server";

import { defineTaskAction } from "@/features/task/lib/define-task-action";

/**
 * 親変更 (reparent)。move_task RPC を呼ぶ (req.md §54)
 *
 * 旧 sibling group の position 整理・parent_id 変更・新 sibling group の position 整理を
 * 1 トランザクションで行う。親子 cycle の最終保証は DB Trigger が行う
 */
export const moveTask = defineTaskAction<{ taskId: string; newParentId: string | null; newPosition: number }>(["/"], async ({ client }, { taskId, newParentId, newPosition }) => {
    // p_new_parent_id は generated types 上 string 型だが、move_task RPC (uuid 引数) は
    // NULL (ルート直下への移動) を受け付ける。generated types が Postgres 関数引数の
    // nullability を反映しない既知の制約であるため、ここでのみ string へ cast する
    return await client.rpc("move_task", {
        p_task_id: taskId,
        p_new_parent_id: newParentId as string,
        p_new_position: newPosition,
    });
});
