/**
 * 行内タイトル編集 (`i` / `I` / `a` / `A`) の状態表現 (docs/frontend-design.md §6.1)
 *
 * 編集中であることはモード (OutlineMode) にもストアにも持たせず、`OutlineShell` のローカル state
 * (`InlineTitleEdit | null`) 1 個だけで表す。グローバル keymap の抑止は既存の `isEditableTarget`
 * (use-outline-keymap.ts) が DOM のフォーカス先で行うため、モードを増やさなくても
 * 「編集中なのに j / k でカーソルが動く」という同期のずれは構造的に起きない
 */

/** 編集開始時のキャレット位置。`i` は先頭、`A` は末尾 (vim に倣う) */
export type InlineTitleCaret = "start" | "end";

/**
 * 行内編集中のタスクとキャレット位置、下書き文字列。編集していない状態は null で表す
 *
 * `draft` は以前 `InlineTitleEditor` 自身の `useState` が持っていたが、`OutlineRow` は
 * `key={task.id}` で行を再マウントするため、行の作り直しが起きた瞬間にコンポーネントが破棄され、
 * 入力中の下書きが失われてしまう (バグ修正)。
 * ここへ状態を引き上げることで、行の再マウントをまたいで下書きが生き残るようにする
 */
export type InlineTitleEdit = {
    taskId: string;
    caret: InlineTitleCaret;
    draft: string;
};

/** `input.setSelectionRange` へ渡す選択範囲 */
type CaretRange = {
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
