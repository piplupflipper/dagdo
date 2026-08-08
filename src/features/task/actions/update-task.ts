"use server";

import { revalidatePath } from "next/cache";
import { getSessionUserId } from "@/features/auth/lib/get-session-user";
import type { ActionResult } from "@/features/task/lib/action-result";
import { mapDbErrorOrThrow } from "@/features/task/lib/map-db-error";
import { createAppClient } from "@/lib/supabase/app-client";
import type { Database } from "@/lib/supabase/database.types";

/**
 * title / description / due_date の単純属性を変更する (req.md §61)
 *
 * parent_id / position / dependency の構造変更はここでは扱わない (専用 Action を使う)
 */
export const updateTask = async ({ taskId, title, description, dueDate }: { taskId: string; title?: string; description?: string; dueDate?: string | null }): Promise<ActionResult> => {
    const userId = await getSessionUserId();
    const client = await createAppClient({ userId });

    const updates: Database["public"]["Tables"]["tasks"]["Update"] = {};
    if (title !== undefined) {
        updates.title = title;
    }
    if (description !== undefined) {
        updates.description = description;
    }
    if (dueDate !== undefined) {
        updates.due_date = dueDate;
    }

    const { error } = await client.from("tasks").update(updates).eq("id", taskId).eq("user_id", userId);

    if (error !== null) {
        const mapped = mapDbErrorOrThrow(error);
        return { ok: false, ...mapped };
    }

    revalidatePath("/");
    return { ok: true, data: undefined };
};
