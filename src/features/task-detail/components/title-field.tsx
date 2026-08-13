import { type ChangeEvent, type JSX, type KeyboardEvent, type MouseEvent, useEffect, useRef, useState } from "react";
import type { AppTask } from "@/types/task";

type TitleFieldProps = {
    task: AppTask;
    /** 完了済みのタイトルは打ち消し線で示す (状態の導出は親が行う) */
    isDone: boolean;
    /** タイトル編集の確定。`DetailPane` の `onCommitTitle` をそのまま受け取る */
    onCommitTitle: (taskId: string, title: string) => void;
    /** `Esc` で確定できたあと、一覧へフォーカスを戻す共通ヘルパー */
    onEscapeToOutline: () => void;
};

/**
 * 詳細ペインのタイトル欄 (見出し表示と入力欄の出し分け)
 *
 * 下書き (`titleDraft`)・編集中フラグ・インラインエラーはこのコンポーネントが持つ。
 * タスクを切り替えたときの初期化は、親が `key` を張り替えて作り直すことで行う (detail-pane.tsx 参照)。
 *
 * 説明・期日の 2 欄と見た目は似ているが、タイトルだけは空文字を弾く検証を持ち、
 * 確定できたかどうかを `handleSaveTitle` の戻り値で表す。`Esc` ハンドラはこの戻り値を見て
 * 「確定できたときだけ一覧へフォーカスを戻す」を決めるため、3 欄を共通の編集フックへ寄せていない
 */
export const TitleField = ({ task, isDone, onCommitTitle, onEscapeToOutline }: TitleFieldProps): JSX.Element => {
    const [titleDraft, setTitleDraft] = useState(task.title);
    const [isEditingTitle, setIsEditingTitle] = useState(false);
    const [titleError, setTitleError] = useState<string | null>(null);
    const titleInputRef = useRef<HTMLInputElement>(null);

    // タイトル編集を開始した直後に入力できるようフォーカスし、既存タイトルを選択状態にする
    // (「新規タスク」のまま放置されたタスクをそのまま上書きできるようにする)
    useEffect(() => {
        const input = titleInputRef.current;
        if (isEditingTitle && input !== null) {
            input.focus();
            input.select();
        }
    }, [isEditingTitle]);

    const handleStartTitleEdit = (): void => {
        setTitleDraft(task.title);
        setTitleError(null);
        setIsEditingTitle(true);
    };

    const handleCancelTitleEdit = (): void => {
        setTitleDraft(task.title);
        setTitleError(null);
        setIsEditingTitle(false);
    };

    const handleTitleChange = (event: ChangeEvent<HTMLInputElement>): void => {
        setTitleDraft(event.target.value);
    };

    /**
     * トリム後のタイトルで確定する
     *
     * 空文字は DB 制約 tasks_title_not_blank に反し、その CHECK 違反は TaskErrorCode へ変換できず
     * mapDbErrorOrThrow が re-throw するため、送信前にここで弾いてインラインエラーにする (クライアント側検証)。
     * 変更が無いかどうかの判定は `onCommitTitle`（`commitInlineTitleEdit`）側が担うため、ここでは常に呼ぶ。
     * 保存の成否を待たずに即座に編集領域を畳む (失敗時は `OutlineShell` の `StatusLine` へ表示される)。
     * 戻り値は確定できたかどうか (空文字で弾かれた場合は false)。`Esc` ハンドラが
     * 「確定できたときだけ一覧へフォーカスを戻す」を判定するために使う (inline-title-editor.tsx と同じ規則)
     */
    const handleSaveTitle = (): boolean => {
        const trimmedTitle = titleDraft.trim();
        if (trimmedTitle === "") {
            setTitleError("タイトルは空にできません");
            return false;
        }
        setTitleError(null);
        setIsEditingTitle(false);
        onCommitTitle(task.id, trimmedTitle);
        return true;
    };

    /**
     * タイトル編集中のキー操作
     *
     * `Esc` は全体方針「Esc = 確定して一覧へフォーカスを戻す」(docs/frontend-design.md §5) に従い確定として扱う。
     * 空文字のまま `Esc` を押した場合は確定できないため、`handleSaveTitle` がインラインエラーを出して
     * 編集領域に留まり、`onEscapeToOutline` も呼ばない (inline-title-editor.tsx の空 Esc と同じ扱い)
     */
    const handleTitleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
        // IME 変換確定の Enter/Esc を編集確定と取り違えない (SearchOverlay と同じ扱い)
        if (event.nativeEvent.isComposing) {
            return;
        }
        if (event.key === "Enter") {
            event.preventDefault();
            handleSaveTitle();
            return;
        }
        if (event.key === "Escape") {
            event.preventDefault();
            if (handleSaveTitle()) {
                onEscapeToOutline();
            }
        }
    };

    const handleTitleBlur = (): void => {
        handleSaveTitle();
    };

    /**
     * タイトル編集のボタン押下で input が blur するのを防ぐ
     *
     * blur 確定を採用しているため、これがないとキャンセル押下時に blur の保存が先に走ってしまう。
     * mousedown の既定動作 (フォーカス移動) だけを止めるので click ハンドラは通常どおり発火する
     */
    const handleTitleButtonMouseDown = (event: MouseEvent<HTMLButtonElement>): void => {
        event.preventDefault();
    };

    if (!isEditingTitle) {
        return (
            <div className="mb-2 flex items-start justify-between gap-2">
                <h3 className={`text-base font-semibold ${isDone ? "text-text-dim line-through" : "text-text"}`}>{task.title}</h3>
                <button type="button" onClick={handleStartTitleEdit} className="flex-shrink-0 text-xs text-accent hover:underline">
                    編集
                </button>
            </div>
        );
    }

    return (
        <div className="mb-2 space-y-2">
            <input
                ref={titleInputRef}
                type="text"
                value={titleDraft}
                onChange={handleTitleChange}
                onKeyDown={handleTitleKeyDown}
                onBlur={handleTitleBlur}
                aria-label="タイトルを編集"
                placeholder="タスクのタイトルを入力…"
                className="w-full rounded-md border border-border bg-bg px-3 py-2 text-base font-semibold text-text outline-none focus:border-accent"
            />
            {titleError !== null ? <p className="text-xs text-overdue">{titleError}</p> : null}
            <div className="flex justify-end gap-2">
                <button type="button" onMouseDown={handleTitleButtonMouseDown} onClick={handleCancelTitleEdit} className="rounded-md border border-border px-3 py-1 text-xs text-text-dim">
                    キャンセル
                </button>
                <button type="button" onMouseDown={handleTitleButtonMouseDown} onClick={handleSaveTitle} className="rounded-md bg-accent px-3 py-1 text-xs font-semibold text-accent-ink">
                    保存
                </button>
            </div>
        </div>
    );
};
