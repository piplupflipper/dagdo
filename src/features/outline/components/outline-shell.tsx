"use client";

import { type CSSProperties, type JSX, useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import { DagPanel } from "@/features/dag/components/dag-panel";
import { KeymapHelpOverlay } from "@/features/outline/components/keymap-help-overlay";
import { OutlinePane } from "@/features/outline/components/outline-pane";
import { PaneDivider } from "@/features/outline/components/pane-divider";
import { StatusLine } from "@/features/outline/components/status-line";
import { useOutlineKeymap } from "@/features/outline/hooks/use-outline-keymap";
import { formatActionError, formatTaskError } from "@/features/outline/lib/action-error";
import { findBlockingCause } from "@/features/outline/lib/blocking-cause";
import { buildOutlineTree, collectCollapsibleTaskIds, deriveVisibleRows } from "@/features/outline/lib/build-tree";
import { callServerForOp } from "@/features/outline/lib/dispatch-op";
import {
    computeCreatePosition,
    computeIndent,
    computeOutdent,
    computeSiblingSwap,
    findSiblingTaskId,
    type ReparentResult,
    type SiblingPlacement,
    type SiblingReorderResult,
} from "@/features/outline/lib/flatten-for-dnd";
import type { InlineTitleCaret, InlineTitleEdit } from "@/features/outline/lib/inline-title-edit";
import { applyOutlineOp, type OutlineOp } from "@/features/outline/lib/outline-ops";
import { DEFAULT_LEFT_PANE_RATIO, PANE_RATIO_STORAGE_KEY, parseStoredPaneRatio } from "@/features/outline/lib/pane-ratio";
import {
    createPendingCreateRegistry,
    isSameLogicalRow,
    pruneConfirmedRenames,
    queuePendingTitle,
    recordRename,
    resolveRenamedLookup,
    takePendingTitle,
} from "@/features/outline/lib/pending-create-registry";
import { siblingRankOf } from "@/features/outline/lib/sibling-rank";
import { EMPTY_UNDO_HISTORY, popRedoEntry, popUndoEntry, pushToRedo, pushToUndo, recordEntry, type UndoHistoryState } from "@/features/outline/lib/undo-history";
import { SearchOverlay } from "@/features/search/components/search-overlay";
import { filterTasks } from "@/features/search/lib/filter-tasks";
import { completeTask } from "@/features/task/actions/complete-task";
import { createTask } from "@/features/task/actions/create-task";
import { moveTask } from "@/features/task/actions/move-task";
import { reopenTask } from "@/features/task/actions/reopen-task";
import { reorderTasks } from "@/features/task/actions/reorder-tasks";
import { softDeleteTask } from "@/features/task/actions/soft-delete-task";
import { updateTask } from "@/features/task/actions/update-task";
import { DetailPane, type DetailPaneHandle } from "@/features/task-detail/components/detail-pane";
import { MobileDetailSheet } from "@/features/task-detail/components/mobile-detail-sheet";
import { useOutlineStore } from "@/store/outline-store";
import type { AppTask, TaskDependency } from "@/types/task";

export type OutlineShellProps = {
    userId: string;
    initialTasks: AppTask[];
    initialDependencies: TaskDependency[];
};

/**
 * アウトライナー本体のクライアント境界コンポーネント (docs/frontend-design.md §7.1)
 *
 * これより下の features/outline/task-detail/dag/search 配下のコンポーネントは "use client" を再宣言しない。
 * タスクデータは props (RSC 由来) を正とし、`useOptimistic` で全構造操作をオーバーレイする
 * (「表示状態 = reduce(サーバー由来 tasks, pendingOps)」の単一リデューサ方式、docs/frontend-design.md §5.2)。
 * pendingOps は `OutlineOp` (lib/outline-ops.ts) で表し、reduce 本体は純関数 `applyOutlineOp` に切り出してある
 */
export const OutlineShell = ({ userId, initialTasks, initialDependencies }: OutlineShellProps): JSX.Element => {
    const dependencies = initialDependencies;
    const [optimisticTasks, applyOptimisticAction] = useOptimistic(initialTasks, (state: AppTask[], op: OutlineOp) => applyOutlineOp(state, dependencies, op, { fallbackUserId: userId }));
    const [, startTransition] = useTransition();
    const [statusMessage, setStatusMessage] = useState<string | null>(null);
    const [statusError, setStatusError] = useState<string | null>(null);
    /** undo (`u`) / redo (`U`) の履歴スタック (Phase 2、docs/frontend-design.md §5.2) */
    const [undoHistory, setUndoHistory] = useState<UndoHistoryState>(EMPTY_UNDO_HISTORY);
    /**
     * `create` で楽観表示している tempId の集合 (Server Action の確定待ち)
     *
     * tempId はまだ実 DB に存在しないため、これを対象とする構造操作 (J/K/</>/dd/dnd) や undo/redo は
     * Server Action へ送っても失敗するだけである。settle (成功・失敗いずれも) で対象を除去する
     */
    const pendingTempIdsRef = useRef<Set<string>>(new Set());
    const isPendingTaskId = (taskId: string | null): boolean => taskId !== null && pendingTempIdsRef.current.has(taskId);
    /**
     * tempId → 実 id の対応表と、settle 前に確定されたタイトルの保留キュー (バグ修正、pending-create-registry.ts 参照)
     *
     * 楽観 create の tempId が実 id へ切り替わる瞬間、下記のレンダー時調整 (カーソル移動検知・表示行消失検知) や
     * `DetailPane` の同種の調整 (`lastTaskId`) が「別の行への移動」「行の削除」と誤認して行内編集を畳んでしまう
     * 問題 (診断 1, 2) と、settle 前の確定入力を `isPendingTaskId` のガードが黙って捨ててしまう問題 (診断 3) を、
     * ここに集約したロジックで解く
     */
    const pendingCreateRef = useRef(createPendingCreateRegistry());
    /**
     * `?` のヘルプオーバーレイの開閉状態 (Issue #16)
     *
     * モードは NORMAL / VISUAL / SEARCH の 3 値に保つ制約があるため `OutlineMode` には足さず、
     * UI ローカルの表示状態としてここで持つ (Zustand ストアにも置かない)
     */
    const [isHelpOpen, setIsHelpOpen] = useState(false);
    /**
     * `i` / `A` によるタイトルの行内編集の状態 (docs/frontend-design.md §6.1)
     *
     * ヘルプ開閉と同じく `OutlineMode` にもストアにも持たせず、ここで 1 個の値として持つ。
     * 編集中はフォーカスが input にあり、dispatcher が `isEditableTarget` で手前から素通しするため、
     * モードを増やさなくても `j` / `k` でカーソルだけが動くことはない (lib/inline-title-edit.ts)
     */
    const [inlineTitleEdit, setInlineTitleEdit] = useState<InlineTitleEdit | null>(null);
    /** `Enter` で DetailPane の編集領域へフォーカスを移すための参照 (docs/frontend-design.md §6.1) */
    const detailPaneRef = useRef<DetailPaneHandle | null>(null);

    /**
     * PC 2 ペインの左ペイン比率 (%、docs/frontend-design.md §7.1)
     *
     * 初期レンダリングは常に `DEFAULT_LEFT_PANE_RATIO` (60) とし、SSR とのハイドレーション不整合を避ける。
     * localStorage への保存値の復元は mount 後の `useEffect` で行う
     */
    const [leftPaneRatio, setLeftPaneRatio] = useState<number>(DEFAULT_LEFT_PANE_RATIO);
    /** 2 ペインを並べる行コンテナへの参照。PaneDivider がポインタ位置を比率へ変換する基準に使う */
    const paneRowRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const stored = parseStoredPaneRatio(window.localStorage.getItem(PANE_RATIO_STORAGE_KEY));
        if (stored !== null) {
            setLeftPaneRatio(stored);
        }
    }, []);

    /** ドラッグ終了時に確定した比率を localStorage へ保存する (次回訪問時に復元、docs/frontend-design.md §7.1) */
    const handlePaneRatioDragEnd = (ratio: number): void => {
        window.localStorage.setItem(PANE_RATIO_STORAGE_KEY, String(ratio));
    };

    /**
     * 一覧へフォーカスを戻す共通ヘルパー (docs/frontend-design.md §6.1)
     *
     * `DetailPane` / `MobileDetailSheet` の編集領域で `Esc` を押した後や、行内タイトル編集の終了後に呼ぶ。
     * blur だけでも `isEditableTarget`（use-outline-keymap.ts）の抑止からは外れグローバル keymap は復帰するが、
     * フォーカス位置を一覧側へ明示するためにこちらを使う。
     * カーソル行 (`[data-cursor="true"] [role="option"]`、outline-row.tsx。KeymapHelpOverlay の
     * `resolveRestoreTarget` と同じ探索対象) が見つかればそちらへ、カーソル未選択などで
     * 見つからない場合は一覧のスクロールコンテナ (`data-role="outline-scroll"`、tabIndex={-1}) へ focus する
     */
    const focusOutlineList = (): void => {
        const cursorRow = document.querySelector<HTMLElement>('[data-cursor="true"] [role="option"]');
        if (cursorRow !== null) {
            cursorRow.focus();
            return;
        }
        document.querySelector<HTMLElement>('[data-role="outline-scroll"]')?.focus();
    };

    const mode = useOutlineStore((state) => state.mode);
    const cursorTaskId = useOutlineStore((state) => state.cursorTaskId);
    const visualSelectedTaskIds = useOutlineStore((state) => state.visualSelectedTaskIds);
    const collapsedTaskIds = useOutlineStore((state) => state.collapsedTaskIds);
    const flashTaskId = useOutlineStore((state) => state.flashTaskId);
    const searchQuery = useOutlineStore((state) => state.searchQuery);
    const setVisibleTaskIds = useOutlineStore((state) => state.setVisibleTaskIds);
    const setCursor = useOutlineStore((state) => state.setCursor);
    const toggleCollapsed = useOutlineStore((state) => state.toggleCollapsed);
    const collapseAllTasks = useOutlineStore((state) => state.collapseAll);
    const flashTask = useOutlineStore((state) => state.flashTask);
    const exitVisual = useOutlineStore((state) => state.exitVisual);

    // カーソルが別の行へ移ったら行内編集を畳む (行のクリックなど、input の外で起きた移動を拾う)。
    // useEffect による同期ではなくレンダー中の state 調整で行う (detail-pane.tsx の lastTaskId と同じパターン)。
    // ただし、この変化が createSibling の settle による tempId → 実id の付け替え (同一論理行) であれば、
    // 「別の行へ移った」わけではないので畳まない (バグ修正、診断 1)
    const [lastCursorTaskId, setLastCursorTaskId] = useState<string | null>(cursorTaskId);
    if (cursorTaskId !== lastCursorTaskId) {
        const isSameRowRename = isSameLogicalRow(pendingCreateRef.current.renamedIds, lastCursorTaskId, cursorTaskId);
        setLastCursorTaskId(cursorTaskId);
        if (inlineTitleEdit !== null && !isSameRowRename) {
            setInlineTitleEdit(null);
        }
    }

    const tasksById = new Map(optimisticTasks.map((task) => [task.id, task]));
    // 実 id の行が optimisticTasks に現れたのを確認できた tempId 対応は、対応表から剪定する。
    // 放置すると対応表が増え続けるうえ、はるか後になって同じ実id の行が (再編集中に) 正当に削除された場合でも
    // 下の isAwaitingRenamedRow が「まだ revalidate 待ち」と誤認し続けてしまう (pending-create-registry.ts 参照)
    pruneConfirmedRenames(pendingCreateRef.current, (realId) => tasksById.has(realId));
    const rows = buildOutlineTree(optimisticTasks);
    const trimmedQuery = searchQuery.trim();
    const visibleRows =
        trimmedQuery.length === 0
            ? deriveVisibleRows(rows, collapsedTaskIds)
            : (() => {
                  const matchedIds = new Set(filterTasks({ tasks: optimisticTasks, query: trimmedQuery }).map((task) => task.id));
                  return rows.filter((row) => matchedIds.has(row.task.id));
              })();
    const visibleTaskIdList = visibleRows.map((row) => row.task.id);

    // 編集中の行が表示行の集合から消えた場合も行内編集を畳む (`zM` / `zc` による折りたたみ、検索の絞り込み、他経路での削除)。
    // 上のカーソル移動による解除と同じくレンダー中の state 調整で行う。
    // キー経由でここに来ることはない (編集中はフォーカスが input にあり dispatcher が isEditableTarget で素通しする) が、
    // 行の折りたたみボタンのクリックのようにキーボード以外の経路で表示行が変わったとき、
    // input が unmount されたまま inlineTitleEdit だけが残るのを防ぐ。
    // ただし、createSibling の settle で tempId → 実id へ付け替えた直後、revalidate 到着前の一瞬だけ
    // 実id の行がまだ optimisticTasks に存在しない (診断 2) 場合があるため、その付け替え先の id である間は
    // 「消えた」と誤認せず待つ (revalidate 到着後、行が現れれば通常判定に戻る)
    const isAwaitingRenamedRow = inlineTitleEdit !== null && !tasksById.has(inlineTitleEdit.taskId) && Array.from(pendingCreateRef.current.renamedIds.values()).includes(inlineTitleEdit.taskId);
    if (inlineTitleEdit !== null && !visibleTaskIdList.includes(inlineTitleEdit.taskId) && !isAwaitingRenamedRow) {
        setInlineTitleEdit(null);
    }

    useEffect(() => {
        setVisibleTaskIds(visibleTaskIdList);
    }, [visibleTaskIdList, setVisibleTaskIds]);

    // cursorTaskId が実 id へ付け替えられた直後、revalidate 到着前の一瞬だけ optimisticTasks が
    // まだ tempId の行しか持たない場合がある (診断 2)。その間は tempId の行の内容を実id 名義で拾い、
    // cursorTask (DetailPane / MobileDetailSheet へそのまま渡る) が一瞬 null にならないようにする
    const cursorTask = cursorTaskId !== null ? (resolveRenamedLookup(tasksById, pendingCreateRef.current.renamedIds, cursorTaskId, (task, id) => ({ ...task, id })) ?? null) : null;
    const blockedCount = optimisticTasks.filter((task) => task.is_blocked).length;

    /** Server Action が成功で確定した操作を undo 履歴へ積む */
    const pushHistory = (label: string, undoOps: OutlineOp[], redoOps: OutlineOp[]): void => {
        setUndoHistory((previous) => recordEntry(previous, { label, undoOps, redoOps }));
    };

    const runComplete = (taskId: string): void => {
        if (isPendingTaskId(taskId)) {
            return;
        }
        startTransition(async () => {
            applyOptimisticAction({ type: "complete", taskId });
            const result = await completeTask({ taskId });
            if (!result.ok) {
                if (result.code === "TASK_BLOCKED") {
                    const cause = findBlockingCause(taskId, tasksById, dependencies);
                    if (cause !== null) {
                        flashTask(cause.id);
                    }
                    setStatusError(formatTaskError("TASK_BLOCKED", `${cause?.title ?? "依存先"} が未完了のため完了できません`));
                    return;
                }
                setStatusError(formatActionError(result));
                return;
            }
            setStatusError(null);
            pushHistory("完了", [{ type: "reopen", taskId }], [{ type: "complete", taskId }]);
        });
    };

    const runReopen = (taskId: string): void => {
        if (isPendingTaskId(taskId)) {
            return;
        }
        startTransition(async () => {
            applyOptimisticAction({ type: "reopen", taskId });
            const result = await reopenTask({ taskId });
            if (!result.ok) {
                setStatusError(formatActionError(result));
                return;
            }
            setStatusError(null);
            pushHistory("再オープン", [{ type: "complete", taskId }], [{ type: "reopen", taskId }]);
        });
    };

    const handleToggleDone = (task: AppTask): void => {
        if (task.completed_at !== null) {
            runReopen(task.id);
            return;
        }
        runComplete(task.id);
    };

    const completeCursor = (): void => {
        if (cursorTask === null || cursorTask.completed_at !== null) {
            return;
        }
        runComplete(cursorTask.id);
    };

    /** VISUAL の `x`。選択範囲の一括完了は、成功した taskId 群を 1 エントリにまとめて undo 履歴へ積む */
    const completeSelection = (): void => {
        const taskIds = Array.from(visualSelectedTaskIds).filter((taskId) => !isPendingTaskId(taskId));
        if (taskIds.length === 0) {
            exitVisual();
            return;
        }
        startTransition(async () => {
            const succeededTaskIds: string[] = [];
            for (const taskId of taskIds) {
                applyOptimisticAction({ type: "complete", taskId });
                const result = await completeTask({ taskId });
                if (result.ok) {
                    succeededTaskIds.push(taskId);
                } else {
                    console.error(`[outline] completeTask failed for ${taskId}: ${result.code} ${result.message}`);
                }
            }
            setStatusMessage(`${taskIds.length}件中${succeededTaskIds.length}件を完了`);
            if (succeededTaskIds.length > 0) {
                pushHistory(
                    `選択範囲の完了 (${succeededTaskIds.length}件)`,
                    succeededTaskIds.map((taskId): OutlineOp => ({ type: "reopen", taskId })),
                    succeededTaskIds.map((taskId): OutlineOp => ({ type: "complete", taskId })),
                );
            }
            exitVisual();
        });
    };

    /**
     * カーソル行の下 (`o`) / 上 (`O`) に同じ actual parent の兄弟として新規タスクを作る
     *
     * position はカーソル行の兄弟グループ内での並び順から決める。カーソル未選択のときは
     * ルート直下の兄弟グループ末尾へ作る (computeCreatePosition が null を返す)。
     * tempId は crypto.randomUUID() で採番し、楽観行を即表示してカーソルも合わせる。
     * Server Action 成功後、実 id へ setCursor し直す。
     *
     * settle 時は tempId → 実id の付け替えを「同一論理行」として扱う (バグ修正、pending-create-registry.ts)。
     * `recordRename` で対応表へ記録したうえで、カーソルと (編集中であれば) `inlineTitleEdit.taskId` の両方を
     * 実id へ揃える。カーソルの付け替え自体は上のレンダー時調整が対応表を見て「畳まない」と判定するため、
     * ここで `setInlineTitleEdit` を呼んでも編集中の下書き (`draft`) は保たれる (`InlineTitleEditor` は
     * controlled value になっており、行の再マウントをまたいで `OutlineShell` 側の state に生き続ける)。
     * settle 前に Enter/Esc で確定されたタイトルがあれば (`commitInlineTitleEdit` が保留したもの)、
     * ここで実id の通常パイプラインへ流す。create 自体が失敗した場合は保留分を破棄し、既存のエラー表示に合流する
     */
    const createSibling = (placement: SiblingPlacement): void => {
        const parentId = cursorTask?.parent_id ?? null;
        const position = computeCreatePosition({ tasks: optimisticTasks, cursorTaskId: cursorTask?.id ?? null, placement });
        const tempId = crypto.randomUUID();
        const title = "新規タスク";
        // undo (redo of create = restore) の材料として、確定前に「作成直後の行」を純関数で先読みしておく。
        // 実 id が分かるのは Server Action の応答後だが、position/effective_parent_id/sort_path は
        // applyOutlineOp を直接呼べば同じ計算で先に求まる (dispatch はまだしない、副作用なし)
        const projectedRow = applyOutlineOp(optimisticTasks, dependencies, { type: "create", tempId, title, parentId, position }, { fallbackUserId: userId }).find((task) => task.id === tempId);

        pendingTempIdsRef.current.add(tempId);
        startTransition(async () => {
            applyOptimisticAction({ type: "create", tempId, title, parentId, position });
            setCursor(tempId);
            const result = await createTask({ title, parentId, position });
            pendingTempIdsRef.current.delete(tempId);
            if (!result.ok) {
                // 保留中のタイトル確定 (診断 3) があれば、create 自体の失敗に合わせて破棄する
                takePendingTitle(pendingCreateRef.current, tempId);
                setStatusError(formatActionError(result));
                return;
            }
            const realId = result.data.id;
            recordRename(pendingCreateRef.current, tempId, realId);
            setCursor(realId);
            setInlineTitleEdit((current) => (current !== null && current.taskId === tempId ? { ...current, taskId: realId } : current));
            setStatusError(null);
            if (projectedRow !== undefined) {
                const snapshot: AppTask = { ...projectedRow, id: realId };
                pushHistory("新規タスク", [{ type: "softDelete", taskId: realId }], [{ type: "restore", taskId: realId, snapshot }]);
            }
            // settle 前に Enter/Esc で確定されていたタイトル (診断 3) を、実id の通常パイプライン
            // (楽観適用 + updateTask + undo 履歴) へ流す。create の title (= "新規タスク") のままなら何もしない
            const pendingTitle = takePendingTitle(pendingCreateRef.current, tempId);
            if (pendingTitle !== undefined && pendingTitle !== title) {
                applyOptimisticAction({ type: "updateTitle", taskId: realId, title: pendingTitle });
                const titleResult = await updateTask({ taskId: realId, title: pendingTitle });
                if (!titleResult.ok) {
                    setStatusError(formatActionError(titleResult));
                    return;
                }
                pushHistory("タイトル変更", [{ type: "updateTitle", taskId: realId, title }], [{ type: "updateTitle", taskId: realId, title: pendingTitle }]);
            }
        });
    };

    /** `i` / `A`。カーソル行のタイトルの行内編集を開始する。実際のフォーカス移動は InlineTitleEditor の callback ref が行う */
    const startInlineTitleEdit = (caret: InlineTitleCaret): void => {
        if (cursorTask === null) {
            return;
        }
        setInlineTitleEdit({ taskId: cursorTask.id, caret, draft: cursorTask.title });
    };

    /** 行内タイトル編集中の下書きの変更。`InlineTitleEditor` を controlled にするための onChange (バグ修正、診断 1/2 対策) */
    const updateInlineTitleDraft = (taskId: string, draft: string): void => {
        setInlineTitleEdit((current) => (current !== null && current.taskId === taskId ? { ...current, draft } : current));
    };

    /**
     * タイトル変更の確定。タイトルが変わっていなければ Server Action を投げずに編集だけ畳む
     *
     * 行内タイトル編集 (`i`/`A`) と DetailPane のタイトル編集の両方から呼ぶ共通ハンドラである
     * (どちらも同じ `updateTitle` Op を経由する単一の保存経路、docs/frontend-design.md §5.2)。
     * DetailPane 側には行内編集の state (`inlineTitleEdit`) が無いため、`setInlineTitleEdit(null)` は
     * その経路では実質 no-op (既に null) になるだけで害はない。
     *
     * `taskId` が tempId (createTask の settle 待ち) の場合、以前はここで黙って入力を捨てていた (診断 3)。
     * 今は settle 後に実id で通常パイプラインへ流すため、保留キューへ置くだけにする
     * (`createSibling` の settle 処理が `takePendingTitle` で取り出す)
     */
    const commitInlineTitleEdit = (taskId: string, title: string): void => {
        setInlineTitleEdit(null);
        if (isPendingTaskId(taskId)) {
            queuePendingTitle(pendingCreateRef.current, taskId, title);
            return;
        }
        const task = tasksById.get(taskId);
        if (task === undefined || task.title === title) {
            return;
        }
        const previousTitle = task.title;
        startTransition(async () => {
            applyOptimisticAction({ type: "updateTitle", taskId, title });
            const result = await updateTask({ taskId, title });
            if (!result.ok) {
                setStatusError(formatActionError(result));
                return;
            }
            setStatusError(null);
            pushHistory("タイトル変更", [{ type: "updateTitle", taskId, title: previousTitle }], [{ type: "updateTitle", taskId, title }]);
        });
    };

    /**
     * DetailPane の説明編集の確定 (改修 3、docs/frontend-design.md §5.2, §6.5)
     *
     * `commitInlineTitleEdit` と同じ形 (楽観適用 → `updateTask` → 失敗時 `setStatusError` → 成功時 `pushHistory`)。
     * 確定した瞬間に `applyOptimisticAction` で即時反映されるため、`updateTask` の応答を待たずに
     * 呼び出し元 (DetailPane) は編集領域を畳んでよい。「保存中」のブロッキング表示はここでは行わない
     */
    const commitDescriptionEdit = (taskId: string, description: string): void => {
        if (isPendingTaskId(taskId)) {
            return;
        }
        const task = tasksById.get(taskId);
        if (task === undefined || task.description === description) {
            return;
        }
        const previousDescription = task.description;
        startTransition(async () => {
            applyOptimisticAction({ type: "updateDescription", taskId, description });
            const result = await updateTask({ taskId, description });
            if (!result.ok) {
                setStatusError(formatActionError(result));
                return;
            }
            setStatusError(null);
            pushHistory("説明変更", [{ type: "updateDescription", taskId, description: previousDescription }], [{ type: "updateDescription", taskId, description }]);
        });
    };

    /** DetailPane の期日編集の確定 (改修 3)。commitDescriptionEdit と同じ形 */
    const commitDueDateEdit = (taskId: string, dueDate: string | null): void => {
        if (isPendingTaskId(taskId)) {
            return;
        }
        const task = tasksById.get(taskId);
        if (task === undefined || task.due_date === dueDate) {
            return;
        }
        const previousDueDate = task.due_date;
        startTransition(async () => {
            applyOptimisticAction({ type: "updateDueDate", taskId, dueDate });
            const result = await updateTask({ taskId, dueDate });
            if (!result.ok) {
                setStatusError(formatActionError(result));
                return;
            }
            setStatusError(null);
            pushHistory("期日変更", [{ type: "updateDueDate", taskId, dueDate: previousDueDate }], [{ type: "updateDueDate", taskId, dueDate }]);
        });
    };

    const focusDetailEditor = (): void => {
        // タスク未選択のときは DetailPane が編集領域を持たない (「タスクを選択してください」表示) ため何もしない
        if (cursorTask === null) {
            return;
        }
        detailPaneRef.current?.focusEditor();
    };

    /**
     * `{` / `}`。同じ actual parent の 1 つ前 / 後の兄弟へカーソルを移す
     *
     * 端の兄弟にいるときは動かさない (`j` / `k` が端で留まるのと揃える)
     */
    const jumpToSibling = (direction: "up" | "down"): void => {
        if (cursorTaskId === null) {
            return;
        }
        const siblingTaskId = findSiblingTaskId({ tasks: optimisticTasks, taskId: cursorTaskId, direction });
        if (siblingTaskId === null) {
            return;
        }
        setCursor(siblingTaskId);
    };

    /**
     * `zM`。子を持つ行をすべて折りたたむ
     *
     * 対象 ID の算出をここで行い、ストアへは ID の集合だけを渡す。ストアの visibleTaskIds は depth も parent_id も持たず
     * 「子を持つ行」を判定できないためで、ストアへ木構造を複製しないための分担である (docs/frontend-design.md §5.2)。
     * 対になる `zR` がストアのアクション (expandAll) だけで完結するのと非対称なのはこの理由による
     */
    const collapseAll = (): void => {
        collapseAllTasks(collectCollapsibleTaskIds(rows));
    };

    /** `J`/`K`。同一階層で 1 つ下/上へ (`reorder` Op)。逆操作は移動前の rank へ戻す `reorder` */
    const moveCursorSibling = (direction: "up" | "down"): void => {
        if (cursorTaskId === null || isPendingTaskId(cursorTaskId)) {
            return;
        }
        const taskId = cursorTaskId;
        const result: SiblingReorderResult | null = computeSiblingSwap({ tasks: optimisticTasks, taskId, direction });
        if (result === null) {
            return;
        }
        const previousRank = siblingRankOf(optimisticTasks, taskId);
        const newRank = result.orderedTaskIds.indexOf(taskId);
        startTransition(async () => {
            applyOptimisticAction({ type: "reorder", taskId, newPosition: newRank });
            const actionResult = await reorderTasks(result);
            if (!actionResult.ok) {
                setStatusError(formatActionError(actionResult));
                return;
            }
            setStatusError(null);
            pushHistory(direction === "down" ? "下へ移動" : "上へ移動", [{ type: "reorder", taskId, newPosition: previousRank }], [{ type: "reorder", taskId, newPosition: newRank }]);
        });
    };

    const indentCursor = (): void => {
        if (cursorTaskId === null || isPendingTaskId(cursorTaskId)) {
            return;
        }
        const taskId = cursorTaskId;
        const previous = tasksById.get(taskId);
        const result: ReparentResult | null = computeIndent({ tasks: optimisticTasks, taskId });
        if (result === null || previous === undefined) {
            return;
        }
        startTransition(async () => {
            applyOptimisticAction({ type: "move", taskId, newParentId: result.newParentId, newPosition: result.newPosition });
            const actionResult = await moveTask({ taskId, newParentId: result.newParentId, newPosition: result.newPosition });
            if (!actionResult.ok) {
                setStatusError(formatActionError(actionResult));
                return;
            }
            setStatusError(null);
            pushHistory(
                "インデント",
                [{ type: "move", taskId, newParentId: previous.parent_id, newPosition: previous.position }],
                [{ type: "move", taskId, newParentId: result.newParentId, newPosition: result.newPosition }],
            );
        });
    };

    const outdentCursor = (): void => {
        if (cursorTaskId === null || isPendingTaskId(cursorTaskId)) {
            return;
        }
        const taskId = cursorTaskId;
        const previous = tasksById.get(taskId);
        const result: ReparentResult | null = computeOutdent({ tasks: optimisticTasks, taskId });
        if (result === null || previous === undefined) {
            return;
        }
        startTransition(async () => {
            applyOptimisticAction({ type: "move", taskId, newParentId: result.newParentId, newPosition: result.newPosition });
            const actionResult = await moveTask({ taskId, newParentId: result.newParentId, newPosition: result.newPosition });
            if (!actionResult.ok) {
                setStatusError(formatActionError(actionResult));
                return;
            }
            setStatusError(null);
            pushHistory(
                "アウトデント",
                [{ type: "move", taskId, newParentId: previous.parent_id, newPosition: previous.position }],
                [{ type: "move", taskId, newParentId: result.newParentId, newPosition: result.newPosition }],
            );
        });
    };

    /**
     * `dd`。逆操作は削除直前の行のスナップショットを丸ごと持たせた `restore` に加え、`move` を続ける
     * (outline-ops.ts の OutlineOp 参照)
     *
     * `restore_task` RPC (migration 0005) は actual sibling group の末尾へ position を移す仕様であり、
     * 削除前の元の位置には戻さない (restore-task.ts のドキュメントコメント参照)。
     * undo で「元の位置に戻った」ように見せるには、restore に続けて元の parent_id/position への `move` が要る。
     * `move` の楽観適用は oldParentId/oldPosition === newParentId/newPosition (どちらも snapshot の値) の
     * ときに no-op になる (applyOutlineOp の隙間詰め/隙間空けが互いに打ち消す) ため、
     * ローカル表示は restore 直後の snapshot 位置のまま変わらず、末尾へ飛んで見えることはない。
     * サーバー側だけ tail → 元の位置へ move_task RPC で正しく収束する
     */
    const softDeleteCursor = (): void => {
        if (cursorTaskId === null || isPendingTaskId(cursorTaskId)) {
            return;
        }
        const taskId = cursorTaskId;
        const snapshot = tasksById.get(taskId);
        if (snapshot === undefined) {
            return;
        }
        startTransition(async () => {
            applyOptimisticAction({ type: "softDelete", taskId });
            const actionResult = await softDeleteTask({ taskId });
            if (!actionResult.ok) {
                setStatusError(formatActionError(actionResult));
                return;
            }
            setStatusError(null);
            pushHistory(
                "ゴミ箱へ移動",
                [
                    { type: "restore", taskId, snapshot },
                    { type: "move", taskId, newParentId: snapshot.parent_id, newPosition: snapshot.position },
                ],
                [{ type: "softDelete", taskId }],
            );
        });
    };

    /** dnd-kit のドロップ確定 (同一 actual parent 内)。キーボード代替の `moveCursorSibling` と同じ `reorder` Op を使う */
    const handleReorder = (taskId: string, result: SiblingReorderResult): void => {
        if (isPendingTaskId(taskId)) {
            return;
        }
        const previousRank = siblingRankOf(optimisticTasks, taskId);
        const newRank = result.orderedTaskIds.indexOf(taskId);
        startTransition(async () => {
            applyOptimisticAction({ type: "reorder", taskId, newPosition: newRank });
            const actionResult = await reorderTasks(result);
            if (!actionResult.ok) {
                setStatusError(formatActionError(actionResult));
                return;
            }
            setStatusError(null);
            pushHistory("並べ替え", [{ type: "reorder", taskId, newPosition: previousRank }], [{ type: "reorder", taskId, newPosition: newRank }]);
        });
    };

    /** dnd-kit のドロップ確定 (actual parent が変わる)。キーボード代替の indent/outdent と同じ `move` Op を使う */
    const handleReparent = (taskId: string, result: ReparentResult): void => {
        if (isPendingTaskId(taskId)) {
            return;
        }
        const previous = tasksById.get(taskId);
        if (previous === undefined) {
            return;
        }
        startTransition(async () => {
            applyOptimisticAction({ type: "move", taskId, newParentId: result.newParentId, newPosition: result.newPosition });
            const actionResult = await moveTask({ taskId, newParentId: result.newParentId, newPosition: result.newPosition });
            if (!actionResult.ok) {
                setStatusError(formatActionError(actionResult));
                return;
            }
            setStatusError(null);
            pushHistory(
                "親を変更",
                [{ type: "move", taskId, newParentId: previous.parent_id, newPosition: previous.position }],
                [{ type: "move", taskId, newParentId: result.newParentId, newPosition: result.newPosition }],
            );
        });
    };

    /**
     * 確定済み Op の列を通常パイプライン (楽観適用 + Server Action) で順に実行する (undo/redo 共通処理、Phase 2)
     *
     * 1 つでも失敗すればエラー表示のうえ `false` を返し、呼び出し側はそのエントリを再度スタックへ積まない (破棄する)。
     * `tasksSnapshot` は `reorder` Op が Server Action へ渡す `orderedTaskIds` の再構成に使う (実行前の 1 スナップショット固定)
     */
    const runOpsForHistory = async (ops: readonly OutlineOp[], tasksSnapshot: readonly AppTask[]): Promise<boolean> => {
        let allOk = true;
        for (const op of ops) {
            applyOptimisticAction(op);
            const result = await callServerForOp(op, tasksSnapshot);
            if (!result.ok) {
                allOk = false;
                setStatusError(formatActionError(result));
            }
        }
        if (allOk) {
            setStatusError(null);
        }
        return allOk;
    };

    /** `u`。undo スタックの末尾を実行する (Phase 2、docs/frontend-design.md §5.2) */
    const undo = (): void => {
        const popped = popUndoEntry(undoHistory);
        if (popped === null) {
            return;
        }
        setUndoHistory(popped.rest);
        const tasksSnapshot = optimisticTasks;
        startTransition(async () => {
            const allOk = await runOpsForHistory(popped.entry.undoOps, tasksSnapshot);
            if (allOk) {
                setUndoHistory((previous) => pushToRedo(previous, popped.entry));
            }
        });
    };

    /** `U`。redo スタックの末尾を実行する (Phase 2、docs/frontend-design.md §5.2) */
    const redo = (): void => {
        const popped = popRedoEntry(undoHistory);
        if (popped === null) {
            return;
        }
        setUndoHistory(popped.rest);
        const tasksSnapshot = optimisticTasks;
        startTransition(async () => {
            const allOk = await runOpsForHistory(popped.entry.redoOps, tasksSnapshot);
            if (allOk) {
                setUndoHistory((previous) => pushToUndo(previous, popped.entry));
            }
        });
    };

    useOutlineKeymap({
        handlers: {
            completeCursor,
            completeSelection,
            createSibling,
            startInlineTitleEdit,
            focusDetailEditor,
            jumpToSibling,
            collapseAll,
            moveCursorSibling,
            indentCursor,
            outdentCursor,
            softDeleteCursor,
            undo,
            redo,
            openHelp: () => setIsHelpOpen(true),
            closeHelp: () => setIsHelpOpen(false),
        },
        isHelpOpen,
    });

    return (
        <div className="flex h-dvh flex-col text-text">
            {/*
             * ヘルプ表示中の背面は inert にする (MobileDetailSheet が閉じている間と同じ道具)
             *
             * role="dialog" + aria-modal="true" で「背面は不活性」と支援技術へ宣言している以上、
             * Tab で背面へ抜けられる状態はその宣言と矛盾する。
             * 抜けた先が textarea だと isEditableTarget により dispatcher が手前で return するため、
             * q / Esc でヘルプを閉じられなくなる実害もある。
             * オーバーレイ自身 (KeymapHelpOverlay) はこのルート直下の兄弟であり inert の外に置く。
             * SearchOverlay は mode === "SEARCH" のときだけ描画されるが、? は NORMAL のエントリで、
             * SEARCH へ入る導線 (`/` とヘッダの検索ボタン) は表示中どちらも封じられるため対象外でよい
             */}
            <div className="flex flex-shrink-0 items-center gap-2 border-b border-border bg-bg-alt px-3.5 py-2 backdrop-blur-xl" inert={isHelpOpen}>
                <button
                    type="button"
                    onClick={() => useOutlineStore.getState().enterSearch()}
                    className="flex min-w-0 flex-1 items-center gap-1.5 rounded-base border border-border bg-bg px-2.5 py-1.5 text-left text-xs text-text-dim md:min-w-[200px] md:flex-initial"
                >
                    <span aria-hidden="true">⌕</span>
                    <span className="truncate">/ で検索欄を開く</span>
                </button>
                <button
                    type="button"
                    onClick={() => (mode === "VISUAL" ? exitVisual() : useOutlineStore.getState().enterVisual())}
                    className="flex-shrink-0 rounded-base border border-border px-2.5 py-1.5 text-xs text-accent hover:bg-accent/10"
                >
                    V ビジュアル
                </button>
                <button type="button" onClick={() => createSibling("below")} className="flex-shrink-0 rounded-base border border-border px-2.5 py-1.5 text-xs text-accent hover:bg-accent/10">
                    + 新規タスク
                </button>
                {/* キーボード操作のヒントはモバイル幅では意味がなく、横幅も圧迫するため md 以上でのみ表示する */}
                <span className="ml-auto hidden text-[11px] text-text-dim md:inline">j k 移動・x 完了・V 範囲選択・/ 検索・? ヘルプ</span>
            </div>

            {/*
             * PC 幅は 2 ペイン、モバイル幅は左ペイン全幅 + MobileDetailSheet。切り替えは Tailwind のブレークポイントのみで行う。
             * 左ペインの幅比 (`leftPaneRatio`) は `md:flex-[0_0_var(--left-pane-percent)]` として CSS 変数越しに適用する。
             * `md:` 接頭辞が付いた Tailwind の responsive utility は @media 経由でのみ効くため、この変数を使っても
             * モバイル幅では素の `flex-1`（全幅）のままになる (docs/frontend-design.md §7.1)
             */}
            <div ref={paneRowRef} className="flex min-h-0 flex-1" inert={isHelpOpen}>
                <div className="flex min-w-0 flex-1 flex-col border-border md:flex-[0_0_var(--left-pane-percent)] md:border-r" style={{ "--left-pane-percent": `${leftPaneRatio}%` } as CSSProperties}>
                    <OutlinePane
                        visibleRows={visibleRows}
                        tasks={optimisticTasks}
                        dependencies={dependencies}
                        cursorTaskId={cursorTaskId}
                        visualSelectedTaskIds={visualSelectedTaskIds}
                        flashTaskId={flashTaskId}
                        inlineTitleEdit={inlineTitleEdit}
                        onSelectCursor={setCursor}
                        onToggleCollapse={toggleCollapsed}
                        onToggleDone={handleToggleDone}
                        onReorder={handleReorder}
                        onReparent={handleReparent}
                        onInlineTitleDraftChange={updateInlineTitleDraft}
                        onCommitInlineTitle={commitInlineTitleEdit}
                        onCancelInlineTitle={() => setInlineTitleEdit(null)}
                        onFocusOutlineList={focusOutlineList}
                    />
                    <StatusLine mode={mode} cursorTask={cursorTask} totalCount={optimisticTasks.length} blockedCount={blockedCount} infoMessage={statusMessage} errorMessage={statusError} />
                </div>
                {/* dnd-kit の DndContext (行の並べ替え、OutlinePane 内) の外に置き、行 dnd とポインタ操作を競合させない */}
                <PaneDivider containerRef={paneRowRef} ratio={leftPaneRatio} onRatioChange={setLeftPaneRatio} onDragEnd={handlePaneRatioDragEnd} />
                <div className="hidden min-w-0 flex-1 flex-col bg-bg-alt backdrop-blur-sm md:flex">
                    <DetailPane
                        ref={detailPaneRef}
                        task={cursorTask}
                        allTasks={optimisticTasks}
                        dependencies={dependencies}
                        tempIdRenames={pendingCreateRef.current.renamedIds}
                        onEscapeToOutline={focusOutlineList}
                        onCommitTitle={commitInlineTitleEdit}
                        onCommitDescription={commitDescriptionEdit}
                        onCommitDueDate={commitDueDateEdit}
                    />
                    <DagPanel centerTaskId={cursorTaskId} tasks={optimisticTasks} dependencies={dependencies} flashTaskId={flashTaskId} />
                </div>
            </div>

            <MobileDetailSheet
                task={cursorTask}
                allTasks={optimisticTasks}
                dependencies={dependencies}
                flashTaskId={flashTaskId}
                isInert={isHelpOpen}
                tempIdRenames={pendingCreateRef.current.renamedIds}
                onClose={() => setCursor(null)}
                onEscapeToOutline={focusOutlineList}
                onCommitTitle={commitInlineTitleEdit}
                onCommitDescription={commitDescriptionEdit}
                onCommitDueDate={commitDueDateEdit}
            />

            <SearchOverlay />

            <KeymapHelpOverlay isOpen={isHelpOpen} onClose={() => setIsHelpOpen(false)} />
        </div>
    );
};
