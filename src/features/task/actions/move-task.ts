"use server";

import { defineTaskAction } from "@/features/task/lib/define-task-action";

/**
 * 親変更 (reparent)。move_task RPC を呼ぶ (req.md §54)
 *
 * 旧 sibling group の position 整理・parent_id 変更・新 sibling group の position 整理を
 * 1 トランザクションで行う。親子 cycle の最終保証は DB Trigger が行う。
 *
 * `newPosition` は論理削除済みも含めた実 position であり、`null` は新しい sibling group の末尾を表す
 * (supabase/migrations/20260813000002_move_task_append_to_tail.sql、Issue #53)
 */
export const moveTask = defineTaskAction<{ taskId: string; newParentId: string | null; newPosition: number | null }>(async ({ client }, { taskId, newParentId, newPosition }) => {
    // p_new_parent_id / p_new_position は generated types 上 non-null 型だが、move_task RPC は
    // どちらも NULL (順に「ルート直下への移動」「末尾へ追加」) を受け付ける。
    // generated types が Postgres 関数引数の nullability を反映しない既知の制約であるため、
    // ここでのみ non-null 型へ cast する
    return await client.rpc("move_task", {
        p_task_id: taskId,
        p_new_parent_id: newParentId as string,
        p_new_position: newPosition as number,
    });
});
