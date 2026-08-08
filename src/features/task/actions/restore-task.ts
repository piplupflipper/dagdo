"use server";

import { revalidatePath } from "next/cache";
import { getSessionUserId } from "@/features/auth/lib/get-session-user";
import type { ActionResult } from "@/features/task/lib/action-result";
import { mapDbErrorOrThrow } from "@/features/task/lib/map-db-error";
import { createAppClient } from "@/lib/supabase/app-client";

/**
 * ゴミ箱から復元する。restore_task RPC を呼ぶ (req.md §56)
 *
 * actual parent は変更せず、actual sibling group の末尾へ position を移動する
 */
export const restoreTask = async ({ taskId }: { taskId: string }): Promise<ActionResult> => {
    const userId = await getSessionUserId();
    const client = await createAppClient({ userId });

    const { error } = await client.rpc("restore_task", { p_task_id: taskId });

    if (error !== null) {
        const mapped = mapDbErrorOrThrow(error);
        return { ok: false, ...mapped };
    }

    revalidatePath("/");
    revalidatePath("/trash");
    return { ok: true, data: undefined };
};
