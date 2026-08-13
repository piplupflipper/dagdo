import type { OutlineOp } from "@/features/outline/lib/outline-ops";
import { siblingRankOf } from "@/features/outline/lib/sibling-rank";
import type { AppTask } from "@/types/task";

/**
 * 1 つの Op と、それを適用する直前のタスク一覧から、undo (`u`) で実行する逆操作の Op 列を組み立てる
 * (docs/frontend-design.md §5.2、undo-history.ts の `UndoEntry.undoOps`)
 *
 * 逆操作の材料 (変更前のタイトル、移動前の parent_id/position、削除される行そのもの) は
 * Op を適用した後の状態からは取り出せない。そのため `tasksSnapshot` には、
 * 楽観適用 (`applyOptimisticAction`) より前の `optimisticTasks` を渡す。
 * 逆に redo 側の Op 列は元の Op そのもの (`[op]`) であり、材料を要らないためここでは扱わない。
 *
 * `OutlineShell` の state に触れない純粋な組み立てだけをここへ置き、
 * 「いつ積むか」(Server Action の成功時のみ) の判断は呼び出し側 (outline-shell.tsx の `runOp`) に残す
 */
export const invertOutlineOp = (op: OutlineOp, tasksSnapshot: readonly AppTask[]): OutlineOp[] | null => {
    const previous = "taskId" in op ? (tasksSnapshot.find((task) => task.id === op.taskId) ?? null) : null;

    switch (op.type) {
        case "complete":
            return [{ type: "reopen", taskId: op.taskId }];

        case "reopen":
            return [{ type: "complete", taskId: op.taskId }];

        case "updateTitle":
            return previous === null ? null : [{ type: "updateTitle", taskId: op.taskId, title: previous.title }];

        case "updateDescription":
            return previous === null ? null : [{ type: "updateDescription", taskId: op.taskId, description: previous.description }];

        case "updateDueDate":
            return previous === null ? null : [{ type: "updateDueDate", taskId: op.taskId, dueDate: previous.due_date }];

        case "move":
            // インデント / アウトデント / dnd の親変更の逆操作。移動前の実 position (rank ではない) へ戻す
            return previous === null ? null : [{ type: "move", taskId: op.taskId, newParentId: previous.parent_id, newPosition: previous.position }];

        case "reorder":
            // `reorder` の `newPosition` は同一 actual parent 内の rank であり、逆操作も移動前の rank で表す。
            // 対象が `tasksSnapshot` に無い場合、`siblingRankOf` は rank を決められず -1 を返す
            // (`resolveReorderedSiblingIds` 側で 0 へ丸められる。統合前の呼び出し元と同じ扱い)
            return [{ type: "reorder", taskId: op.taskId, newPosition: siblingRankOf(tasksSnapshot, op.taskId) }];

        case "softDelete":
            // `restore_task` RPC (migration 0005、詰め処理の追加は 20260813000001) は
            // actual sibling group の末尾へ position を移すため (req.md §26)、
            // 元の位置に戻すには `restore` に続けて削除前の parent_id/position への `move` が要る
            // (outline-shell.tsx の `softDeleteCursor` のコメント参照)
            return previous === null
                ? null
                : [
                      { type: "restore", taskId: op.taskId, snapshot: previous },
                      { type: "move", taskId: op.taskId, newParentId: previous.parent_id, newPosition: previous.position },
                  ];

        case "create":
            // `create` の逆操作は tempId ではなく Server Action の応答で判明する実 id を要るため、
            // ここでは組み立てられない (`createSibling` が settle 後に自前で積む)
            return null;

        case "restore":
            // `restore` は undo/redo の再実行としてのみ現れ、それ自体が履歴へ積まれることはない
            return null;
    }
};
