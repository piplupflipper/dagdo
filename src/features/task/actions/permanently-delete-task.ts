"use server";

import { defineTaskAction } from "@/features/task/lib/define-task-action";

/**
 * 完全削除。permanently_delete_task RPC を呼ぶ (req.md §57)
 *
 * 子タスクの reparent・関連 dependency edge の削除・対象タスクの DELETE を
 * 1 トランザクションで行う
 */
export const permanentlyDeleteTask = defineTaskAction<{ taskId: string }>(["/", "/trash"], async ({ client }, { taskId }) => await client.rpc("permanently_delete_task", { p_task_id: taskId }));
