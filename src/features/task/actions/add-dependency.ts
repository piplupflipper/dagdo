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
 * DetailPane の依存先追加 UI (依存先セレクト + 追加ボタン) から呼ばれる
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
