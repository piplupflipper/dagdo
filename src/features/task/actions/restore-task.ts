"use server";

import { defineTaskAction } from "@/features/task/lib/define-task-action";

/**
 * ゴミ箱から復元する。restore_task RPC を呼ぶ (req.md §56)
 *
 * actual parent は変更せず、actual sibling group の末尾へ position を移動する
 */
export const restoreTask = defineTaskAction<{ taskId: string }>(async ({ client }, { taskId }) => await client.rpc("restore_task", { p_task_id: taskId }));
