"use server";

import { revalidatePath } from "next/cache";
import { getSessionUserId } from "@/features/auth/lib/get-session-user";
import type { ActionResult } from "@/features/task/lib/action-result";
import { mapDbErrorOrThrow } from "@/features/task/lib/map-db-error";
import { createAppClient } from "@/lib/supabase/app-client";

/**
 * タスクを作成する (req.md §59, §60)
 *
 * user_id はクライアント入力から受け取らず、auth() で検証済みのセッションから取得する
 * (req.md §60)。position は同一 actual parent の兄弟グループの末尾に採番する
 */
export const createTask = async ({ title, parentId }: { title: string; parentId: string | null }): Promise<ActionResult<{ id: string }>> => {
    const userId = await getSessionUserId();
    const client = await createAppClient({ userId });

    const siblingCountQuery = client.from("tasks").select("*", { count: "exact", head: true }).eq("user_id", userId);
    const { count, error: countError } = parentId === null ? await siblingCountQuery.is("parent_id", null) : await siblingCountQuery.eq("parent_id", parentId);

    if (countError !== null) {
        const mapped = mapDbErrorOrThrow(countError);
        return { ok: false, ...mapped };
    }

    const { data, error } = await client
        .from("tasks")
        .insert({ title, parent_id: parentId, user_id: userId, position: count ?? 0 })
        .select("id")
        .single();

    if (error !== null) {
        const mapped = mapDbErrorOrThrow(error);
        return { ok: false, ...mapped };
    }

    revalidatePath("/");
    return { ok: true, data: { id: data.id } };
};
