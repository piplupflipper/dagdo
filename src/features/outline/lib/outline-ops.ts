import type { SiblingReorderResult } from "@/features/outline/lib/flatten-for-dnd";
import type { AppTask, TaskDependency } from "@/types/task";

/**
 * アウトライナーの全構造操作を表す単一の Op 型 (docs/frontend-design.md §5.2)
 *
 * 「表示状態 = reduce(サーバー由来 tasks, pendingOps)」の単一リデューサ方式における pendingOps の要素であり、
 * `useOptimistic` のアクションとしてそのまま使う。1 Op = 1 回のユーザー操作 (キー入力 / dnd ドロップ) に対応する。
 *
 * `move` の `newPosition` は `move_task` RPC の `p_new_position` と同じ意味 (新しい actual parent 内の
 * 実 DB position、対象を除いた兄弟の隙間詰め・隙間空けの基準になる、migration 0005)。
 * `reorder` の `newPosition` はこれとは異なり、同一 actual parent 内での新しい並び順 (0-based の rank) を表す。
 * `reorder_tasks` RPC (migration 0007) は「兄弟が現在占めている position の集合 (slot) はそのままに、
 * `orderedTaskIds` の順序だけを当てはめる」ため、rank を渡せば `applyOutlineOp` 側で slot を再構成できる。
 * 呼び出し元 (outline-shell.tsx) は `computeSiblingSwap` / `computeDropResult` が返す `orderedTaskIds` から
 * 対象タスクの rank (`orderedTaskIds.indexOf(taskId)`) を取り、それをここへ渡す
 */
export type OutlineOp =
    | { type: "create"; tempId: string; title: string; parentId: string | null; position: number | null }
    | { type: "complete"; taskId: string }
    | { type: "reopen"; taskId: string }
    | { type: "updateTitle"; taskId: string; title: string }
    /**
     * DetailPane の説明編集 (Ctrl+Enter / Cmd+Enter / Esc / 「保存」ボタンで確定、docs/frontend-design.md §6.5)
     *
     * 単純なフィールドパッチであり、normalize が読む parent_id / position / completed_at のいずれにも
     * 影響しないため、他の構造操作と異なり sort_path / effective_parent_id / is_blocked の再計算結果は変わらない
     * (normalize は呼ぶが実質的に恒等変換)
     */
    | { type: "updateDescription"; taskId: string; description: string }
    /** DetailPane の期日編集 (「保存」ボタンで確定)。updateDescription と同じ単純なフィールドパッチ */
    | { type: "updateDueDate"; taskId: string; dueDate: string | null }
    | { type: "move"; taskId: string; newParentId: string | null; newPosition: number }
    | { type: "reorder"; taskId: string; newPosition: number }
    | { type: "softDelete"; taskId: string }
    | {
          type: "restore";
          taskId: string;
          /**
           * softDelete で配列から除去された行のスナップショット (taskId だけでは足りない理由は下記)
           *
           * `softDelete` は app_tasks から行そのものを除去する (下記 `applyOutlineOp` 参照)。
           * そのため `restore` を taskId だけで表現すると、title / parent_id / position などを
           * 再構成する材料が無くなってしまう。undo (softDelete の逆操作としての restore) を
           * 楽観的に即時表示するには、削除される直前の行を丸ごと閉じ込めて渡す必要がある。
           * これが undo 実装 (undo-history.ts) で採用した設計であり、
           * 削除直前の optimisticTasks から該当行を取得して `snapshot` に詰める
           */
          snapshot: AppTask;
      };

type ApplyOutlineOpOptions = {
    /**
     * tasks が 0 件のときに `create` の `user_id` を決める代替値
     *
     * 通常は既存行の `user_id` を引き継ぐ (同一ユーザーのタスクしか手元に無いため)。
     * アウトラインが空の状態で最初の 1 件を作る場合に備え、呼び出し側 (OutlineShell) の
     * セッション userId をフォールバックとして渡せるようにしている
     */
    fallbackUserId?: string;
};

const siblingsSortedByPosition = (tasks: readonly AppTask[], parentId: string | null): AppTask[] => [...tasks].filter((task) => task.parent_id === parentId).sort((a, b) => a.position - b.position);

/**
 * `reorder` Op (taskId + 兄弟内の新しい rank) から、`reorderTasks` Server Action へ渡す
 * `{ parentId, orderedTaskIds }` を再構成する純粋関数
 *
 * `applyOutlineOp` の楽観適用と、Server Action 呼び出し (outline-shell.tsx) の両方から呼び、
 * 「対象 1 件を抜いて新しい rank へ挿し直す」という同じ並べ替え規則を共有する。
 * `computeSiblingSwap` (`J`/`K`) と `computeDropResult` の reorder 分岐 (dnd-kit の `arrayMove`) は
 * いずれも「対象 1 件の移動」しか生成しないため、この前提で表現できる
 */
export const resolveReorderedSiblingIds = (tasks: readonly AppTask[], op: { taskId: string; newPosition: number }): SiblingReorderResult | null => {
    const target = tasks.find((task) => task.id === op.taskId);
    if (target === undefined) {
        return null;
    }
    const order = siblingsSortedByPosition(tasks, target.parent_id).map((task) => task.id);
    const currentRank = order.indexOf(op.taskId);
    if (currentRank < 0) {
        return null;
    }
    order.splice(currentRank, 1);
    const insertRank = Math.min(Math.max(op.newPosition, 0), order.length);
    order.splice(insertRank, 0, op.taskId);
    return { parentId: target.parent_id, orderedTaskIds: order };
};

/** create の挿入で後続兄弟の position を +1 ずらす (createTask + move_task 相当、migration 0005) */
const applyCreate = (tasks: readonly AppTask[], op: Extract<OutlineOp, { type: "create" }>, options: ApplyOutlineOpOptions): AppTask[] => {
    const siblingCount = tasks.filter((task) => task.parent_id === op.parentId).length;
    // position 省略時は兄弟グループ末尾へ (createTask の position === null 相当)。
    // createTask (Server Action) は論理削除済みも含めた実 count を使うが、ローカルの tasks には
    // 論理削除済み行が存在しない (softDelete で配列から除去済み) ため、削除済み兄弟がいる場合は
    // 末尾の position がサーバーの採番より小さくなりうる (妥協点。報告参照)
    const insertPosition = op.position ?? siblingCount;
    const shifted = tasks.map((task) => (task.parent_id === op.parentId && task.position >= insertPosition ? { ...task, position: task.position + 1 } : task));
    const now = new Date().toISOString();
    const userId = tasks[0]?.user_id ?? options.fallbackUserId ?? "";
    const newTask: AppTask = {
        id: op.tempId,
        user_id: userId,
        title: op.title,
        description: "",
        parent_id: op.parentId,
        // normalize が全行再計算するため暫定値でよい
        effective_parent_id: op.parentId,
        position: insertPosition,
        sort_path: [],
        due_date: null,
        completed_at: null,
        is_blocked: false,
        created_at: now,
        updated_at: now,
    };
    return [...shifted, newTask];
};

/** move_task RPC 相当: 旧兄弟グループの隙間を詰め、新兄弟グループに隙間を空けたうえで対象を移す (migration 0005) */
const applyMove = (tasks: readonly AppTask[], op: Extract<OutlineOp, { type: "move" }>): AppTask[] => {
    const target = tasks.find((task) => task.id === op.taskId);
    if (target === undefined) {
        return [...tasks];
    }
    const oldParentId = target.parent_id;
    const oldPosition = target.position;
    return tasks.map((task) => {
        if (task.id === op.taskId) {
            return { ...task, parent_id: op.newParentId, position: op.newPosition };
        }
        let position = task.position;
        if (task.parent_id === oldParentId && position > oldPosition) {
            position -= 1;
        }
        if (task.parent_id === op.newParentId && position >= op.newPosition) {
            position += 1;
        }
        return position === task.position ? task : { ...task, position };
    });
};

/** reorder_tasks RPC 相当: 兄弟が占めている position (slot) の集合はそのままに、順序だけ入れ替える (migration 0007) */
const applyReorder = (tasks: readonly AppTask[], op: Extract<OutlineOp, { type: "reorder" }>): AppTask[] => {
    const spec = resolveReorderedSiblingIds(tasks, op);
    if (spec === null) {
        return [...tasks];
    }
    const slots = siblingsSortedByPosition(tasks, spec.parentId).map((task) => task.position);
    const positionByTaskId = new Map(spec.orderedTaskIds.map((taskId, index) => [taskId, slots[index]]));
    return tasks.map((task) => {
        const position = positionByTaskId.get(task.id);
        return position === undefined || position === task.position ? task : { ...task, position };
    });
};

/**
 * 実 parent (`byId` 上に存在する) を再帰的に辿って sort_path を解決する
 *
 * 実 parent が tasks 上に存在しない (softDelete で配列から除去済み) 場合は、直前まで正しかった
 * 自身の sort_path の祖先部分をそのまま引き継ぎ、自分の position だけを最新の値に差し替える。
 * app_tasks View の再帰 CTE (task_path) は削除済み祖先も遡って position を辿れるが (migration 0003 の
 * コメント「削除済みの中間ノードも path に含める」)、ローカル state には削除済み行そのものが残らないため
 * 祖先の position を再取得できない。削除だけで他行の position は変わらない (soft-delete-task.ts) ため、
 * 引き継いだ祖先部分は softDelete 適用後も変わらず正しく、この代替で View と同じ表示順を再現できる
 */
const resolveSortPaths = (tasks: readonly AppTask[], byId: ReadonlyMap<string, AppTask>): Map<string, number[]> => {
    const cache = new Map<string, number[]>();

    const resolve = (task: AppTask, guard: number): number[] => {
        const cached = cache.get(task.id);
        if (cached !== undefined) {
            return cached;
        }
        // 循環参照は DB 側の Trigger (TASK_PARENT_CYCLE) で発生しない想定だが、防御的に打ち切る (build-tree.ts と同じ考え方)
        if (guard > tasks.length) {
            return [task.position];
        }
        let path: number[];
        if (task.parent_id === null) {
            path = [task.position];
        } else {
            const parent = byId.get(task.parent_id);
            path = parent === undefined ? [...task.sort_path.slice(0, -1), task.position] : [...resolve(parent, guard + 1), task.position];
        }
        cache.set(task.id, path);
        return path;
    };

    return new Map(tasks.map((task) => [task.id, resolve(task, 0)]));
};

/** is_blocked: 未完了かつ未削除の依存先が 1 件以上存在するタスク (app_tasks View、migration 0003) */
const resolveIsBlocked = (task: AppTask, byId: ReadonlyMap<string, AppTask>, dependencies: readonly TaskDependency[]): boolean => {
    if (task.completed_at !== null) {
        return false;
    }
    return dependencies.some((dependency) => {
        if (dependency.task_id !== task.id) {
            return false;
        }
        // 依存先が byId に無い (= 論理削除済み、ローカルでは配列から除去されている) 場合は
        // View の `dep.deleted_at is null` フィルタと同じ扱いで「blocked に数えない」
        const dependsOn = byId.get(dependency.depends_on_task_id);
        return dependsOn !== undefined && dependsOn.completed_at === null;
    });
};

/**
 * 適用後の (parent_id / position / completed_at / 削除) から、app_tasks View と同じ意味論で
 * sort_path / effective_parent_id / is_blocked を全行再計算する (supabase/migrations/20260808000003_app_tasks_view.sql)
 *
 * effective_parent_id: 実 parent が tasks 上に存在するなら、その実 parent が最も近い未削除祖先である
 * (実 parent が生きている以上、そこより近い未削除祖先は無い)。実 parent が存在しない場合だけ、
 * 直前まで正しかった値をそのまま引き継ぐ (`applyOutlineOp` の `softDelete` 分岐が、行が消える
 * 「その瞬間」の書き換えを別途行うことで、この引き継ぎだけで多段の連鎖も帰納的に正しく保たれる)
 */
const normalize = (tasks: readonly AppTask[], dependencies: readonly TaskDependency[]): AppTask[] => {
    const byId = new Map(tasks.map((task) => [task.id, task]));
    const sortPaths = resolveSortPaths(tasks, byId);

    return tasks.map((task) => ({
        ...task,
        effective_parent_id: task.parent_id === null ? null : byId.has(task.parent_id) ? task.parent_id : task.effective_parent_id,
        sort_path: sortPaths.get(task.id) ?? [task.position],
        is_blocked: resolveIsBlocked(task, byId, dependencies),
    }));
};

/**
 * 1 Op を tasks へ適用し、normalize まで行った配列を返す純関数 (docs/frontend-design.md §5.2)
 *
 * `useOptimistic(initialTasks, (state, op) => applyOutlineOp(state, dependencies, op))` の reducer 本体として使う
 */
export const applyOutlineOp = (tasks: readonly AppTask[], dependencies: readonly TaskDependency[], op: OutlineOp, options: ApplyOutlineOpOptions = {}): AppTask[] => {
    switch (op.type) {
        case "create":
            return normalize(applyCreate(tasks, op, options), dependencies);

        case "complete":
            return normalize(
                tasks.map((task) => (task.id === op.taskId ? { ...task, completed_at: new Date().toISOString() } : task)),
                dependencies,
            );

        case "reopen":
            return normalize(
                tasks.map((task) => (task.id === op.taskId ? { ...task, completed_at: null } : task)),
                dependencies,
            );

        case "updateTitle":
            return normalize(
                tasks.map((task) => (task.id === op.taskId ? { ...task, title: op.title } : task)),
                dependencies,
            );

        case "updateDescription":
            return normalize(
                tasks.map((task) => (task.id === op.taskId ? { ...task, description: op.description } : task)),
                dependencies,
            );

        case "updateDueDate":
            return normalize(
                tasks.map((task) => (task.id === op.taskId ? { ...task, due_date: op.dueDate } : task)),
                dependencies,
            );

        case "move":
            return normalize(applyMove(tasks, op), dependencies);

        case "reorder":
            return normalize(applyReorder(tasks, op), dependencies);

        case "softDelete": {
            const deleted = tasks.find((task) => task.id === op.taskId);
            const survivors = tasks.filter((task) => task.id !== op.taskId);
            if (deleted === undefined) {
                return normalize(survivors, dependencies);
            }
            // 消えた行を effective parent としていた行 (透明化されていた子・孫を含む) を、
            // 消えた行自身が透明化していた先 (deleted.effective_parent_id) へ引き上げる。
            // normalize の「実 parent が存在しなければ直前の値を引き継ぐ」ルールだけでは、
            // 生きていた行が消える「その瞬間」を表せない (直前の値がまだ消えた行を指したまま残る) ため、
            // ここで明示的に書き換える
            const patched = survivors.map((task) => (task.effective_parent_id === deleted.id ? { ...task, effective_parent_id: deleted.effective_parent_id } : task));
            return normalize(patched, dependencies);
        }

        case "restore": {
            if (tasks.some((task) => task.id === op.taskId)) {
                // 二重 restore の防御。実際には tempId ガード (outline-shell.tsx) や
                // Server Action の失敗時ロールバックにより到達しない想定
                return normalize(tasks, dependencies);
            }
            // 実 parent (snapshot.parent_id) が生きていれば、normalize の一次ルールが
            // effective_parent_id を自動的に snapshot.parent_id へ揃える。
            // snapshot.parent_id を実 parent としていた他の行 (削除中は effective_parent_id が
            // 飛び越えて別の祖先を指していた行) も、同じ normalize 呼び出しで自動的に復元される
            return normalize([...tasks, op.snapshot], dependencies);
        }
    }
};
