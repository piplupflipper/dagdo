import type { OutlineOp } from "@/features/outline/lib/outline-ops";
import type { TaskErrorCode } from "@/features/task/lib/action-result";
import type { AppTask, TaskDependency } from "@/types/task";

export type ValidateOutlineOpResult = { ok: true } | { ok: false; code: TaskErrorCode };

/**
 * 未完了かつ手元に存在する依存先が 1 件以上あれば blocked
 *
 * app_tasks View / check_task_blocked_completion Trigger と同じ意味論。
 * 依存先が tasks に無い (= 論理削除済みで配列から除去済み) 場合は blocked に数えない
 */
const isBlockedByDependencies = (task: AppTask, byId: ReadonlyMap<string, AppTask>, dependencies: readonly TaskDependency[]): boolean => {
    if (task.completed_at !== null) {
        return false;
    }
    return dependencies.some((dependency) => {
        if (dependency.task_id !== task.id) {
            return false;
        }
        const dependsOn = byId.get(dependency.depends_on_task_id);
        return dependsOn !== undefined && dependsOn.completed_at === null;
    });
};

/**
 * newParentId から祖先を辿って taskId に到達すれば親子 cycle
 *
 * check_task_parent_cycle Trigger と同じ向き (新しい親の祖先列に自身が現れる)。
 * 手元に無い親はここでは cycle とせず、INVALID_PARENT 側で扱う
 */
const wouldCreateParentCycle = (taskId: string, newParentId: string, byId: ReadonlyMap<string, AppTask>): boolean => {
    if (newParentId === taskId) {
        return true;
    }
    let current = byId.get(newParentId);
    let guard = 0;
    while (current !== undefined && guard <= byId.size) {
        if (current.id === taskId) {
            return true;
        }
        if (current.parent_id === null) {
            return false;
        }
        current = byId.get(current.parent_id);
        guard += 1;
    }
    return false;
};

const siblingCount = (tasks: readonly AppTask[], parentId: string | null): number => tasks.filter((task) => task.parent_id === parentId).length;

/**
 * 可視の兄弟グループに対する挿入位置として範囲外なら true
 *
 * 下限は RPC と同じ非負。上限は手元の可視件数 (末尾挿入 = count は許容、それより先は隙間になる)。
 * create Op の position は常に手元の一覧から採番されるためこの上限で足りる (move の実 position とは異なる)。
 * null は末尾指定であり範囲検査の対象外
 */
const isPositionOutOfRange = (position: number | null, maxInclusive: number): boolean => position !== null && (position < 0 || position > maxInclusive);

const validateCreate = (op: Extract<OutlineOp, { type: "create" }>, tasks: readonly AppTask[]): ValidateOutlineOpResult => {
    if (isPositionOutOfRange(op.position, siblingCount(tasks, op.parentId))) {
        return { ok: false, code: "INVALID_POSITION" };
    }
    return { ok: true };
};

const validateComplete = (op: Extract<OutlineOp, { type: "complete" }>, tasks: readonly AppTask[], dependencies: readonly TaskDependency[]): ValidateOutlineOpResult => {
    const target = tasks.find((task) => task.id === op.taskId);
    if (target === undefined) {
        return { ok: true };
    }
    const byId = new Map(tasks.map((task) => [task.id, task]));
    if (isBlockedByDependencies(target, byId, dependencies) || target.is_blocked) {
        return { ok: false, code: "TASK_BLOCKED" };
    }
    return { ok: true };
};

const validateMove = (op: Extract<OutlineOp, { type: "move" }>, tasks: readonly AppTask[]): ValidateOutlineOpResult => {
    const byId = new Map(tasks.map((task) => [task.id, task]));
    if (op.newParentId !== null) {
        if (wouldCreateParentCycle(op.taskId, op.newParentId, byId)) {
            return { ok: false, code: "TASK_PARENT_CYCLE" };
        }
        if (!byId.has(op.newParentId)) {
            return { ok: false, code: "INVALID_PARENT" };
        }
    }
    // move の newPosition は論理削除済み兄弟を含む実 position (docs/db-design.md 第12.2節)。手元の tasks は
    // 削除済みを含まないため、可視件数を上限にすると削除済み兄弟がいる行の dd → undo (restore + 元 position への
    // move) が INVALID_POSITION で弾かれてしまう。RPC (move_task) と同じ負数チェックのみとする
    if (op.newPosition !== null && op.newPosition < 0) {
        return { ok: false, code: "INVALID_POSITION" };
    }
    return { ok: true };
};

const validateReorder = (op: Extract<OutlineOp, { type: "reorder" }>, tasks: readonly AppTask[]): ValidateOutlineOpResult => {
    const target = tasks.find((task) => task.id === op.taskId);
    if (target === undefined) {
        return { ok: true };
    }
    const count = siblingCount(tasks, target.parent_id);
    if (op.newPosition < 0 || op.newPosition >= count) {
        return { ok: false, code: "INVALID_POSITION" };
    }
    return { ok: true };
};

/**
 * enqueue / apply の前に呼ぶクライアント側の事前バリデーション
 *
 * 扱うのは TASK_BLOCKED / TASK_PARENT_CYCLE / INVALID_PARENT / INVALID_POSITION の 4 種。
 * TASK_NOT_FOUND は別タブ起因で事前判定不能。依存編集の TASK_DEPENDENCY_CYCLE / DEPENDENCY_ALREADY_EXISTS はキュー対象外
 */
export const validateOutlineOp = (op: OutlineOp, tasks: readonly AppTask[], dependencies: readonly TaskDependency[]): ValidateOutlineOpResult => {
    switch (op.type) {
        case "create":
            return validateCreate(op, tasks);
        case "complete":
            return validateComplete(op, tasks, dependencies);
        case "move":
            return validateMove(op, tasks);
        case "reorder":
            return validateReorder(op, tasks);
        case "reopen":
        case "updateTitle":
        case "updateDescription":
        case "updateDueDate":
        case "softDelete":
        case "restore":
            return { ok: true };
    }
};
