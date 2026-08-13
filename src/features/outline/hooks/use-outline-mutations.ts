import { type Dispatch, type SetStateAction, useRef, useState, useTransition } from "react";
import { formatActionError, formatTaskError } from "@/features/outline/lib/action-error";
import { findBlockingCause } from "@/features/outline/lib/blocking-cause";
import { callServerForOp } from "@/features/outline/lib/dispatch-op";
import {
    computeCreatePosition,
    computeIndent,
    computeOutdent,
    computeSiblingSwap,
    type ReparentResult,
    type SiblingPlacement,
    type SiblingReorderResult,
} from "@/features/outline/lib/flatten-for-dnd";
import type { InlineTitleEdit } from "@/features/outline/lib/inline-title-edit";
import { invertOutlineOp } from "@/features/outline/lib/invert-op";
import { applyOutlineOp, type OutlineOp } from "@/features/outline/lib/outline-ops";
import { type PendingCreateRegistry, queuePendingTitle, recordRename, takePendingTitle } from "@/features/outline/lib/pending-create-registry";
import { EMPTY_UNDO_HISTORY, popRedoEntry, popUndoEntry, pushToRedo, pushToUndo, recordEntry, type UndoHistoryState } from "@/features/outline/lib/undo-history";
import { completeTask } from "@/features/task/actions/complete-task";
import { createTask } from "@/features/task/actions/create-task";
import { updateTask } from "@/features/task/actions/update-task";
import type { ActionResult } from "@/features/task/lib/action-result";
import { useOutlineStore } from "@/store/outline-store";
import type { AppTask, TaskDependency } from "@/types/task";

type UseOutlineMutationsArgs = {
    userId: string;
    /** 楽観適用後の一覧。逆操作の材料と `reorder` の再構成にそのまま使う */
    tasks: AppTask[];
    tasksById: ReadonlyMap<string, AppTask>;
    dependencies: TaskDependency[];
    /** カーソル行のタスク (`usePendingCreate` が対応表越しに解決したもの) */
    cursorTask: AppTask | null;
    pendingCreate: PendingCreateRegistry;
    applyOptimisticAction: (op: OutlineOp) => void;
    /** 行内タイトル編集の state。`createSibling` の settle と `commitInlineTitleEdit` が書き換える */
    setInlineTitleEdit: Dispatch<SetStateAction<InlineTitleEdit | null>>;
};

/** データを書き換える操作の一式 (StatusLine へ出す 2 つのメッセージを含む) */
type OutlineMutations = {
    /** StatusLine の情報表示。現状は VISUAL の一括完了の件数のみ */
    statusMessage: string | null;
    /** StatusLine のエラー表示。Server Action が失敗するたびに差し替わり、成功で null へ戻る */
    statusError: string | null;
    /** 行のチェックボックス。完了済みなら再オープン、未完了なら完了 */
    handleToggleDone: (task: AppTask) => void;
    /** NORMAL の `x` */
    completeCursor: () => void;
    /** VISUAL の `x` */
    completeSelection: () => void;
    /** `o` / `O` とヘッダの `+ 新規タスク` */
    createSibling: (placement: SiblingPlacement) => void;
    /** 行内タイトル編集と DetailPane のタイトル編集に共通の確定処理 */
    commitInlineTitleEdit: (taskId: string, title: string) => void;
    /** DetailPane の説明編集の確定 */
    commitDescriptionEdit: (taskId: string, description: string) => void;
    /** DetailPane の期日編集の確定 */
    commitDueDateEdit: (taskId: string, dueDate: string | null) => void;
    /** `J` / `K` */
    moveCursorSibling: (direction: "up" | "down") => void;
    /** `>` */
    indentCursor: () => void;
    /** `<` */
    outdentCursor: () => void;
    /** `dd` */
    softDeleteCursor: () => void;
    /** dnd-kit のドロップ確定 (同一 actual parent 内) */
    handleReorder: (taskId: string, result: SiblingReorderResult) => void;
    /** dnd-kit のドロップ確定 (actual parent が変わる) */
    handleReparent: (taskId: string, result: ReparentResult) => void;
    /** `u` */
    undo: () => void;
    /** `U` */
    redo: () => void;
};

/**
 * タスクを書き換える操作をまとめたフック (docs/frontend-design.md §5.2)
 *
 * 「楽観適用 → Server Action → ステータス行 → undo 履歴」という 1 本のパイプライン (`runOp`) と、
 * そこへ Op を流すだけの各ハンドラで構成する。ステータス行の 2 つのメッセージ、undo/redo の履歴、
 * 確定待ちの tempId 集合はいずれもこのパイプラインの内部事情なので、ここで持って外へは結果だけを返す。
 *
 * カーソルや VISUAL の選択範囲といったストアの状態は、`OutlineShell` から渡さず selector で直接購読する
 * (同じレンダーで同じ値を見るため二重管理にはならない)
 */
export const useOutlineMutations = ({ userId, tasks, tasksById, dependencies, cursorTask, pendingCreate, applyOptimisticAction, setInlineTitleEdit }: UseOutlineMutationsArgs): OutlineMutations => {
    const [, startTransition] = useTransition();
    const [statusMessage, setStatusMessage] = useState<string | null>(null);
    const [statusError, setStatusError] = useState<string | null>(null);
    /** undo (`u`) / redo (`U`) の履歴スタック (docs/frontend-design.md §5.2) */
    const [undoHistory, setUndoHistory] = useState<UndoHistoryState>(EMPTY_UNDO_HISTORY);
    /**
     * `create` で楽観表示している tempId の集合 (Server Action の確定待ち)
     *
     * tempId はまだ実 DB に存在しないため、これを対象とする構造操作 (J/K/</>/dd/dnd) や undo/redo は
     * Server Action へ送っても失敗するだけである。settle (成功・失敗いずれも) で対象を除去する
     */
    const pendingTempIdsRef = useRef<Set<string>>(new Set());
    const isPendingTaskId = (taskId: string | null): boolean => taskId !== null && pendingTempIdsRef.current.has(taskId);

    const cursorTaskId = useOutlineStore((state) => state.cursorTaskId);
    const visualSelectedTaskIds = useOutlineStore((state) => state.visualSelectedTaskIds);
    const setCursor = useOutlineStore((state) => state.setCursor);
    const flashTask = useOutlineStore((state) => state.flashTask);
    const exitVisual = useOutlineStore((state) => state.exitVisual);

    /** Server Action が成功で確定した操作を undo 履歴へ積む */
    const pushHistory = (label: string, undoOps: OutlineOp[], redoOps: OutlineOp[]): void => {
        setUndoHistory((previous) => recordEntry(previous, { label, undoOps, redoOps }));
    };

    /**
     * 1 Op を実行する唯一の経路 (楽観適用 → Server Action → ステータス行 → undo 履歴、docs/frontend-design.md §5.2)
     *
     * 通常操作 (`x` / `J` / `>` / `dd` / タイトル・説明・期日の確定 / dnd のドロップ) はこの関数を通り、
     * undo/redo (`u` / `U`) は Op 列を順に流す `runOpsForHistory` を通る。どちらも Op から Server Action への
     * 振り分けを `callServerForOp` (lib/dispatch-op.ts) 1 箇所へ集約しており、Op 種別を足すときに
     * 片方だけ直す事故が起きないようにしてある (Issue #32)。
     *
     * 履歴に積む Op 列はここで導く。`redoOps` は元の操作そのもの (`[op]`、undo-history.ts の `UndoEntry` 参照)、
     * `undoOps` は `invertOutlineOp` (lib/invert-op.ts) が Op と実行前のスナップショットから組み立てる。
     * 逆操作を組み立てられない Op (対象行が手元に無い、`create` / `restore`) は履歴を積めないため、
     * 楽観適用も Server Action も行わずに何もしない。統合前も各ハンドラが同じ条件で早期 return しており、
     * 現状この分岐へ到達する呼び出しは無い (呼び出し側が逆操作の材料の有無を先に確かめている)。
     *
     * `onError` は骨格から外れるエラー処理の逃がし口である。ステータス行へ出す文言を返せばそれを使い、
     * `undefined` を返せば既定の `formatActionError` に委ねる。文言の差し替え以外の副作用 (原因タスクの点滅など) も
     * この中で行う。使うのは `runComplete` の `TASK_BLOCKED` 分岐だけである
     */
    const runOp = (op: OutlineOp, label: string, onError?: (result: Extract<ActionResult, { ok: false }>) => string | undefined): void => {
        // 逆操作の材料も `reorder` の `orderedTaskIds` の再構成も、楽観適用より前の一覧から取る
        const tasksSnapshot = tasks;
        const undoOps = invertOutlineOp(op, tasksSnapshot);
        if (undoOps === null) {
            return;
        }
        startTransition(async () => {
            applyOptimisticAction(op);
            const result = await callServerForOp(op, tasksSnapshot);
            if (!result.ok) {
                setStatusError(onError?.(result) ?? formatActionError(result));
                return;
            }
            setStatusError(null);
            pushHistory(label, undoOps, [op]);
        });
    };

    const runComplete = (taskId: string): void => {
        if (isPendingTaskId(taskId)) {
            return;
        }
        // 依存先が未完了で弾かれた場合だけ、Server Action の英語 message ではなく原因タスク名を含む文言を出し、
        // その原因タスクを DAG パネルで点滅させる (findBlockingCause は手元の依存関係から原因を 1 件だけ求める)
        runOp({ type: "complete", taskId }, "完了", (result) => {
            if (result.code !== "TASK_BLOCKED") {
                return undefined;
            }
            const cause = findBlockingCause(taskId, tasks, dependencies);
            if (cause !== null) {
                flashTask(cause.id);
            }
            return formatTaskError("TASK_BLOCKED", `${cause?.title ?? "依存先"} が未完了のため完了できません`);
        });
    };

    const runReopen = (taskId: string): void => {
        if (isPendingTaskId(taskId)) {
            return;
        }
        runOp({ type: "reopen", taskId }, "再オープン");
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
     * settle 時は tempId → 実id の付け替えを「同一論理行」として扱う (pending-create-registry.ts)。
     * `recordRename` で対応表へ記録したうえで、カーソルと (編集中であれば) `inlineTitleEdit.taskId` の両方を
     * 実id へ揃える。カーソルの付け替え自体は `usePendingCreate` のレンダー時調整が対応表を見て「畳まない」と
     * 判定するため、ここで `setInlineTitleEdit` を呼んでも編集中の下書き (`draft`) は保たれる
     * (`InlineTitleEditor` は controlled value になっており、行の再マウントをまたいで `OutlineShell` 側の
     * state に生き続ける)。
     * settle 前に Enter/Esc で確定されたタイトルがあれば (`commitInlineTitleEdit` が保留したもの)、
     * ここで実id の通常パイプラインへ流す。create 自体が失敗した場合は保留分を破棄し、既存のエラー表示に合流する
     */
    const createSibling = (placement: SiblingPlacement): void => {
        const parentId = cursorTask?.parent_id ?? null;
        const position = computeCreatePosition({ tasks, cursorTaskId: cursorTask?.id ?? null, placement });
        const tempId = crypto.randomUUID();
        const title = "新規タスク";
        // undo (redo of create = restore) の材料として、確定前に「作成直後の行」を純関数で先読みしておく。
        // 実 id が分かるのは Server Action の応答後だが、position/effective_parent_id/sort_path は
        // applyOutlineOp を直接呼べば同じ計算で先に求まる (dispatch はまだしない、副作用なし)
        const projectedRow = applyOutlineOp(tasks, dependencies, { type: "create", tempId, title, parentId, position }, { fallbackUserId: userId }).find((task) => task.id === tempId);

        pendingTempIdsRef.current.add(tempId);
        startTransition(async () => {
            applyOptimisticAction({ type: "create", tempId, title, parentId, position });
            setCursor(tempId);
            const result = await createTask({ title, parentId, position });
            pendingTempIdsRef.current.delete(tempId);
            if (!result.ok) {
                // 保留中のタイトル確定があれば、create 自体の失敗に合わせて破棄する
                takePendingTitle(pendingCreate, tempId);
                setStatusError(formatActionError(result));
                return;
            }
            const realId = result.data.id;
            // 先読みしておいた行を実 id 名義にしたもの。undo 履歴の材料であると同時に、
            // revalidate 到着までのつなぎとして一覧へ差し込む行でもある (Issue #60、pending-create-registry.ts)
            const snapshot: AppTask | undefined = projectedRow === undefined ? undefined : { ...projectedRow, id: realId };
            recordRename(pendingCreate, tempId, realId, snapshot);
            setCursor(realId);
            setInlineTitleEdit((current) => (current !== null && current.taskId === tempId ? { ...current, taskId: realId } : current));
            setStatusError(null);
            if (snapshot !== undefined) {
                pushHistory("新規タスク", [{ type: "softDelete", taskId: realId }], [{ type: "restore", taskId: realId, snapshot }]);
            }
            // settle 前に Enter/Esc で確定されていたタイトルを、実id の通常パイプライン
            // (楽観適用 + updateTask + undo 履歴) へ流す。create の title (= "新規タスク") のままなら何もしない
            const pendingTitle = takePendingTitle(pendingCreate, tempId);
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

    /**
     * タイトル変更の確定。タイトルが変わっていなければ Server Action を投げずに編集だけ畳む
     *
     * 行内タイトル編集 (`i` / `I` / `a` / `A`) と DetailPane のタイトル編集の両方から呼ぶ共通ハンドラである
     * (どちらも同じ `updateTitle` Op を経由する単一の保存経路、docs/frontend-design.md §5.2)。
     * DetailPane 側には行内編集の state (`inlineTitleEdit`) が無いため、`setInlineTitleEdit(null)` は
     * その経路では実質 no-op (既に null) になるだけで害はない。
     *
     * `taskId` が tempId (createTask の settle 待ち) の場合は、settle 後に実id で通常パイプラインへ流すため、
     * ここでは保留キューへ置くだけにする (`createSibling` の settle 処理が `takePendingTitle` で取り出す)
     */
    const commitInlineTitleEdit = (taskId: string, title: string): void => {
        setInlineTitleEdit(null);
        if (isPendingTaskId(taskId)) {
            queuePendingTitle(pendingCreate, taskId, title);
            return;
        }
        const task = tasksById.get(taskId);
        if (task === undefined || task.title === title) {
            return;
        }
        runOp({ type: "updateTitle", taskId, title }, "タイトル変更");
    };

    /**
     * DetailPane の説明編集の確定 (docs/frontend-design.md §5.2, §6.5)
     *
     * `commitInlineTitleEdit` と同じ形 (値が変わっていなければ何もせず、変わっていれば `runOp` へ渡す)。
     * 確定した瞬間に `applyOptimisticAction` で即時反映されるため、Server Action の応答を待たずに
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
        runOp({ type: "updateDescription", taskId, description }, "説明変更");
    };

    /** DetailPane の期日編集の確定。commitDescriptionEdit と同じ形 */
    const commitDueDateEdit = (taskId: string, dueDate: string | null): void => {
        if (isPendingTaskId(taskId)) {
            return;
        }
        const task = tasksById.get(taskId);
        if (task === undefined || task.due_date === dueDate) {
            return;
        }
        runOp({ type: "updateDueDate", taskId, dueDate }, "期日変更");
    };

    /** `J`/`K`。同一階層で 1 つ下/上へ (`reorder` Op)。逆操作は移動前の rank へ戻す `reorder` */
    const moveCursorSibling = (direction: "up" | "down"): void => {
        if (cursorTaskId === null || isPendingTaskId(cursorTaskId)) {
            return;
        }
        const taskId = cursorTaskId;
        const result: SiblingReorderResult | null = computeSiblingSwap({ tasks, taskId, direction });
        if (result === null) {
            return;
        }
        // `reorder` Op が持つのは兄弟内の rank だけである。Server Action へ渡す `orderedTaskIds` は
        // `callServerForOp` が同じ rank から再構成する (outline-ops.ts の resolveReorderedSiblingIds)
        const newRank = result.orderedTaskIds.indexOf(taskId);
        runOp({ type: "reorder", taskId, newPosition: newRank }, direction === "down" ? "下へ移動" : "上へ移動");
    };

    const indentCursor = (): void => {
        if (cursorTaskId === null || isPendingTaskId(cursorTaskId)) {
            return;
        }
        const taskId = cursorTaskId;
        const result: ReparentResult | null = computeIndent({ tasks, taskId });
        if (result === null) {
            return;
        }
        runOp({ type: "move", taskId, newParentId: result.newParentId, newPosition: result.newPosition }, "インデント");
    };

    const outdentCursor = (): void => {
        if (cursorTaskId === null || isPendingTaskId(cursorTaskId)) {
            return;
        }
        const taskId = cursorTaskId;
        const result: ReparentResult | null = computeOutdent({ tasks, taskId });
        if (result === null) {
            return;
        }
        runOp({ type: "move", taskId, newParentId: result.newParentId, newPosition: result.newPosition }, "アウトデント");
    };

    /**
     * `dd`。逆操作は削除直前の行のスナップショットを丸ごと持たせた `restore` に加え、`move` を続ける
     * (outline-ops.ts の OutlineOp 参照)
     *
     * `restore_task` RPC (migration 0005) は actual sibling group の末尾へ position を移す仕様であり (req.md §26)、
     * 削除前の元の位置には戻さない (restore-task.ts のドキュメントコメント参照)。
     * undo で「元の位置に戻った」ように見せるには、restore に続けて元の parent_id/position への `move` が要る。
     * `move` の楽観適用は oldParentId/oldPosition === newParentId/newPosition (どちらも snapshot の値) の
     * ときに no-op になる (applyOutlineOp の隙間詰め/隙間空けが互いに打ち消す) ため、
     * ローカル表示は restore 直後の snapshot 位置のまま変わらず、末尾へ飛んで見えることはない。
     * サーバー側だけ tail → 元の位置へ move_task RPC で正しく収束する。
     * restore_task は復元対象が空けた穴も詰めるため (migration 20260813000001、Issue #23)、
     * 続く move_task の後の兄弟の position は楽観適用側と一致する
     * (supabase/tests/011_position_gaps.test.sql のケース8 と outline-ops.test.ts が両側を固定する)
     * (この 2 Op 列の組み立ては lib/invert-op.ts の `softDelete` 分岐が持つ)
     */
    const softDeleteCursor = (): void => {
        if (cursorTaskId === null || isPendingTaskId(cursorTaskId)) {
            return;
        }
        runOp({ type: "softDelete", taskId: cursorTaskId }, "ゴミ箱へ移動");
    };

    /** dnd-kit のドロップ確定 (同一 actual parent 内)。キーボード代替の `moveCursorSibling` と同じ `reorder` Op を使う */
    const handleReorder = (taskId: string, result: SiblingReorderResult): void => {
        if (isPendingTaskId(taskId)) {
            return;
        }
        runOp({ type: "reorder", taskId, newPosition: result.orderedTaskIds.indexOf(taskId) }, "並べ替え");
    };

    /** dnd-kit のドロップ確定 (actual parent が変わる)。キーボード代替の indent/outdent と同じ `move` Op を使う */
    const handleReparent = (taskId: string, result: ReparentResult): void => {
        if (isPendingTaskId(taskId)) {
            return;
        }
        runOp({ type: "move", taskId, newParentId: result.newParentId, newPosition: result.newPosition }, "親を変更");
    };

    /**
     * 確定済み Op の列を通常パイプライン (楽観適用 + Server Action) で順に実行する (undo/redo 共通処理)
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

    /** `u`。undo スタックの末尾を実行する (docs/frontend-design.md §5.2) */
    const undo = (): void => {
        const popped = popUndoEntry(undoHistory);
        if (popped === null) {
            return;
        }
        setUndoHistory(popped.rest);
        const tasksSnapshot = tasks;
        startTransition(async () => {
            const allOk = await runOpsForHistory(popped.entry.undoOps, tasksSnapshot);
            if (allOk) {
                setUndoHistory((previous) => pushToRedo(previous, popped.entry));
            }
        });
    };

    /** `U`。redo スタックの末尾を実行する (docs/frontend-design.md §5.2) */
    const redo = (): void => {
        const popped = popRedoEntry(undoHistory);
        if (popped === null) {
            return;
        }
        setUndoHistory(popped.rest);
        const tasksSnapshot = tasks;
        startTransition(async () => {
            const allOk = await runOpsForHistory(popped.entry.redoOps, tasksSnapshot);
            if (allOk) {
                setUndoHistory((previous) => pushToUndo(previous, popped.entry));
            }
        });
    };

    return {
        statusMessage,
        statusError,
        handleToggleDone,
        completeCursor,
        completeSelection,
        createSibling,
        commitInlineTitleEdit,
        commitDescriptionEdit,
        commitDueDateEdit,
        moveCursorSibling,
        indentCursor,
        outdentCursor,
        softDeleteCursor,
        handleReorder,
        handleReparent,
        undo,
        redo,
    };
};
