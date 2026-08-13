import type { OutlineTreeRow } from "@/features/outline/lib/build-tree";
import type { AppTask } from "@/types/task";

/** dnd-kit の useSortable に渡すフラット項目 (docs/frontend-design.md §9) */
type FlattenedDndItem = {
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
    /**
     * 新しい actual parent 内の実 DB position。`null` は「新しい兄弟グループの末尾へ追加する」を表す
     * (move_task RPC の `p_new_position = NULL`, supabase/migrations/20260813000002_move_task_append_to_tail.sql)
     *
     * 表示されている兄弟の並び順 (添字) を基準にしてはならない理由は `computeCreatePosition` の
     * ドキュメントコメントと同じである。末尾だけは実 position を求められないため `null` で表す (Issue #53)
     */
    newPosition: number | null;
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
 * 新しい親 (直前の兄弟) の子の末尾に追加する。末尾は `newPosition: null` で表し、実 position は
 * move_task RPC が求める (supabase/migrations/20260813000002_move_task_append_to_tail.sql)。
 * `app_tasks` View は論理削除済みを除外するため、クライアントは移動先の実際の末尾を知れない。
 * 変更前は可視の子の数をそのまま `newPosition` にしていたため、移動先に論理削除済みの子が残っていると
 * 末尾ではなく可視の最後の子より前へ入っていた (Issue #53)
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
    return { newParentId: previousSibling.id, newPosition: null };
};

/**
 * タスクの親を 1 階層上げる (outdent, `<`, docs/frontend-design.md §6.1, §9)
 *
 * 現在の親の直後 (現在の親と同じ階層) へ挿入する。
 * 基準にするのは親の実 position であり、表示されている兄弟の並び順 (添字) ではない
 * (`computeCreatePosition` のドキュメントコメント参照)。移動先の兄弟グループに論理削除済みの行が
 * 残っていても `parent.position + 1` は実 position のままである
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
 * move_task が ±1 のシフトで連続性を保ち、reorder_tasks は可視の兄弟が占めている position の集合をそのまま
 * 使い回して順序だけを入れ替える (supabase/migrations/20260808000007_reorder_tasks_exclude_deleted_siblings.sql)
 * ためである。いずれもグループ全体が占める position の集合を変えない。
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
 * 挿入位置の基準にする兄弟の並びは、可視行ではなく `tasks` (全兄弟) の position 順から作る (Issue #42)。
 * 絞り込み中は可視行からクエリに合わない兄弟が欠けるため、可視の兄弟だけから求めた rank を
 * そのまま全兄弟へ当てはめると、見えていない兄弟を飛び越えてしまう
 * (rank を全兄弟の並びへ適用するのは outline-ops.ts の `resolveReorderedSiblingIds` である)。
 * 絞り込みが無ければ可視の兄弟 = 全兄弟なので結果は変わらない。
 * 折りたたみは兄弟グループごと隠す (deriveVisibleRows は折りたたんだ行より深い行をまとめて落とす) ため、
 * 兄弟の一部だけが欠けることは起きず、ここでも結果は変わらない。
 *
 * `overTaskId` はドロップ先の行 (dnd-kit の `over.id`)。挿入位置は dnd-kit の `arrayMove` と同じ規則、
 * すなわち「対象 1 件を抜いた並びの、抜く前に `overTaskId` があった添字」へ挿し込む形で決める。
 * 結果として上へのドラッグはドロップ先の直前、下へのドラッグはドロップ先の直後に入る。
 *
 * reparent 分岐が返す `newPosition` は rank ではなくドロップ先の行の実 position である (Issue #53)。
 * 親を跨ぐドロップでは対象が移動先の兄弟グループに居ないため、上記の規則は常に「ドロップ先の直前へ挿す」
 * になり、これは move_task RPC が `p_new_position` 以降を +1 シフトする挙動 (migration 0005) と一致する。
 * 変更前は可視の兄弟の中での添字を渡していたため、移動先に論理削除済みの兄弟が残っていると
 * 1 つ手前のスロットへ落ちていた
 */
export const computeDropResult = ({
    tasks,
    taskId,
    targetParentId,
    overTaskId,
}: {
    tasks: readonly AppTask[];
    taskId: string;
    targetParentId: string | null;
    overTaskId: string;
}): { kind: "reorder"; result: SiblingReorderResult } | { kind: "reparent"; result: ReparentResult } => {
    const target = tasks.find((task) => task.id === taskId);
    const siblings = siblingsOf(tasks, targetParentId);
    const orderedTaskIds = siblings.map((sibling) => sibling.id);
    const fromRank = orderedTaskIds.indexOf(taskId);
    const overRank = orderedTaskIds.indexOf(overTaskId);
    // ドロップ先がその兄弟グループに属さない場合 (現状の呼び出し方では起きない) は末尾へ落とす
    const insertRank = overRank < 0 ? orderedTaskIds.length : overRank;
    if (fromRank >= 0) {
        orderedTaskIds.splice(fromRank, 1);
    }
    orderedTaskIds.splice(insertRank, 0, taskId);

    const sameParent = target !== undefined && target.parent_id === targetParentId;
    if (sameParent) {
        return { kind: "reorder", result: { parentId: targetParentId, orderedTaskIds } };
    }
    // ドロップ先の行が占めている実 position をそのまま渡す。
    // 兄弟グループに属さないドロップ先は末尾 (null) へ落とす (上記 insertRank と同じ扱い)
    return { kind: "reparent", result: { newParentId: targetParentId, newPosition: siblings[overRank]?.position ?? null } };
};
