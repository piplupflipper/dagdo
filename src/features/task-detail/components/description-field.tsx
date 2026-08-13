import { type JSX, type KeyboardEvent, type Ref, useImperativeHandle, useRef, useState } from "react";
import type { AppTask } from "@/types/task";
import { MarkdownEditor } from "./markdown-editor";
import { MarkdownPreview } from "./markdown-preview";

/** `DescriptionField` が親 (`DetailPane`) へ公開する命令的 API。`DetailPaneHandle.focusEditor` の実体 */
export type DescriptionFieldHandle = {
    /** 説明の編集を開始し、MarkdownEditor の textarea へフォーカスを移す */
    focusEditor: () => void;
};

type DescriptionFieldProps = {
    task: AppTask;
    /** 説明編集の確定。`DetailPane` の `onCommitDescription` をそのまま受け取る */
    onCommitDescription: (taskId: string, description: string) => void;
    /** `Esc` で確定したあと、一覧へフォーカスを戻す共通ヘルパー */
    onEscapeToOutline: () => void;
    ref?: Ref<DescriptionFieldHandle>;
};

/**
 * 詳細ペインの説明欄 (MarkdownPreview と MarkdownEditor の出し分け)
 *
 * 下書き (`draft`) と編集中フラグはこのコンポーネントが持つ。タスクを切り替えたときの初期化は、
 * 親が `key` を張り替えて作り直すことで行う (detail-pane.tsx 参照)。
 * `Enter` で一覧から編集領域へフォーカスを移す導線 (docs/frontend-design.md §6.1) のため、
 * `focusEditor` を ref 経由で公開する
 */
export const DescriptionField = ({ task, onCommitDescription, onEscapeToOutline, ref }: DescriptionFieldProps): JSX.Element => {
    const [draft, setDraft] = useState(task.description);
    const [isEditing, setIsEditing] = useState(false);
    /** 編集中に表示されている textarea。非編集中は null */
    const editorRef = useRef<HTMLTextAreaElement | null>(null);
    /** 編集開始と同時にフォーカスしたいという要求。textarea のマウント時 (attachEditor) に消費する */
    const pendingEditorFocusRef = useRef(false);

    // ref は毎レンダー張り替え、focusEditor が常に最新の task を参照できるようにする
    useImperativeHandle(ref, () => ({
        focusEditor: (): void => {
            const editor = editorRef.current;
            if (editor !== null) {
                // すでに編集中なら textarea へフォーカスを移すだけでよい
                editor.focus();
                return;
            }
            // textarea は編集開始後のレンダーでマウントされるため、フォーカスは attachEditor に委ねる
            pendingEditorFocusRef.current = true;
            setDraft(task.description);
            setIsEditing(true);
        },
    }));

    /** MarkdownEditor の textarea を保持し、保留中のフォーカス要求があればマウント時に消費する */
    const attachEditor = (element: HTMLTextAreaElement | null): void => {
        editorRef.current = element;
        if (element === null || !pendingEditorFocusRef.current) {
            return;
        }
        pendingEditorFocusRef.current = false;
        element.focus();
    };

    const handleStartEdit = (): void => {
        setDraft(task.description);
        setIsEditing(true);
    };

    const handleCancelEdit = (): void => {
        setDraft(task.description);
        setIsEditing(false);
    };

    /**
     * 説明編集の確定。draft をそのまま `onCommitDescription` へ渡し、応答を待たずに編集領域を畳む
     *
     * 変更が無いかどうかの判定は `onCommitDescription`（`commitDescriptionEdit`）側が担うため、
     * ここでは常に呼ぶ (TitleField の handleSaveTitle と同じ分担)
     */
    const handleCommitDescription = (): void => {
        setIsEditing(false);
        onCommitDescription(task.id, draft);
    };

    /**
     * 説明編集中のキー操作 (docs/frontend-design.md §6.5)
     *
     * `Ctrl+Enter` (Mac の `Cmd+Enter` = `metaKey` も同様) と `Esc` はいずれも確定として扱う。
     * `Esc` は確定後さらに `onEscapeToOutline` で一覧へフォーカスを戻すが、
     * `Ctrl+Enter` はテキストエリア内での確定操作のため戻さない。
     * IME 変換確定の Enter/Esc は取り違えない (TitleField の handleTitleKeyDown と同じ扱い)
     */
    const handleDescriptionKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
        if (event.nativeEvent.isComposing) {
            return;
        }
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            handleCommitDescription();
            return;
        }
        if (event.key === "Escape") {
            event.preventDefault();
            handleCommitDescription();
            onEscapeToOutline();
        }
    };

    return (
        <div className="mt-3">
            <div className="mb-1.5 flex items-center justify-between">
                <span className="text-xs text-text-dim">説明</span>
                {isEditing ? null : (
                    <button type="button" onClick={handleStartEdit} className="text-xs text-accent hover:underline">
                        編集
                    </button>
                )}
            </div>

            {isEditing ? (
                <div className="space-y-2">
                    <MarkdownEditor ref={attachEditor} value={draft} onChange={setDraft} onKeyDown={handleDescriptionKeyDown} />
                    <div className="flex justify-end gap-2">
                        <button type="button" onClick={handleCancelEdit} className="rounded-md border border-border px-3 py-1 text-xs text-text-dim">
                            キャンセル
                        </button>
                        <button type="button" onClick={handleCommitDescription} className="rounded-md bg-accent px-3 py-1 text-xs font-semibold text-accent-ink">
                            保存
                        </button>
                    </div>
                </div>
            ) : (
                <div className="rounded-md border border-border bg-bg-alt px-3 py-2">
                    <MarkdownPreview source={task.description} />
                </div>
            )}
        </div>
    );
};
