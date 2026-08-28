import type { OutlineOp } from "@/features/outline/lib/outline-ops";
import type { AppTask } from "@/types/task";

/**
 * 未送信 Op キューの 1 エントリ
 *
 * `tasksSnapshot` は enqueue 時点のタスク一覧。`reorder` を Server Action へ送るときの
 * `orderedTaskIds` 再構成は「操作前の一覧」基準のため、このスナップショットを閉じ込める
 */
export type OpQueueEntry = {
    op: OutlineOp;
    tasksSnapshot: AppTask[];
};

/**
 * 未送信 Op の FIFO 列
 *
 * 送信中のエントリは含めない。in-flight はフック層が別途保持し、本配列へは戻さない
 * (coalesce が送信中エントリを置き換えないための前提)
 */
export type OpQueue = readonly OpQueueEntry[];

export const EMPTY_OP_QUEUE: OpQueue = [];

const isCoalesceType = (op: OutlineOp): op is Extract<OutlineOp, { type: "updateTitle" | "updateDescription" | "updateDueDate" | "reorder" }> =>
    op.type === "updateTitle" || op.type === "updateDescription" || op.type === "updateDueDate" || op.type === "reorder";

/**
 * 末尾の未送信エントリと隣接しており、同一 taskId の同一 coalesce 対象種別なら置き換えてよい
 *
 * 「連続する」とは間に他の Op を挟まずキュー上で隣接していること。挟まっていたら coalesce しない
 */
const canCoalesce = (previous: OutlineOp, next: OutlineOp): boolean => isCoalesceType(previous) && isCoalesceType(next) && previous.type === next.type && previous.taskId === next.taskId;

/**
 * 未送信キューの末尾へエントリを追加する。coalesce 規則を適用する
 *
 * 判断に迷う coalesce はしない。対象は updateTitle / updateDescription / updateDueDate / reorder の 4 種のみ
 */
export const enqueueOp = (queue: OpQueue, entry: OpQueueEntry): OpQueue => {
    const last = queue[queue.length - 1];
    if (last === undefined || !canCoalesce(last.op, entry.op)) {
        return [...queue, entry];
    }
    // reorder の rank 再構成は「操作前の一覧」基準のため、置き換え後も先頭側の snapshot を残す
    const merged: OpQueueEntry = last.op.type === "reorder" ? { op: entry.op, tasksSnapshot: last.tasksSnapshot } : entry;
    return [...queue.slice(0, -1), merged];
};
