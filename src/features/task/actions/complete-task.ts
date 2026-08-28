"use server";

import { defineTaskAction } from "@/features/task/lib/define-task-action";

/**
 * タスクを完了する (req.md §62)
 *
 * blocked かどうかの最終保証は DB Trigger (trg_check_task_blocked_completion) が行い、
 * blocked の場合 SQLSTATE ET004 (TASK_BLOCKED) を返す。Server Action 側で事前判定はしない
 */
export const completeTask = defineTaskAction<{ taskId: string }>(
    async ({ client, userId }, { taskId }) => await client.from("tasks").update({ completed_at: new Date().toISOString() }).eq("id", taskId).eq("user_id", userId),
);
