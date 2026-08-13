import type { AppTask, TaskDependency } from "@/types/task";

/**
 * `completeTask` が `TASK_BLOCKED` を返した際の原因タスクを、依存関係から自前で計算する
 *
 * Server Action は `ActionResult` に原因タスクを載せない (docs/frontend-design.md §8.3 の
 * `{ ok: false; code; message }` のみ) ため、手元の依存関係から解決する。
 * 未完了の依存先が複数あっても、`dependencies` を走査して最初に見つかった 1 件だけを返す
 * (ステータス行に出すのも、点滅させるのも 1 件のため)
 */
export const findBlockingCause = (taskId: string, tasksById: ReadonlyMap<string, AppTask>, dependencies: readonly TaskDependency[]): AppTask | null => {
    for (const dependency of dependencies) {
        if (dependency.task_id !== taskId) {
            continue;
        }
        const blocker = tasksById.get(dependency.depends_on_task_id);
        if (blocker !== undefined && blocker.completed_at === null) {
            return blocker;
        }
    }
    return null;
};
