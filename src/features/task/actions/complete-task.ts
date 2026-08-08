"use server";

import { revalidatePath } from "next/cache";
import { getSessionUserId } from "@/features/auth/lib/get-session-user";
import type { ActionResult } from "@/features/task/lib/action-result";
import { mapDbErrorOrThrow } from "@/features/task/lib/map-db-error";
import { createAppClient } from "@/lib/supabase/app-client";

/**
 * タスクを完了する (req.md §62)
 *
 * blocked かどうかの最終保証は DB Trigger (trg_check_task_blocked_completion) が行い、
 * blocked の場合 SQLSTATE ET004 (TASK_BLOCKED) を返す。Server Action 側で事前判定はしない
 */
export const completeTask = async ({ taskId }: { taskId: string }): Promise<ActionResult> => {
    const userId = await getSessionUserId();
    const client = await createAppClient({ userId });

    const { error } = await client.from("tasks").update({ completed_at: new Date().toISOString() }).eq("id", taskId).eq("user_id", userId);

    if (error !== null) {
        const mapped = mapDbErrorOrThrow(error);
        return { ok: false, ...mapped };
    }

    revalidatePath("/");
    return { ok: true, data: undefined };
};
