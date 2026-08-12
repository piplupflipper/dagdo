import { type ChangeEvent, type JSX, type KeyboardEvent, type MouseEvent, useRef, useState } from "react";
import { type InlineTitleCaret, resolveCaretRange } from "@/features/outline/lib/inline-title-edit";

/** 空文字 (トリム後) のまま確定しようとしたときの表示文言 */
const EMPTY_TITLE_MESSAGE = "タイトルは空にできません";

export type InlineTitleEditorProps = {
    /** 編集開始時のタイトル */
    initialTitle: string;
    /** 編集開始時のキャレット位置 */
    caret: InlineTitleCaret;
    /** `Enter` または blur による確定。トリム済みで空でないタイトルが渡る */
    onCommit: (title: string) => void;
    /** `Esc` による取り消し。空文字のまま blur した場合もこちらを呼ぶ (空文字は保存できないため) */
    onCancel: () => void;
    /**
     * 行 (`role="option"` の要素) へフォーカスを戻す
     *
     * `Enter` / `Esc` で編集を終えたときだけ呼ぶ。input が unmount された後ではフォーカスが body へ落ち、
     * カーソル行の見た目とフォーカス位置がずれるため、編集状態を畳む前に呼ぶ。
     * blur 由来の終了では既に別の要素へフォーカスが移っており、呼ぶとそれを奪ってしまうため呼ばない
     */
    focusRow: () => void;
};

/**
 * アウトライン 1 行のタイトルを行内編集する input (docs/frontend-design.md §6.1)
 *
 * 編集中かどうかを持つのは `OutlineShell` のローカル state だけで、このコンポーネントは
 * 下書き文字列と空文字エラーのみを持つ。確定は `Enter` / blur、取り消しは `Esc` とし、
 * `Enter` での確定は NORMAL に戻すだけで DetailPane へは連鎖させない (改めて `Enter` を押す仕様)
 */
export const InlineTitleEditor = ({ initialTitle, caret, onCommit, onCancel, focusRow }: InlineTitleEditorProps): JSX.Element => {
    const [draft, setDraft] = useState(initialTitle);
    const [error, setError] = useState<string | null>(null);
    /** 確定・取り消し済みかどうか。focusRow が起こす blur を確定として二重に処理しないためのガード */
    const isFinishedRef = useRef(false);
    /** フォーカスとキャレット位置を適用済みかどうか。再レンダーでの ref 再適用によるキャレット巻き戻しを防ぐ */
    const isCaretAppliedRef = useRef(false);

    /**
     * input へフォーカスし、キャレットを `caret` の位置へ置く
     *
     * useEffect ではなく callback ref で行う。編集状態が立ってから実際にフォーカスが移るまでの隙間に
     * `j` / `k` がグローバル keymap へ滑り込み、編集中にカーソルだけが動くのを防ぐため
     */
    const attachInput = (element: HTMLInputElement | null): void => {
        if (element === null || isCaretAppliedRef.current) {
            return;
        }
        isCaretAppliedRef.current = true;
        element.focus();
        const { start, end } = resolveCaretRange({ caret, valueLength: element.value.length });
        element.setSelectionRange(start, end);
    };

    /** 編集を畳む。shouldFocusRow が true のときは、畳む前に行へフォーカスを戻す */
    const finish = (finishEdit: () => void, shouldFocusRow: boolean): void => {
        if (isFinishedRef.current) {
            return;
        }
        isFinishedRef.current = true;
        if (shouldFocusRow) {
            focusRow();
        }
        finishEdit();
    };

    /**
     * トリム後のタイトルで確定する
     *
     * 空文字は DB 制約 tasks_title_not_blank に反し、その CHECK 違反は TaskErrorCode へ変換できず
     * mapDbErrorOrThrow が re-throw するため、送信前にここで弾いて編集を継続する (detail-pane.tsx と同じ理由)
     */
    const commit = (shouldFocusRow: boolean): void => {
        const trimmedTitle = draft.trim();
        if (trimmedTitle === "") {
            setError(EMPTY_TITLE_MESSAGE);
            return;
        }
        finish(() => onCommit(trimmedTitle), shouldFocusRow);
    };

    const cancel = (shouldFocusRow: boolean): void => {
        finish(onCancel, shouldFocusRow);
    };

    const handleChange = (event: ChangeEvent<HTMLInputElement>): void => {
        setDraft(event.target.value);
        setError(null);
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
        // 行の onKeyDown が Enter / Space をカーソル選択として拾い preventDefault してしまうため、行まで伝えない。
        // document の keydown ハンドラ (useOutlineKeymap) は input にフォーカスがある時点で isEditableTarget により素通しする
        event.stopPropagation();
        // IME 変換確定の Enter / Esc を編集の確定・取り消しと取り違えない (detail-pane.tsx / search-overlay.tsx と同じ扱い)
        if (event.nativeEvent.isComposing) {
            return;
        }
        if (event.key === "Enter") {
            event.preventDefault();
            commit(true);
            return;
        }
        if (event.key === "Escape") {
            event.preventDefault();
            cancel(true);
        }
    };

    /** blur は確定として扱う。ただし空文字のままでは保存できないため取り消しにして元のタイトルへ戻す */
    const handleBlur = (): void => {
        if (draft.trim() === "") {
            cancel(false);
            return;
        }
        commit(false);
    };

    /** input 内のクリックでカーソル選択 (行の onClick) を走らせない。キャレット移動だけに使う */
    const handleClick = (event: MouseEvent<HTMLInputElement>): void => {
        event.stopPropagation();
    };

    // 非編集時の表示 span (outline-row.tsx) は md 以上で `md:flex-none`（内容幅に留める）だが、
    // 編集中の input は行の使える横幅いっぱいに広げるためここでは付けない。
    // バッジ (期日チップ等、outline-row.tsx の `ml-auto` 要素) は flex-shrink-0 のままなので、
    // input が伸びても右端の既存要素を押し出して隠すことはない
    return (
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
            <input
                ref={attachInput}
                type="text"
                value={draft}
                onChange={handleChange}
                onKeyDown={handleKeyDown}
                onBlur={handleBlur}
                onClick={handleClick}
                aria-label="タイトルを行内編集"
                className="min-w-0 w-full flex-1 rounded-base border border-accent bg-bg px-1.5 py-0.5 text-[13px] text-text outline-none"
            />
            {error !== null ? (
                <span role="alert" className="flex-shrink-0 text-[11px] text-overdue">
                    {error}
                </span>
            ) : null}
        </span>
    );
};
