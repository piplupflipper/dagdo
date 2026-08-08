"use server";

import { revalidatePath } from "next/cache";
import { getSessionUserId } from "@/features/auth/lib/get-session-user";
import type { ActionResult } from "@/features/task/lib/action-result";
import { mapDbErrorOrThrow } from "@/features/task/lib/map-db-error";
import { createAppClient } from "@/lib/supabase/app-client";

/**
 * 依存を削除する (req.md §65)
 *
 * 単純な dependency edge の DELETE であり RPC を経由しない
 */
export const removeDependency = async ({ taskId, dependsOnTaskId }: { taskId: string; dependsOnTaskId: string }): Promise<ActionResult> => {
    const userId = await getSessionUserId();
    const client = await createAppClient({ userId });

    const { error } = await client.from("task_dependencies").delete().eq("user_id", userId).eq("task_id", taskId).eq("depends_on_task_id", dependsOnTaskId);

    if (error !== null) {
        const mapped = mapDbErrorOrThrow(error);
        return { ok: false, ...mapped };
    }

    revalidatePath("/");
    return { ok: true, data: undefined };
};
