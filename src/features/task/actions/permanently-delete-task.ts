"use server";

import { revalidatePath } from "next/cache";
import { getSessionUserId } from "@/features/auth/lib/get-session-user";
import type { ActionResult } from "@/features/task/lib/action-result";
import { mapDbErrorOrThrow } from "@/features/task/lib/map-db-error";
import { createAppClient } from "@/lib/supabase/app-client";

/**
 * 完全削除。permanently_delete_task RPC を呼ぶ (req.md §57)
 *
 * 子タスクの reparent・関連 dependency edge の削除・対象タスクの DELETE を
 * 1 トランザクションで行う
 */
export const permanentlyDeleteTask = async ({ taskId }: { taskId: string }): Promise<ActionResult> => {
    const userId = await getSessionUserId();
    const client = await createAppClient({ userId });

    const { error } = await client.rpc("permanently_delete_task", { p_task_id: taskId });

    if (error !== null) {
        const mapped = mapDbErrorOrThrow(error);
        return { ok: false, ...mapped };
    }

    revalidatePath("/");
    revalidatePath("/trash");
    return { ok: true, data: undefined };
};
