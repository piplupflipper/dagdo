"use server";

import { revalidatePath } from "next/cache";
import { getSessionUserId } from "@/features/auth/lib/get-session-user";
import type { ActionResult } from "@/features/task/lib/action-result";
import { mapDbErrorOrThrow } from "@/features/task/lib/map-db-error";
import { createAppClient } from "@/lib/supabase/app-client";

/**
 * 完了済みタスクを未完了へ戻す (req.md §63)
 *
 * 依存している他の完了済みタスクは変更しない
 */
export const reopenTask = async ({ taskId }: { taskId: string }): Promise<ActionResult> => {
    const userId = await getSessionUserId();
    const client = await createAppClient({ userId });

    const { error } = await client.from("tasks").update({ completed_at: null }).eq("id", taskId).eq("user_id", userId);

    if (error !== null) {
        const mapped = mapDbErrorOrThrow(error);
        return { ok: false, ...mapped };
    }

    revalidatePath("/");
    return { ok: true, data: undefined };
};
