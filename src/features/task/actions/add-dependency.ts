"use server";

import { defineTaskAction } from "@/features/task/lib/define-task-action";

/**
 * 依存を追加する。add_task_dependency RPC を呼ぶ (req.md §53)
 *
 * cycle 検出ロジックは DB Trigger (check_task_dependency_cycle) に委譲する
 *
 * DetailPane の依存先追加 UI (依存先セレクト + 追加ボタン) から呼ばれる。
 * 依存編集は Op キューの対象外 (SPEC §7) のため、revalidatePath による鮮度担保を現行どおり残す (Issue #70)
 */
export const addDependency = defineTaskAction<{ taskId: string; dependsOnTaskId: string }>(
    async ({ client }, { taskId, dependsOnTaskId }) =>
        await client.rpc("add_task_dependency", {
            p_task_id: taskId,
            p_depends_on_task_id: dependsOnTaskId,
        }),
    ["/"],
);
