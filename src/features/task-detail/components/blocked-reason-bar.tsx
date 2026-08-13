import type { JSX } from "react";
import { dependsOnTasksOf } from "@/features/task/lib/depends-on-tasks";
import type { AppTask, TaskDependency } from "@/types/task";

/** BlockedReasonBar の props */
type BlockedReasonBarProps = {
    task: AppTask;
    allTasks: readonly AppTask[];
    dependencies: readonly TaskDependency[];
};

/**
 * blocked 理由バー (docs/frontend-design.md §7.1)
 *
 * dependencies + allTasks から「未完了の依存先タイトル」を導出して表示する
 * この計算は表示文言のための提示ロジックであり、is_blocked 自体の正とはしない (docs/frontend-design.md §5.3)
 */
export const BlockedReasonBar = ({ task, allTasks, dependencies }: BlockedReasonBarProps): JSX.Element | null => {
    const unmetTitles = dependsOnTasksOf(allTasks, dependencies, task.id, { onlyIncomplete: true }).map((blocker) => blocker.title);

    if (unmetTitles.length === 0) {
        return null;
    }

    return (
        <div className="mb-2.5 flex items-center gap-1.5 rounded-md border border-blocked bg-blocked/10 px-2.5 py-1.5 text-xs text-blocked">
            <span aria-hidden="true">🔒</span>
            <span>{unmetTitles.join("、")} の完了待ち</span>
        </div>
    );
};
