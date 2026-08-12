import type { OutlineOp } from "@/features/outline/lib/outline-ops";

/**
 * undo / redo の履歴管理 (docs/frontend-design.md §5.2、Phase 2)
 *
 * ここに置くのは純粋なデータ構造の操作のみで、Op の実行 (楽観適用 + Server Action) や
 * 逆操作の材料集めは outline-shell.tsx の責務とする (dispatch 時点の optimisticTasks が要るため)。
 *
 * 対象はアウトライン操作 (作成・完了・タイトル変更・移動・並べ替え・ゴミ箱への移動) に加え、
 * DetailPane の説明・期日の編集 (改修 3、`updateDescription` / `updateDueDate` Op) を含む。
 * DetailPane の依存関係の編集、ゴミ箱画面からの復元・完全削除は依然として履歴対象外 (将来拡張)。
 * 依存関係は Op リデューサそのものの対象外であり、undo 履歴だけの制約ではない
 */

/** 履歴 1 件。1 回のユーザー操作 (VISUAL の一括完了は複数タスクをまとめて 1 件) に対応する */
export type UndoEntry = {
    /** ステータスライン等での表示用ラベル (例: "タイトル変更", "選択範囲の完了 (3件)") */
    label: string;
    /** `u` (undo) で実行する Op の列。逆操作の材料は記録時点の optimisticTasks から閉じ込めてある */
    undoOps: OutlineOp[];
    /** `U` (redo) で実行する Op の列。元の操作そのもの */
    redoOps: OutlineOp[];
};

export type UndoHistoryState = {
    /** 末尾が最新。`u` は末尾から pop する */
    undoStack: readonly UndoEntry[];
    /** 末尾が最新に undo したもの。`U` は末尾から pop する */
    redoStack: readonly UndoEntry[];
};

export const EMPTY_UNDO_HISTORY: UndoHistoryState = { undoStack: [], redoStack: [] };

/** 履歴の上限件数。古いものから捨てる */
const HISTORY_LIMIT = 100;

const pushCapped = (stack: readonly UndoEntry[], entry: UndoEntry): readonly UndoEntry[] => {
    const next = [...stack, entry];
    return next.length > HISTORY_LIMIT ? next.slice(next.length - HISTORY_LIMIT) : next;
};

/**
 * Server Action が成功で確定した新しい操作を履歴へ積む
 *
 * vim に倣い、新しい操作が確定したら redo スタックは破棄する (undo で戻った先から新しい分岐が始まるため)
 */
export const recordEntry = (state: UndoHistoryState, entry: UndoEntry): UndoHistoryState => ({
    undoStack: pushCapped(state.undoStack, entry),
    redoStack: [],
});

/** `u`。undo スタックの末尾を取り出す。空なら null (呼び出し側は何もしない) */
export const popUndoEntry = (state: UndoHistoryState): { entry: UndoEntry; rest: UndoHistoryState } | null => {
    const entry = state.undoStack[state.undoStack.length - 1];
    if (entry === undefined) {
        return null;
    }
    return { entry, rest: { undoStack: state.undoStack.slice(0, -1), redoStack: state.redoStack } };
};

/** `U`。redo スタックの末尾を取り出す。空なら null (呼び出し側は何もしない) */
export const popRedoEntry = (state: UndoHistoryState): { entry: UndoEntry; rest: UndoHistoryState } | null => {
    const entry = state.redoStack[state.redoStack.length - 1];
    if (entry === undefined) {
        return null;
    }
    return { entry, rest: { undoStack: state.undoStack, redoStack: state.redoStack.slice(0, -1) } };
};

/** `u` の undoOps が (部分成功も含め) 実行された後、redo スタックへ積み直す */
export const pushToRedo = (state: UndoHistoryState, entry: UndoEntry): UndoHistoryState => ({
    undoStack: state.undoStack,
    redoStack: pushCapped(state.redoStack, entry),
});

/** `U` の redoOps が (部分成功も含め) 実行された後、undo スタックへ積み直す */
export const pushToUndo = (state: UndoHistoryState, entry: UndoEntry): UndoHistoryState => ({
    undoStack: pushCapped(state.undoStack, entry),
    redoStack: state.redoStack,
});
