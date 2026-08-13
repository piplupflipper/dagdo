import { type OutlineOp, resolveReorderedSiblingIds } from "@/features/outline/lib/outline-ops";
import { completeTask } from "@/features/task/actions/complete-task";
import { createTask } from "@/features/task/actions/create-task";
import { moveTask } from "@/features/task/actions/move-task";
import { reopenTask } from "@/features/task/actions/reopen-task";
import { reorderTasks } from "@/features/task/actions/reorder-tasks";
import { restoreTask } from "@/features/task/actions/restore-task";
import { softDeleteTask } from "@/features/task/actions/soft-delete-task";
import { updateTask } from "@/features/task/actions/update-task";
import type { ActionResult } from "@/features/task/lib/action-result";
import type { AppTask } from "@/types/task";

/**
 * Op を対応する Server Action へ振り分ける (undo/redo の再実行、docs/frontend-design.md §5.2)
 *
 * 通常のハンドラ (runComplete 等) は Op の種類ごとに専用の逆操作の組み立てとセットで書くが、
 * undo/redo は「確定済みの任意の Op 列」を汎用に再実行する必要があるため、ここに 1 箇所へ集約する。
 * `reorder` だけ、Server Action (`reorderTasks`) が要求する `{ parentId, orderedTaskIds }` を
 * `newPosition` (rank) から再構成するために `tasksSnapshot` (dispatch 時点の optimisticTasks) を要る
 */
export const callServerForOp = (op: OutlineOp, tasksSnapshot: readonly AppTask[]): Promise<ActionResult<unknown>> => {
    switch (op.type) {
        case "create":
            return createTask({ title: op.title, parentId: op.parentId, position: op.position });
        case "complete":
            return completeTask({ taskId: op.taskId });
        case "reopen":
            return reopenTask({ taskId: op.taskId });
        case "updateTitle":
            return updateTask({ taskId: op.taskId, title: op.title });
        case "updateDescription":
            return updateTask({ taskId: op.taskId, description: op.description });
        case "updateDueDate":
            return updateTask({ taskId: op.taskId, dueDate: op.dueDate });
        case "move":
            return moveTask({ taskId: op.taskId, newParentId: op.newParentId, newPosition: op.newPosition });
        case "reorder": {
            const spec = resolveReorderedSiblingIds(tasksSnapshot, op);
            return spec === null ? Promise.resolve<ActionResult>({ ok: true, data: undefined }) : reorderTasks(spec);
        }
        case "softDelete":
            return softDeleteTask({ taskId: op.taskId });
        case "restore":
            return restoreTask({ taskId: op.taskId });
    }
};
