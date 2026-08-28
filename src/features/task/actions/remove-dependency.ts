"use server";

import { defineTaskAction } from "@/features/task/lib/define-task-action";

/**
 * 依存を削除する (req.md §65)
 *
 * 単純な dependency edge の DELETE であり RPC を経由しない。
 * 依存編集は Op キューの対象外 (SPEC §7) のため、revalidatePath による鮮度担保を現行どおり残す (Issue #70)
 */
export const removeDependency = defineTaskAction<{ taskId: string; dependsOnTaskId: string }>(
    async ({ client, userId }, { taskId, dependsOnTaskId }) => await client.from("task_dependencies").delete().eq("user_id", userId).eq("task_id", taskId).eq("depends_on_task_id", dependsOnTaskId),
    ["/"],
);
