import type { AppTask, TaskDependency } from "@/types/task";

/**
 * `taskId` が依存する依存先タスクの実体を、`dependencies` に並んでいる順で取り出す
 *
 * `task_dependencies` は id の組しか持たないため (docs/frontend-design.md §8.1)、依存先の一覧表示にも
 * blocked の理由にも、手元の `tasks` から実体を引き直す必要がある。この引き直しを 1 箇所へ集約する。
 * `tasks` に見当たらない依存先 (ゴミ箱へ移動済み等) は落とす。
 *
 * `onlyIncomplete` は完了済みの依存先を落とすかどうかで、呼び出し元が目的に応じて選ぶ。
 * 完了を阻む原因や blocked の理由を求めるなら true、依存先そのものを一覧するなら false を渡す
 */
export const dependsOnTasksOf = (tasks: readonly AppTask[], dependencies: readonly TaskDependency[], taskId: string, { onlyIncomplete }: { onlyIncomplete: boolean }): AppTask[] =>
    dependencies
        .filter((dependency) => dependency.task_id === taskId)
        .map((dependency) => tasks.find((candidate) => candidate.id === dependency.depends_on_task_id))
        .filter((dependsOnTask): dependsOnTask is AppTask => dependsOnTask !== undefined && (!onlyIncomplete || dependsOnTask.completed_at === null));
