import type { OutlineTreeRow } from "@/features/outline/lib/build-tree";
import type { AppTask } from "@/types/task";

/** dnd-kit の useSortable に渡すフラット項目 (docs/frontend-design.md §9) */
export type FlattenedDndItem = {
    id: string;
    /** actual parent (task.parent_id) を辿った階層数。表示用の depth (effective_parent_id 由来) とは区別する */
    depth: number;
    /** actual parent。ドロップ確定時に reorderTasks / moveTask のどちらを呼ぶか判定する基準 */
    parentId: string | null;
    position: number;
};

/** 同一 parent 内の並べ替え結果。reorderTasks({ parentId, orderedTaskIds }) にそのまま渡せる */
export type SiblingReorderResult = {
    parentId: string | null;
    orderedTaskIds: string[];
};

/** 親変更 (reparent) の結果。moveTask({ taskId, newParentId, newPosition }) の後半にそのまま渡せる */
export type ReparentResult = {
    newParentId: string | null;
    newPosition: number;
};

/** カーソル行を基準にした新規タスクの作成位置 (`o` は below、`O` は above, docs/frontend-design.md §6.1) */
export type SiblingPlacement = "above" | "below";

const actualDepthOf = (taskId: string, byId: ReadonlyMap<string, AppTask>, guard: number): number => {
    // 削除済み祖先を挟むと actual parent_id チェーンが byId 上で途切れることがある。
    // その場合はそこで打ち切り、途切れた地点を暫定的な深さ 0 として扱う (V1 の割り切り)
    if (guard > byId.size) {
        return 0;
    }
    const task = byId.get(taskId);
    const parentId = task?.parent_id ?? null;
    if (parentId === null || !byId.has(parentId)) {
        return 0;
    }
    return actualDepthOf(parentId, byId, guard + 1) + 1;
};

/**
 * build-tree.ts が保持する actual parent 情報から、dnd-kit 用の depth (actual 階層数) を付与する (docs/frontend-design.md §9)
 *
 * 表示用の depth (effective_parent_id 由来、build-tree.ts の OutlineTreeRow.depth) とは区別する
 */
export const flattenForDnd = (rows: readonly OutlineTreeRow[]): FlattenedDndItem[] => {
    const byId = new Map(rows.map((row) => [row.task.id, row.task]));
    return rows.map((row) => ({
        id: row.task.id,
        depth: actualDepthOf(row.task.id, byId, 0),
        parentId: row.task.parent_id,
        position: row.task.position,
    }));
};

const siblingsOf = (tasks: readonly AppTask[], parentId: string | null): AppTask[] => tasks.filter((task) => task.parent_id === parentId).sort((a, b) => a.position - b.position);

/**
 * 同一 actual parent 内でタスクを 1 つ上/下へ移動した後の並びを計算する純粋関数 (`J`/`K`, docs/frontend-design.md §6.1, §9)
 *
 * dnd-kit のドロップ確定処理とキーボード代替 (`J`/`K`) の両方から呼び、新しい parent・position を決める部分を共有する
 */
export const computeSiblingSwap = ({ tasks, taskId, direction }: { tasks: readonly AppTask[]; taskId: string; direction: "up" | "down" }): SiblingReorderResult | null => {
    const target = tasks.find((task) => task.id === taskId);
    if (target === undefined) {
        return null;
    }
    const siblings = siblingsOf(tasks, target.parent_id);
    const index = siblings.findIndex((task) => task.id === taskId);
    const swapWith = direction === "down" ? index + 1 : index - 1;
    if (index < 0 || swapWith < 0 || swapWith >= siblings.length) {
        return null;
    }
    const orderedTaskIds = siblings.map((task) => task.id);
    const swapValue = orderedTaskIds[swapWith];
    const currentValue = orderedTaskIds[index];
    if (swapValue === undefined || currentValue === undefined) {
        return null;
    }
    orderedTaskIds[swapWith] = currentValue;
    orderedTaskIds[index] = swapValue;
    return { parentId: target.parent_id, orderedTaskIds };
};

/**
 * 同じ actual parent を持つ兄弟のうち、1 つ前 (`{`) / 後 (`}`) のタスク ID を返す純粋関数 (docs/frontend-design.md §6.1)
 *
 * 見るのが兄弟グループだけなので、間に挟まる子孫は自然にスキップされる。
 * 並び順は兄弟グループ内の position に従う (表示順と一致する)。
 * `visibleTaskIds` は depth も parent_id も持たず兄弟を判定できないため、ストアのアクションではなく
 * ここで解決して `setCursor` へ渡す (docs/frontend-design.md §5.2)
 *
 * @returns 端の兄弟にいる場合・対象が見つからない場合は null (呼び出し側はカーソルを動かさない)
 */
export const findSiblingTaskId = ({ tasks, taskId, direction }: { tasks: readonly AppTask[]; taskId: string; direction: "up" | "down" }): string | null => {
    const target = tasks.find((task) => task.id === taskId);
    if (target === undefined) {
        return null;
    }
    const siblings = siblingsOf(tasks, target.parent_id);
    const index = siblings.findIndex((task) => task.id === taskId);
    if (index < 0) {
        return null;
    }
    return siblings[direction === "down" ? index + 1 : index - 1]?.id ?? null;
};

/**
 * タスクを直前の兄弟の子として繰り込む (indent, `>`, docs/frontend-design.md §6.1, §9)
 *
 * 新しい親 (直前の兄弟) の子の末尾に追加する
 */
export const computeIndent = ({ tasks, taskId }: { tasks: readonly AppTask[]; taskId: string }): ReparentResult | null => {
    const target = tasks.find((task) => task.id === taskId);
    if (target === undefined) {
        return null;
    }
    const siblings = siblingsOf(tasks, target.parent_id);
    const index = siblings.findIndex((task) => task.id === taskId);
    const previousSibling = index > 0 ? siblings[index - 1] : undefined;
    if (previousSibling === undefined) {
        return null;
    }
    const newSiblingCount = tasks.filter((task) => task.parent_id === previousSibling.id).length;
    return { newParentId: previousSibling.id, newPosition: newSiblingCount };
};

/**
 * タスクの親を 1 階層上げる (outdent, `<`, docs/frontend-design.md §6.1, §9)
 *
 * 現在の親の直後 (現在の親と同じ階層) へ挿入する
 */
export const computeOutdent = ({ tasks, taskId }: { tasks: readonly AppTask[]; taskId: string }): ReparentResult | null => {
    const target = tasks.find((task) => task.id === taskId);
    if (target === undefined || target.parent_id === null) {
        return null;
    }
    const parent = tasks.find((task) => task.id === target.parent_id);
    if (parent === undefined) {
        return null;
    }
    return { newParentId: parent.parent_id, newPosition: parent.position + 1 };
};

/**
 * カーソル行の上/下へ新規タスクを作るときの position を計算する純粋関数 (`o`/`O`, docs/frontend-design.md §6.1)
 *
 * カーソル行の position そのものを基準にし、`above` はその値、`below` は +1 を返す。
 * 表示されている兄弟の並び順 (添字) を基準にしてはならない。`app_tasks` View は論理削除済みを除外するため
 * (supabase/migrations/20260808000003_app_tasks_view.sql)、同じ兄弟グループに論理削除済みタスクが残っていると
 * 表示上の添字と DB の position がずれ、`o` で作ったタスクがカーソル行の手前に入る
 *
 * position は削除済みも含めた兄弟グループ内で 0 から連続する。作成が末尾 (`count`) へ採番し (create-task.ts)、
 * move_task が ±1 のシフトで連続性を保ち、reorder_tasks は削除済みを含む兄弟グループ全体を 0..n-1 で振り直す
 * (対象が欠けていれば INVALID_PARENT で失敗する) ためである。
 * したがって `position + 1` が作成時の `count` を超えることはない。
 *
 * `app_tasks` View の生成型では position は nullable だが、AppTask が non-null へ narrowing している (src/types/task.ts) ため
 * ここで null を扱う必要はない
 *
 * @returns カーソル未選択、または対象タスクが見つからない場合は null (= 兄弟グループの末尾へ作成する)
 */
export const computeCreatePosition = ({ tasks, cursorTaskId, placement }: { tasks: readonly AppTask[]; cursorTaskId: string | null; placement: SiblingPlacement }): number | null => {
    if (cursorTaskId === null) {
        return null;
    }
    const target = tasks.find((task) => task.id === cursorTaskId);
    if (target === undefined) {
        return null;
    }
    return placement === "above" ? target.position : target.position + 1;
};

/**
 * dnd-kit のドロップ確定時に、ドロップ先の actual parent が変わったかどうかで
 * reorderTasks 用 / moveTask 用のどちらの結果を返すかを判定する純粋関数 (docs/frontend-design.md §9)
 *
 * `targetOrderedIds` はドロップ後に想定される「ドロップ先 parent 内での希望順序」(移動対象タスクを含む)
 */
export const computeDropResult = ({
    tasks,
    taskId,
    targetParentId,
    targetOrderedIds,
}: {
    tasks: readonly AppTask[];
    taskId: string;
    targetParentId: string | null;
    targetOrderedIds: readonly string[];
}): { kind: "reorder"; result: SiblingReorderResult } | { kind: "reparent"; result: ReparentResult } => {
    const target = tasks.find((task) => task.id === taskId);
    const sameParent = target !== undefined && target.parent_id === targetParentId;
    if (sameParent) {
        return { kind: "reorder", result: { parentId: targetParentId, orderedTaskIds: [...targetOrderedIds] } };
    }
    const index = targetOrderedIds.indexOf(taskId);
    return { kind: "reparent", result: { newParentId: targetParentId, newPosition: index < 0 ? targetOrderedIds.length : index } };
};
