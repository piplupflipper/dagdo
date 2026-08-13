import { dependsOnTasksOf } from "@/features/task/lib/depends-on-tasks";
import type { AppTask, TaskDependency } from "@/types/task";

/**
 * `completeTask` が `TASK_BLOCKED` を返した際の原因タスクを、依存関係から自前で計算する
 *
 * Server Action は `ActionResult` に原因タスクを載せない (docs/frontend-design.md §8.3 の
 * `{ ok: false; code; message }` のみ) ため、手元の依存関係から解決する。
 * 未完了の依存先が複数あっても、`dependencies` の並び順で最初の 1 件だけを返す
 * (ステータス行に出すのも、点滅させるのも 1 件のため)
 */
export const findBlockingCause = (taskId: string, tasks: readonly AppTask[], dependencies: readonly TaskDependency[]): AppTask | null =>
    dependsOnTasksOf(tasks, dependencies, taskId, { onlyIncomplete: true })[0] ?? null;
