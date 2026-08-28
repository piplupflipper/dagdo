import { useRouter } from "next/navigation";
import { type Dispatch, type SetStateAction, useEffect, useState } from "react";
import { useOpQueue } from "@/features/outline/hooks/use-op-queue";
import { formatActionError, formatTaskError } from "@/features/outline/lib/action-error";
import { findBlockingCause } from "@/features/outline/lib/blocking-cause";
import { findDeletionSuccessor } from "@/features/outline/lib/deletion-successor";
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
import { dispatchRepeatCommand, type RepeatableCommand } from "@/features/outline/lib/repeat-command";
import { EMPTY_UNDO_HISTORY, popRedoEntry, popUndoEntry, pushToRedo, pushToUndo, recordEntry, type UndoHistoryState } from "@/features/outline/lib/undo-history";
import { validateOutlineOp } from "@/features/outline/lib/validate-op";
import type { TaskErrorCode } from "@/features/task/lib/action-result";
import { useOutlineStore } from "@/store/outline-store";
import type { AppTask, TaskDependency } from "@/types/task";

type UseOutlineMutationsArgs = {
    userId: string;
    /** クライアント正のタスク一覧 (`OutlineShell` の state)。逆操作の材料と `reorder` の再構成にそのまま使う */
    tasks: AppTask[];
    tasksById: ReadonlyMap<string, AppTask>;
    dependencies: TaskDependency[];
    /** カーソル行のタスク */
    cursorTask: AppTask | null;
    /** 1 Op をクライアント正 state へ同期適用する (`OutlineShell` の setState) */
    applyOp: (op: OutlineOp) => void;
    /** 行内タイトル編集の state。`commitInlineTitleEdit` が畳む */
    setInlineTitleEdit: Dispatch<SetStateAction<InlineTitleEdit | null>>;
};

/** データを書き換える操作の一式 (StatusLine へ出す 2 つのメッセージと、Op キューの未同期件数を含む) */
type OutlineMutations = {
    /** StatusLine の情報表示。現状は VISUAL の一括完了の件数のみ */
    statusMessage: string | null;
    /** StatusLine のエラー表示。バリデーション失敗・キュー破棄・版ずれ停止で差し替わり、次の成功操作で null へ戻る */
    statusError: string | null;
    /** Op キューの未同期件数 (送信中含む)。reconcile ゲート (`OutlineShell`) が 0 のときだけ props を採用する */
    pendingCount: number;
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
    /** `.`。直前の変更をカーソル行へ再発行する (Issue #74) */
    repeatLastChange: () => void;
};

/**
 * 事前バリデーション失敗をステータス行へ出すときの英語 message (サーバー防波堤の RAISE EXCEPTION の文言に揃える)
 *
 * validateOutlineOp が返すのはこの 4 種のみ。TASK_BLOCKED は通常 `runComplete` の差し替え口が
 * 日本語文言に置き換えるため、ここの文言が出るのは差し替え口を通らない undo/redo 経由の場合だけである
 */
const VALIDATION_MESSAGES: Partial<Record<TaskErrorCode, string>> = {
    TASK_BLOCKED: "task has an incomplete, non-deleted dependency",
    TASK_PARENT_CYCLE: "moving under the new parent would create a cycle",
    INVALID_PARENT: "parent task not found",
    INVALID_POSITION: "position is out of range",
};

const formatValidationError = (code: TaskErrorCode): string => formatTaskError(code, VALIDATION_MESSAGES[code] ?? "rejected by client-side validation");

/**
 * タスクを書き換える操作をまとめたフック (docs/frontend-design.md §5.2、Issue #70)
 *
 * 「validate → invert → apply (同期 setState) → enqueue → 履歴 push」という 1 本の同期パイプライン (`runOp`) と、
 * そこへ Op を流すだけの各ハンドラで構成する。永続化は背後の直列 Op キュー (use-op-queue.ts) が担い、
 * Server Action の応答をここでは待たない (write-behind)。ステータス行の 2 つのメッセージと undo/redo の履歴は
 * このパイプラインの内部事情なので、ここで持って外へは結果だけを返す。
 *
 * カーソルや VISUAL の選択範囲といったストアの状態は、`OutlineShell` から渡さず selector で直接購読する
 * (同じレンダーで同じ値を見るため二重管理にはならない)
 */
export const useOutlineMutations = ({ userId, tasks, tasksById, dependencies, cursorTask, applyOp, setInlineTitleEdit }: UseOutlineMutationsArgs): OutlineMutations => {
    const [statusMessage, setStatusMessage] = useState<string | null>(null);
    const [statusError, setStatusError] = useState<string | null>(null);
    /** undo (`u`) / redo (`U`) の履歴スタック (docs/frontend-design.md §5.2) */
    const [undoHistory, setUndoHistory] = useState<UndoHistoryState>(EMPTY_UNDO_HISTORY);
    /**
     * ドットリピート (`.`) のレジスタ (直近 1 件、非永続、Issue #74)
     *
     * 記録するのは「事前バリデーションを通過して apply された変更」だけであり、弾かれた操作や no-op は上書きしない。
     * 書き込むのはキー由来の 5 ハンドラ (completeCursor / softDeleteCursor / moveCursorSibling / indentCursor /
     * outdentCursor) のみで、チェックボックスクリック・dnd・VISUAL 一括完了・undo/redo は記録しない
     */
    const [repeatRegister, setRepeatRegister] = useState<RepeatableCommand | null>(null);

    const router = useRouter();

    /**
     * 背後の直列 Op キュー
     *
     * 版ずれ停止と防波堤ヒット (残キュー破棄) はどちらもステータス行のエラーとして通知する。
     * reconcile トリガ (SPEC §6): キューが空になった瞬間 (onDrained) と防波堤ヒットで残キューを破棄した直後
     * (onDiscard) に `router.refresh()` を打つ。届いた props を採用するかは reconcile ゲート
     * (outline-shell.tsx) が判断する
     */
    const opQueue = useOpQueue({
        onVersionSkew: (message) => setStatusError(message),
        onDiscard: (failure) => {
            setStatusError(formatActionError(failure));
            router.refresh();
        },
        onDrained: () => router.refresh(),
    });

    // reconcile トリガの残る 1 つ: visibilitychange で visible へ復帰したとき (SPEC §6)。
    // 別タブ・別デバイスでの変更を取り込む口であり、キューに未同期の Op がある間は打たない
    // (打っても reconcile ゲートが無視するが、無駄な再取得を避ける)
    useEffect(() => {
        if (opQueue.pendingCount > 0) {
            return;
        }
        const handleVisibilityChange = (): void => {
            if (document.visibilityState === "visible") {
                router.refresh();
            }
        };
        document.addEventListener("visibilitychange", handleVisibilityChange);
        return () => {
            document.removeEventListener("visibilitychange", handleVisibilityChange);
        };
    }, [opQueue.pendingCount, router]);

    const cursorTaskId = useOutlineStore((state) => state.cursorTaskId);
    const visualSelectedTaskIds = useOutlineStore((state) => state.visualSelectedTaskIds);
    const setCursor = useOutlineStore((state) => state.setCursor);
    const flashTask = useOutlineStore((state) => state.flashTask);
    const exitVisual = useOutlineStore((state) => state.exitVisual);

    /** 成功した操作でステータス行のエラーを消す。ただし版ずれ停止の文言 (再読み込みの導線) は消さない */
    const clearStatusError = (): void => {
        if (!opQueue.isStopped) {
            setStatusError(null);
        }
    };

    /** apply 済みで確定した操作を undo 履歴へ積む (Server Action の成功は待たない、SPEC §5) */
    const pushHistory = (label: string, undoOps: OutlineOp[], redoOps: OutlineOp[]): void => {
        setUndoHistory((previous) => recordEntry(previous, { label, undoOps, redoOps }));
    };

    /**
     * 1 Op を実行する唯一の経路 (validate → invert → apply → enqueue → 履歴 push、Issue #70)
     *
     * すべて同期処理であり、Server Action の応答は待たない (送信は Op キューが裏で行う)。
     * 通常操作 (`x` / `J` / `>` / `dd` / タイトル・説明・期日の確定 / dnd のドロップ) はこの関数を通り、
     * undo/redo (`u` / `U`) は Op 列を順に流す `runOpsForHistory` を通る。どちらも Op から Server Action への
     * 振り分けを `callServerForOp` (lib/dispatch-op.ts、キューの flusher が呼ぶ) 1 箇所へ集約している (Issue #32)。
     *
     * 事前バリデーション (lib/validate-op.ts) に失敗した Op は apply も enqueue もせず、
     * サーバー防波堤に当たったときと同じ形のエラー表示だけを出す。
     * `onValidationError` は文言の差し替え口で、使うのは `runComplete` の `TASK_BLOCKED` 分岐だけである
     * (原因タスク名を含む日本語文言に置き換え、原因タスクを点滅させる)。
     *
     * 履歴に積む Op 列はここで導く。`redoOps` は元の操作そのもの (`[op]`)、`undoOps` は `invertOutlineOp`
     * (lib/invert-op.ts) が Op と実行前のスナップショットから組み立てる。逆操作を組み立てられない Op
     * (対象行が手元に無い、`create` / `restore`) は履歴を積めないため何もしない
     * (呼び出し側が逆操作の材料の有無を先に確かめており、現状この分岐へ到達する呼び出しは無い)
     *
     * @returns apply まで到達したら true。逆操作を組み立てられなかった場合とバリデーション失敗は false。
     * ドットリピート (`.`) のレジスタが「apply された変更」だけを記録するための通知口である (Issue #74)
     */
    const runOp = (op: OutlineOp, label: string, onValidationError?: (code: TaskErrorCode) => string | undefined): boolean => {
        // 逆操作の材料も `reorder` の `orderedTaskIds` の再構成も、適用前の一覧から取る
        const tasksSnapshot = tasks;
        const undoOps = invertOutlineOp(op, tasksSnapshot);
        if (undoOps === null) {
            return false;
        }
        const validation = validateOutlineOp(op, tasksSnapshot, dependencies);
        if (!validation.ok) {
            setStatusError(onValidationError?.(validation.code) ?? formatValidationError(validation.code));
            return false;
        }
        applyOp(op);
        opQueue.enqueue(op, tasksSnapshot);
        clearStatusError();
        pushHistory(label, undoOps, [op]);
        return true;
    };

    const runComplete = (taskId: string): boolean => {
        // 依存先が未完了で弾かれた場合だけ、既定の英語 message ではなく原因タスク名を含む文言を出し、
        // その原因タスクを DAG パネルで点滅させる (findBlockingCause は手元の依存関係から原因を 1 件だけ求める)
        return runOp({ type: "complete", taskId }, "完了", (code) => {
            if (code !== "TASK_BLOCKED") {
                return undefined;
            }
            const cause = findBlockingCause(taskId, tasks, dependencies);
            if (cause !== null) {
                flashTask(cause.id);
            }
            return formatTaskError("TASK_BLOCKED", `${cause?.title ?? "依存先"} が未完了のため完了できません`);
        });
    };

    const handleToggleDone = (task: AppTask): void => {
        if (task.completed_at !== null) {
            runOp({ type: "reopen", taskId: task.id }, "再オープン");
            return;
        }
        runComplete(task.id);
    };

    /** completeCursor のレジスタへ記録しない内部版。`.` の再発行 (repeatLastChange) と共有する */
    const executeCompleteCursor = (): boolean => {
        if (cursorTask === null || cursorTask.completed_at !== null) {
            return false;
        }
        return runComplete(cursorTask.id);
    };

    const completeCursor = (): void => {
        if (executeCompleteCursor()) {
            setRepeatRegister({ kind: "complete" });
        }
    };

    /**
     * VISUAL の `x`。選択範囲の一括完了は、各対象を validate し、通過した分だけ apply + enqueue する
     *
     * 個々の失敗 (blocked による弾き) は「N件中M件を完了」という件数で伝える (現行踏襲)。
     * 履歴は通過分を 1 エントリにまとめる。`StatusLine` は `errorMessage` を `infoMessage` より優先して出す
     */
    const completeSelection = (): void => {
        const taskIds = Array.from(visualSelectedTaskIds);
        if (taskIds.length === 0) {
            exitVisual();
            return;
        }
        // 先に完了した対象が依存先だった場合は後続の blocked が解けるため、validate は 1 件ずつ適用後の一覧で行う
        let currentTasks: readonly AppTask[] = tasks;
        const succeededTaskIds: string[] = [];
        for (const taskId of taskIds) {
            const op: OutlineOp = { type: "complete", taskId };
            const validation = validateOutlineOp(op, currentTasks, dependencies);
            if (!validation.ok) {
                // 件数 (下の `statusMessage`) で伝え、切り分け用に code をログへ残す
                console.error(`[outline] complete validation failed for ${taskId}: ${validation.code}`);
                continue;
            }
            const tasksSnapshot = currentTasks;
            currentTasks = applyOutlineOp(currentTasks, dependencies, op, { fallbackUserId: userId });
            applyOp(op);
            opQueue.enqueue(op, [...tasksSnapshot]);
            succeededTaskIds.push(taskId);
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
    };

    /**
     * カーソル行の下 (`o`) / 上 (`O`) に同じ actual parent の兄弟として新規タスクを作る
     *
     * position はカーソル行の兄弟グループ内での並び順から決める。カーソル未選択のときは
     * ルート直下の兄弟グループ末尾へ作る (computeCreatePosition が null を返す)。
     * id は crypto.randomUUID() で採番した実 PK であり、createTask Server Action の INSERT にそのまま使う
     * (Issue #70)。行はこの id のまま生き続けるため、settle 後の付け替えは要らない。
     *
     * 履歴は通常パイプラインの「redo = 元の Op」では表せない (undo の softDelete 後に create を再送すると
     * 同一 id の INSERT が防波堤に当たる) ため、undo = softDelete / redo = restore の対を自前で積む。
     * restore の材料になる「作成直後の行」は applyOutlineOp を先に純関数として呼んで求める
     */
    const createSibling = (placement: SiblingPlacement): void => {
        const parentId = cursorTask?.parent_id ?? null;
        const position = computeCreatePosition({ tasks, cursorTaskId: cursorTask?.id ?? null, placement });
        const op: OutlineOp = { type: "create", id: crypto.randomUUID(), title: "新規タスク", parentId, position };
        const validation = validateOutlineOp(op, tasks, dependencies);
        if (!validation.ok) {
            setStatusError(formatValidationError(validation.code));
            return;
        }
        const snapshot = applyOutlineOp(tasks, dependencies, op, { fallbackUserId: userId }).find((task) => task.id === op.id);
        applyOp(op);
        opQueue.enqueue(op, tasks);
        setCursor(op.id);
        clearStatusError();
        if (snapshot !== undefined) {
            pushHistory("新規タスク", [{ type: "softDelete", taskId: op.id }], [{ type: "restore", taskId: op.id, snapshot }]);
        }
    };

    /**
     * タイトル変更の確定。タイトルが変わっていなければ Op を流さずに編集だけ畳む
     *
     * 行内タイトル編集 (`i` / `I` / `a` / `A`) と DetailPane のタイトル編集の両方から呼ぶ共通ハンドラである
     * (どちらも同じ `updateTitle` Op を経由する単一の保存経路、docs/frontend-design.md §5.2)。
     * DetailPane 側には行内編集の state (`inlineTitleEdit`) が無いため、`setInlineTitleEdit(null)` は
     * その経路では実質 no-op (既に null) になるだけで害はない
     */
    const commitInlineTitleEdit = (taskId: string, title: string): void => {
        setInlineTitleEdit(null);
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
     * 適用は同期なので、呼び出し元 (DetailPane) はそのまま編集領域を畳んでよい。「保存中」のブロッキング表示はしない
     */
    const commitDescriptionEdit = (taskId: string, description: string): void => {
        const task = tasksById.get(taskId);
        if (task === undefined || task.description === description) {
            return;
        }
        runOp({ type: "updateDescription", taskId, description }, "説明変更");
    };

    /** DetailPane の期日編集の確定。commitDescriptionEdit と同じ形 */
    const commitDueDateEdit = (taskId: string, dueDate: string | null): void => {
        const task = tasksById.get(taskId);
        if (task === undefined || task.due_date === dueDate) {
            return;
        }
        runOp({ type: "updateDueDate", taskId, dueDate }, "期日変更");
    };

    /** moveCursorSibling のレジスタへ記録しない内部版。`.` の再発行 (repeatLastChange) と共有する */
    const executeMoveCursorSibling = (direction: "up" | "down"): boolean => {
        if (cursorTaskId === null) {
            return false;
        }
        const taskId = cursorTaskId;
        const result: SiblingReorderResult | null = computeSiblingSwap({ tasks, taskId, direction });
        if (result === null) {
            return false;
        }
        // `reorder` Op が持つのは兄弟内の rank だけである。Server Action へ渡す `orderedTaskIds` は
        // キューの flusher が同じ rank から再構成する (outline-ops.ts の resolveReorderedSiblingIds)
        const newRank = result.orderedTaskIds.indexOf(taskId);
        return runOp({ type: "reorder", taskId, newPosition: newRank }, direction === "down" ? "下へ移動" : "上へ移動");
    };

    /** `J`/`K`。同一階層で 1 つ下/上へ (`reorder` Op)。逆操作は移動前の rank へ戻す `reorder` */
    const moveCursorSibling = (direction: "up" | "down"): void => {
        if (executeMoveCursorSibling(direction)) {
            setRepeatRegister({ kind: "reorder", direction });
        }
    };

    /** indentCursor のレジスタへ記録しない内部版。`.` の再発行 (repeatLastChange) と共有する */
    const executeIndentCursor = (): boolean => {
        if (cursorTaskId === null) {
            return false;
        }
        const taskId = cursorTaskId;
        const result: ReparentResult | null = computeIndent({ tasks, taskId });
        if (result === null) {
            return false;
        }
        return runOp({ type: "move", taskId, newParentId: result.newParentId, newPosition: result.newPosition }, "インデント");
    };

    const indentCursor = (): void => {
        if (executeIndentCursor()) {
            setRepeatRegister({ kind: "indent" });
        }
    };

    /** outdentCursor のレジスタへ記録しない内部版。`.` の再発行 (repeatLastChange) と共有する */
    const executeOutdentCursor = (): boolean => {
        if (cursorTaskId === null) {
            return false;
        }
        const taskId = cursorTaskId;
        const result: ReparentResult | null = computeOutdent({ tasks, taskId });
        if (result === null) {
            return false;
        }
        return runOp({ type: "move", taskId, newParentId: result.newParentId, newPosition: result.newPosition }, "アウトデント");
    };

    const outdentCursor = (): void => {
        if (executeOutdentCursor()) {
            setRepeatRegister({ kind: "outdent" });
        }
    };

    /**
     * `dd`。逆操作は削除直前の行のスナップショットを丸ごと持たせた `restore` に加え、`move` を続ける
     * (outline-ops.ts の OutlineOp 参照)
     *
     * `restore_task` RPC (migration 0005) は actual sibling group の末尾へ position を移す仕様であり (req.md §26)、
     * 削除前の元の位置には戻さない (restore-task.ts のドキュメントコメント参照)。
     * undo で「元の位置に戻った」ように見せるには、restore に続けて元の parent_id/position への `move` が要る。
     * `move` の適用は oldParentId/oldPosition === newParentId/newPosition (どちらも snapshot の値) の
     * ときに no-op になる (applyOutlineOp の隙間詰め/隙間空けが互いに打ち消す) ため、
     * ローカル表示は restore 直後の snapshot 位置のまま変わらず、末尾へ飛んで見えることはない。
     * サーバー側だけ tail → 元の位置へ move_task RPC で正しく収束する。
     * restore_task は復元対象が空けた穴も詰めるため (migration 20260813000001、Issue #23)、
     * 続く move_task の後の兄弟の position はクライアント適用側と一致する
     * (supabase/tests/011_position_gaps.test.sql のケース8 と outline-ops.test.ts が両側を固定する)
     * (この 2 Op 列の組み立ては lib/invert-op.ts の `softDelete` 分岐が持つ)
     *
     * これはレジスタへ記録しない内部版であり、`.` の再発行 (repeatLastChange) と共有する
     */
    const executeSoftDeleteCursor = (): boolean => {
        if (cursorTaskId === null) {
            return false;
        }
        // 削除で行が消えるとストアの clamp (setVisibleTaskIds) がカーソルを先頭行へ寄せてしまい、
        // 続く `.` が先頭行を削除する事故になる (Issue #76)。vim の dd に合わせ、
        // 1 つ下 (最終行なら 1 つ上) の後継を削除前に決めておき、apply 成功後にそこへ移す。
        // visibleTaskIds は selector で購読しない。OutlineShell が毎レンダー新しい配列を setVisibleTaskIds へ
        // 同期するため、購読すると「同期 → 再レンダー → 同期」の無限ループになる。ここはイベントハンドラ内の
        // 一度きりの読み取りなので getState() で足りる
        const successor = findDeletionSuccessor(useOutlineStore.getState().visibleTaskIds, cursorTaskId);
        if (!runOp({ type: "softDelete", taskId: cursorTaskId }, "ゴミ箱へ移動")) {
            return false;
        }
        setCursor(successor);
        return true;
    };

    /** `dd` */
    const softDeleteCursor = (): void => {
        if (executeSoftDeleteCursor()) {
            setRepeatRegister({ kind: "softDelete" });
        }
    };

    /** dnd-kit のドロップ確定 (同一 actual parent 内)。キーボード代替の `moveCursorSibling` と同じ `reorder` Op を使う */
    const handleReorder = (taskId: string, result: SiblingReorderResult): void => {
        runOp({ type: "reorder", taskId, newPosition: result.orderedTaskIds.indexOf(taskId) }, "並べ替え");
    };

    /** dnd-kit のドロップ確定 (actual parent が変わる)。キーボード代替の indent/outdent と同じ `move` Op を使う */
    const handleReparent = (taskId: string, result: ReparentResult): void => {
        runOp({ type: "move", taskId, newParentId: result.newParentId, newPosition: result.newPosition }, "親を変更");
    };

    /**
     * 確定済み Op の列を通常パイプライン (validate → apply → enqueue) で順に実行する (undo/redo 共通処理)
     *
     * 2 Op 目以降の validate と snapshot は直前の Op を適用した後の一覧で行うため、手元でも同じ適用を重ねて進める。
     * 途中の Op がバリデーションで弾かれたらそこで打ち切り、エラー表示のうえ `false` を返す。
     * 呼び出し側はそのエントリを再度スタックへ積まない (破棄する)
     */
    const runOpsForHistory = (ops: readonly OutlineOp[]): boolean => {
        let currentTasks: readonly AppTask[] = tasks;
        for (const op of ops) {
            const validation = validateOutlineOp(op, currentTasks, dependencies);
            if (!validation.ok) {
                setStatusError(formatValidationError(validation.code));
                return false;
            }
            const tasksSnapshot = currentTasks;
            currentTasks = applyOutlineOp(currentTasks, dependencies, op, { fallbackUserId: userId });
            applyOp(op);
            opQueue.enqueue(op, [...tasksSnapshot]);
        }
        clearStatusError();
        return true;
    };

    /** `u`。undo スタックの末尾を実行する (docs/frontend-design.md §5.2) */
    const undo = (): void => {
        const popped = popUndoEntry(undoHistory);
        if (popped === null) {
            return;
        }
        const allOk = runOpsForHistory(popped.entry.undoOps);
        setUndoHistory(allOk ? pushToRedo(popped.rest, popped.entry) : popped.rest);
    };

    /** `U`。redo スタックの末尾を実行する (docs/frontend-design.md §5.2) */
    const redo = (): void => {
        const popped = popRedoEntry(undoHistory);
        if (popped === null) {
            return;
        }
        const allOk = runOpsForHistory(popped.entry.redoOps);
        setUndoHistory(allOk ? pushToUndo(popped.rest, popped.entry) : popped.rest);
    };

    /**
     * `.`。レジスタの記述子を現在のカーソル行へ再発行する (Issue #74)。レジスタが空なら何もしない
     *
     * 渡すのはレジスタへ記録しない内部版 (execute 系) のハンドラ群であり、`.` 自身はレジスタを書き換えない
     * (連打で同じ変更を繰り返せる)。再発行は通常パイプライン (runOp) を素通しするため、
     * バリデーションで弾かれればステータス行へエラーが出て、成功すれば undo 履歴へ 1 エントリ積まれる
     */
    const repeatLastChange = (): void => {
        if (repeatRegister === null) {
            return;
        }
        dispatchRepeatCommand(repeatRegister, {
            completeCursor: executeCompleteCursor,
            softDeleteCursor: executeSoftDeleteCursor,
            moveCursorSibling: executeMoveCursorSibling,
            indentCursor: executeIndentCursor,
            outdentCursor: executeOutdentCursor,
        });
    };

    return {
        statusMessage,
        statusError,
        pendingCount: opQueue.pendingCount,
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
        repeatLastChange,
    };
};
