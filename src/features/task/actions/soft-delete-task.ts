"use server";

import { defineTaskAction } from "@/features/task/lib/define-task-action";

/**
 * 論理削除 (ゴミ箱へ) (req.md §64)
 *
 * 親子関係・dependency edge は変更しない
 */
export const softDeleteTask = defineTaskAction<{ taskId: string }>(
    ["/", "/trash"],
    async ({ client, userId }, { taskId }) => await client.from("tasks").update({ deleted_at: new Date().toISOString() }).eq("id", taskId).eq("user_id", userId),
);
