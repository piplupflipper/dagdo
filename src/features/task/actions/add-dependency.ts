"use server";

import { defineTaskAction } from "@/features/task/lib/define-task-action";

/**
 * 依存を追加する。add_task_dependency RPC を呼ぶ (req.md §53)
 *
 * cycle 検出ロジックは DB Trigger (check_task_dependency_cycle) に委譲する
 *
 * DetailPane の依存先追加 UI (依存先セレクト + 追加ボタン) から呼ばれる
 */
export const addDependency = defineTaskAction<{ taskId: string; dependsOnTaskId: string }>(
    ["/"],
    async ({ client }, { taskId, dependsOnTaskId }) =>
        await client.rpc("add_task_dependency", {
            p_task_id: taskId,
            p_depends_on_task_id: dependsOnTaskId,
        }),
);
