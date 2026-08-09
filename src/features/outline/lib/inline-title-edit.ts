/**
 * 行内タイトル編集 (`i` / `A`) の状態表現 (docs/frontend-design.md §6.1)
 *
 * 編集中であることはモード (OutlineMode) にもストアにも持たせず、`OutlineShell` のローカル state
 * (`InlineTitleEdit | null`) 1 個だけで表す。グローバル keymap の抑止は既存の `isEditableTarget`
 * (use-outline-keymap.ts) が DOM のフォーカス先で行うため、モードを増やさなくても
 * 「編集中なのに j / k でカーソルが動く」という同期のずれは構造的に起きない
 */

/** 編集開始時のキャレット位置。`i` は先頭、`A` は末尾 (vim に倣う) */
export type InlineTitleCaret = "start" | "end";

/** 行内編集中のタスクとキャレット位置。編集していない状態は null で表す */
export type InlineTitleEdit = {
    taskId: string;
    caret: InlineTitleCaret;
};

/** `input.setSelectionRange` へ渡す選択範囲 */
export type CaretRange = {
    start: number;
    end: number;
};

/**
 * キャレット位置の指定を input の選択範囲へ変換する
 *
 * 将来 `cc` (タイトル全体を選択して置き換える) を足す場合も、`InlineTitleCaret` の値と
 * この関数の分岐を増やすだけで済ませる。編集状態の形 (1 個の値) は変えない
 */
export const resolveCaretRange = ({ caret, valueLength }: { caret: InlineTitleCaret; valueLength: number }): CaretRange =>
    caret === "start" ? { start: 0, end: 0 } : { start: valueLength, end: valueLength };
