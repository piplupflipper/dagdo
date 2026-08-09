import type { AppTask } from "@/types/task";

/**
 * アウトライン表示用の 1 行
 *
 * depth は effective_parent_id を辿った表示上の階層数 (docs/frontend-design.md §4)。
 * 構造操作 (moveTask / reorderTasks) には actual な task.parent_id / task.position を使う必要があるため、
 * この行は task をそのまま保持し、depth はあくまで表示専用の派生値として別に持つ
 */
export type OutlineTreeRow = {
    task: AppTask;
    depth: number;
    hasChildren: boolean;
};

/** sort_path (number[]) を要素ごとに比較する。短い方が先 (親が子より先) になる */
const compareSortPath = (a: readonly number[], b: readonly number[]): number => {
    const length = Math.min(a.length, b.length);
    for (let i = 0; i < length; i += 1) {
        const diff = (a[i] ?? 0) - (b[i] ?? 0);
        if (diff !== 0) {
            return diff;
        }
    }
    return a.length - b.length;
};

/**
 * app_tasks を sort_path 順に整列し、effective_parent_id から depth を算出したフラットリストへ変換する (docs/frontend-design.md §4, §8.1)
 *
 * 表示上のグルーピングは effective_parent_id (削除済み祖先を透明化したもの) を用い、
 * 並び順は View が提供する sort_path にそのまま従う (docs/frontend-design.md §5.3、独自の再ソートはしない)。
 * 構造操作用の actual parent_id / position は task 自身にそのまま残す
 */
export const buildOutlineTree = (tasks: readonly AppTask[]): OutlineTreeRow[] => {
    const sorted = [...tasks].sort((a, b) => compareSortPath(a.sort_path, b.sort_path));
    const byId = new Map(sorted.map((task) => [task.id, task]));
    const depthCache = new Map<string, number>();

    const resolveDepth = (taskId: string, guard: number): number => {
        const cached = depthCache.get(taskId);
        if (cached !== undefined) {
            return cached;
        }
        // 循環参照は DB 側の制約 (TASK_PARENT_CYCLE) で発生しない想定だが、防御的に打ち切る
        if (guard > sorted.length) {
            return 0;
        }
        const task = byId.get(taskId);
        const parentId = task?.effective_parent_id ?? null;
        const depth = parentId === null || !byId.has(parentId) ? 0 : resolveDepth(parentId, guard + 1) + 1;
        depthCache.set(taskId, depth);
        return depth;
    };

    const childCount = new Map<string, number>();
    for (const task of sorted) {
        const parentId = task.effective_parent_id;
        if (parentId !== null) {
            childCount.set(parentId, (childCount.get(parentId) ?? 0) + 1);
        }
    }

    return sorted.map((task) => ({
        task,
        depth: resolveDepth(task.id, 0),
        hasChildren: (childCount.get(task.id) ?? 0) > 0,
    }));
};

/**
 * 子を持つ行 (折りたたみが効く行) の ID を表示順で返す (`z M`, docs/frontend-design.md §6.1)
 *
 * 「子を持つか」は deriveVisibleRows の判定と揃えて表示上の親子関係 (effective_parent_id 由来の hasChildren) で見る。
 * 子を持たない行を折りたたみ集合へ入れても表示は変わらないが、`z M` の後に `z a` を押したときの
 * トグルの向きが反転して見えるため対象から外す
 */
export const collectCollapsibleTaskIds = (rows: readonly OutlineTreeRow[]): string[] => rows.filter((row) => row.hasChildren).map((row) => row.task.id);

/**
 * 折りたたみ (collapsedTaskIds) を反映して可視行を導出する (docs/frontend-design.md §5.1 の za)
 *
 * buildOutlineTree が返す行は sort_path 順 (= 深さ優先の行きがけ順) であるため、
 * 折りたたまれた行より depth が深い行が続く間だけ非表示にすれば足りる
 */
export const deriveVisibleRows = (rows: readonly OutlineTreeRow[], collapsedTaskIds: ReadonlySet<string>): OutlineTreeRow[] => {
    const visible: OutlineTreeRow[] = [];
    let hiddenBelowDepth: number | null = null;

    for (const row of rows) {
        if (hiddenBelowDepth !== null) {
            if (row.depth > hiddenBelowDepth) {
                continue;
            }
            hiddenBelowDepth = null;
        }
        visible.push(row);
        if (row.hasChildren && collapsedTaskIds.has(row.task.id)) {
            hiddenBelowDepth = row.depth;
        }
    }

    return visible;
};
