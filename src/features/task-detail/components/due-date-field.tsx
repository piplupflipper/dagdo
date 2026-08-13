import { type JSX, type KeyboardEvent, useState } from "react";
import { formatDate } from "@/features/task-detail/lib/format-date";
import type { AppTask } from "@/types/task";

type DueDateFieldProps = {
    task: AppTask;
    /** 期限切れ表示にするかどうか (完了済みは期限切れ扱いしないため、判定は親が行う) */
    overdue: boolean;
    /** 期日編集の確定。`DetailPane` の `onCommitDueDate` をそのまま受け取る */
    onCommitDueDate: (taskId: string, dueDate: string | null) => void;
    /** `Esc` で確定したあと、一覧へフォーカスを戻す共通ヘルパー */
    onEscapeToOutline: () => void;
};

/**
 * 詳細ペインの期日欄 (表示と input[type=date] の出し分け)
 *
 * 下書き (`dueDateDraft`) と編集中フラグはこのコンポーネントが持つ。下書きは input[type=date] の値そのもの
 * (YYYY-MM-DD) であり、空文字は「期日なし」を表す。タスクを切り替えたときの初期化は、
 * 親が `key` を張り替えて作り直すことで行う (detail-pane.tsx 参照)
 */
export const DueDateField = ({ task, overdue, onCommitDueDate, onEscapeToOutline }: DueDateFieldProps): JSX.Element => {
    const [dueDateDraft, setDueDateDraft] = useState(task.due_date ?? "");
    const [isEditingDueDate, setIsEditingDueDate] = useState(false);

    const handleStartEditDueDate = (): void => {
        setDueDateDraft(task.due_date ?? "");
        setIsEditingDueDate(true);
    };

    const handleCancelEditDueDate = (): void => {
        setDueDateDraft(task.due_date ?? "");
        setIsEditingDueDate(false);
    };

    /**
     * 期日を確定する
     *
     * input[type=date] はブラウザのローカルタイムゾーンでの YYYY-MM-DD を返すが、
     * due_date は日付のみの概念 (req.md §6) なのでタイムゾーン変換せずそのまま渡す。
     * 空文字 (クリアボタン押下、または入力欄を空にした状態) は null として期日を解除する。
     * 変更が無いかどうかの判定は `onCommitDueDate`（`commitDueDateEdit`）側が担うため、常に呼ぶ
     */
    const handleSaveDueDate = (): void => {
        setIsEditingDueDate(false);
        onCommitDueDate(task.id, dueDateDraft === "" ? null : dueDateDraft);
    };

    /**
     * 期日編集中の `Esc`
     *
     * 全体方針「Esc = 確定して一覧へフォーカスを戻す」(docs/frontend-design.md §5) に従い確定として扱う。
     * 期日には空文字禁止のような検証が無く（空文字は「期日なし」として常に確定できる）、
     * `handleSaveDueDate` は必ず編集領域を畳むため、タイトルのような戻り値ガードは不要で
     * 常に `onEscapeToOutline` を呼んでよい。
     * input[type=date] は IME を伴わないが、他の編集領域と同じ扱いに揃える
     */
    const handleDueDateKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
        if (event.nativeEvent.isComposing) {
            return;
        }
        if (event.key === "Escape") {
            event.preventDefault();
            handleSaveDueDate();
            onEscapeToOutline();
        }
    };

    return (
        <div className="mb-1.5">
            <div className="flex items-center justify-between gap-2">
                {isEditingDueDate ? (
                    <span className="text-xs text-text-dim">期日</span>
                ) : (
                    <span className={`text-xs ${overdue ? "font-semibold text-overdue" : "text-text-dim"}`}>
                        期日: {task.due_date !== null ? formatDate(task.due_date) : "未設定"}
                        {overdue ? " (期限切れ)" : ""}
                    </span>
                )}
                {isEditingDueDate ? null : (
                    <button type="button" onClick={handleStartEditDueDate} className="text-xs text-accent hover:underline">
                        編集
                    </button>
                )}
            </div>

            {isEditingDueDate ? (
                <div className="mt-1.5 space-y-2">
                    <div className="flex items-center gap-2">
                        <input
                            type="date"
                            value={dueDateDraft}
                            onChange={(event) => {
                                setDueDateDraft(event.target.value);
                            }}
                            onKeyDown={handleDueDateKeyDown}
                            aria-label="期日を編集"
                            className="rounded-md border border-border bg-bg px-2 py-1 text-xs text-text outline-none focus:border-accent"
                        />
                        <button
                            type="button"
                            onClick={() => {
                                setDueDateDraft("");
                            }}
                            disabled={dueDateDraft === ""}
                            className="rounded-md border border-border px-2 py-1 text-xs text-text-dim disabled:opacity-60"
                        >
                            クリア
                        </button>
                    </div>
                    <div className="flex justify-end gap-2">
                        <button type="button" onClick={handleCancelEditDueDate} className="rounded-md border border-border px-3 py-1 text-xs text-text-dim">
                            キャンセル
                        </button>
                        <button type="button" onClick={handleSaveDueDate} className="rounded-md bg-accent px-3 py-1 text-xs font-semibold text-accent-ink">
                            保存
                        </button>
                    </div>
                </div>
            ) : null}
        </div>
    );
};
