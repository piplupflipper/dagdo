"use server";

import { defineTaskAction } from "@/features/task/lib/define-task-action";

/**
 * 完了済みタスクを未完了へ戻す (req.md §63)
 *
 * 依存している他の完了済みタスクは変更しない
 */
export const reopenTask = defineTaskAction<{ taskId: string }>(
    ["/"],
    async ({ client, userId }, { taskId }) => await client.from("tasks").update({ completed_at: null }).eq("id", taskId).eq("user_id", userId),
);
