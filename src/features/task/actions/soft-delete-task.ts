"use server";

import { revalidatePath } from "next/cache";
import { getSessionUserId } from "@/features/auth/lib/get-session-user";
import type { ActionResult } from "@/features/task/lib/action-result";
import { mapDbErrorOrThrow } from "@/features/task/lib/map-db-error";
import { createAppClient } from "@/lib/supabase/app-client";

/**
 * 論理削除 (ゴミ箱へ) (req.md §64)
 *
 * 親子関係・dependency edge は変更しない
 */
export const softDeleteTask = async ({ taskId }: { taskId: string }): Promise<ActionResult> => {
    const userId = await getSessionUserId();
    const client = await createAppClient({ userId });

    const { error } = await client.from("tasks").update({ deleted_at: new Date().toISOString() }).eq("id", taskId).eq("user_id", userId);

    if (error !== null) {
        const mapped = mapDbErrorOrThrow(error);
        return { ok: false, ...mapped };
    }

    revalidatePath("/");
    revalidatePath("/trash");
    return { ok: true, data: undefined };
};
