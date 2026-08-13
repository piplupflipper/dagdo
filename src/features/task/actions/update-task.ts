"use server";

import { defineTaskAction } from "@/features/task/lib/define-task-action";
import type { Database } from "@/lib/supabase/database.types";

/**
 * title / description / due_date の単純属性を変更する (req.md §61)
 *
 * parent_id / position / dependency の構造変更はここでは扱わない (専用 Action を使う)
 */
export const updateTask = defineTaskAction<{ taskId: string; title?: string; description?: string; dueDate?: string | null }>(
    ["/"],
    async ({ client, userId }, { taskId, title, description, dueDate }) => {
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

        return await client.from("tasks").update(updates).eq("id", taskId).eq("user_id", userId);
    },
);
