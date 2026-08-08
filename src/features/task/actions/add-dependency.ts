"use server";

import { revalidatePath } from "next/cache";
import { getSessionUserId } from "@/features/auth/lib/get-session-user";
import type { ActionResult } from "@/features/task/lib/action-result";
import { mapDbErrorOrThrow } from "@/features/task/lib/map-db-error";
import { createAppClient } from "@/lib/supabase/app-client";

/**
 * 依存を追加する。add_task_dependency RPC を呼ぶ (req.md §53)
 *
 * cycle 検出ロジックは DB Trigger (check_task_dependency_cycle) に委譲する
 *
 * knip ignore 対象 (意図的未使用)。依存追加 UI (依存先ピッカー等) は本改修の対象外であり、
 * 現状 UI から呼ばれていない。DetailPane 側で依存削除 UI (removeDependency) 実装時に
 * 「再追加が容易」と説明する根拠となる Action であり、依存追加 UI 実装時にこの ignore を外す
 */
export const addDependency = async ({ taskId, dependsOnTaskId }: { taskId: string; dependsOnTaskId: string }): Promise<ActionResult> => {
    const userId = await getSessionUserId();
    const client = await createAppClient({ userId });

    const { error } = await client.rpc("add_task_dependency", {
        p_task_id: taskId,
        p_depends_on_task_id: dependsOnTaskId,
    });

    if (error !== null) {
        const mapped = mapDbErrorOrThrow(error);
        return { ok: false, ...mapped };
    }

    revalidatePath("/");
    return { ok: true, data: undefined };
};
