"use client";

import { type ChangeEvent, type JSX, type KeyboardEvent, type MouseEvent, type Ref, useEffect, useImperativeHandle, useRef, useState } from "react";
import { addDependency } from "@/features/task/actions/add-dependency";
import { removeDependency } from "@/features/task/actions/remove-dependency";
import { updateTask } from "@/features/task/actions/update-task";
import type { TaskErrorCode } from "@/features/task/lib/action-result";
import type { AppTask, TaskDependency } from "@/types/task";
import { BlockedReasonBar } from "./blocked-reason-bar";
import { MarkdownEditor } from "./markdown-editor";
import { MarkdownPreview } from "./markdown-preview";

/** DetailPane が親へ公開する命令的 API (docs/frontend-design.md §6.1 の `Enter` = 編集領域へフォーカスを移す、を実現するためのもの) */
export type DetailPaneHandle = {
    /** 説明の編集を開始し、MarkdownEditor の textarea へフォーカスを移す。タスク未選択時は何もしない */
    focusEditor: () => void;
};

/** DetailPane の props (OutlineShell が参照する公開契約。task / allTasks / dependencies のシグネチャ変更禁止) */
type DetailPaneProps = {
    task: AppTask | null;
    allTasks: AppTask[];
    dependencies: TaskDependency[];
    /** OutlineShell が focusEditor を呼ぶための ref (React 19 では ref を通常の prop として受け取れるため forwardRef は使わない) */
    ref?: Ref<DetailPaneHandle>;
};

type TaskStatus = "done" | "blocked" | "ready";

const STATUS_LABEL: Record<TaskStatus, string> = {
    done: "完了",
    blocked: "Blocked",
    ready: "Ready",
};

const STATUS_BADGE_CLASS: Record<TaskStatus, string> = {
    done: "bg-done/20 text-text-dim",
    blocked: "bg-blocked/10 text-blocked",
    ready: "bg-accent/10 text-accent",
};

/** completed_at / is_blocked から表示用の状態を導出する */
const resolveStatus = ({ completedAt, isBlocked }: { completedAt: string | null; isBlocked: boolean }): TaskStatus => {
    if (completedAt !== null) {
        return "done";
    }
    return isBlocked ? "blocked" : "ready";
};

const formatDate = (iso: string): string => new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));

const formatDateTime = (iso: string): string =>
    new Intl.DateTimeFormat("ja-JP", {
        timeZone: "Asia/Tokyo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    }).format(new Date(iso));

/**
 * 依存の追加・削除で起こり得るエラーコードに対応する UI 表示用の日本語文言
 *
 * ActionResult の message は英語のログ用文言であり (action-result.ts)、UI 表示用の日本語は呼び出し側が code から組み立てる
 */
const DEPENDENCY_ERROR_MESSAGE: Partial<Record<TaskErrorCode, string>> = {
    TASK_NOT_FOUND: "対象のタスクが見つかりません",
    TASK_DEPENDENCY_CYCLE: "循環する依存は追加できません",
    DEPENDENCY_ALREADY_EXISTS: "その依存はすでに追加されています",
};

/** 依存操作の失敗コードを表示用の日本語文言へ変換する (対応表にないコードはコードを添えて示す) */
const formatDependencyError = (code: TaskErrorCode): string => DEPENDENCY_ERROR_MESSAGE[code] ?? `依存関係の更新に失敗しました (${code})`;

/** due_date (YYYY-MM-DD) が Asia/Tokyo の「今日」より前かどうか */
const isOverdue = (dueDate: string): boolean => {
    const todayJst = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(new Date());
    return dueDate < todayJst;
};

/**
 * 右ペイン上部の詳細パネル (docs/frontend-design.md §7.1)
 *
 * タイトル・状態・期日・完了日時を表示し、blocked の場合は BlockedReasonBar を表示する
 * title は見出し / 入力欄 (input) を、description はプレビュー (MarkdownPreview) / 編集 (MarkdownEditor) を切り替え、
 * 期日は表示 / 編集 (input[type=date]) を切り替え、いずれも編集確定で updateTask を呼んで保存する
 * (失敗時はインラインでエラーを表示する)
 * 依存先は一覧表示・削除 (removeDependency) に加え、候補セレクトからの追加 (addDependency) も行う
 */
export const DetailPane = ({ task, allTasks, dependencies, ref }: DetailPaneProps): JSX.Element => {
    // タスク切替時にのみ編集状態をリセットする (レンダー中の state 調整。React 公式の推奨パターンであり
    // useEffect による同期を避けることで useOutlineKeymap 側と同様に「必要な処理だけを行う」構成にする)
    const [lastTaskId, setLastTaskId] = useState<string | null>(task?.id ?? null);
    const [draft, setDraft] = useState(task?.description ?? "");
    const [isEditing, setIsEditing] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [titleDraft, setTitleDraft] = useState(task?.title ?? "");
    const [isEditingTitle, setIsEditingTitle] = useState(false);
    const [isSavingTitle, setIsSavingTitle] = useState(false);
    const [titleError, setTitleError] = useState<string | null>(null);
    // 期日編集の draft は input[type=date] の値そのもの (YYYY-MM-DD)。空文字は「期日なし」を表す
    const [dueDateDraft, setDueDateDraft] = useState(task?.due_date ?? "");
    const [isEditingDueDate, setIsEditingDueDate] = useState(false);
    const [isSavingDueDate, setIsSavingDueDate] = useState(false);
    const [dueDateError, setDueDateError] = useState<string | null>(null);
    const [dependencyError, setDependencyError] = useState<string | null>(null);
    const [removingDependencyId, setRemovingDependencyId] = useState<string | null>(null);
    const [selectedDependsOnTaskId, setSelectedDependsOnTaskId] = useState("");
    const [isAddingDependency, setIsAddingDependency] = useState(false);
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

    /** 編集中に表示されている textarea。非編集中は null */
    const editorRef = useRef<HTMLTextAreaElement | null>(null);
    /** 編集開始と同時にフォーカスしたいという要求。textarea のマウント時 (attachEditor) に消費する */
    const pendingEditorFocusRef = useRef(false);

    // ref は毎レンダー張り替え、focusEditor が常に最新の task を参照できるようにする
    useImperativeHandle(ref, () => ({
        focusEditor: (): void => {
            if (task === null) {
                return;
            }
            const editor = editorRef.current;
            if (editor !== null) {
                // すでに編集中なら textarea へフォーカスを移すだけでよい
                editor.focus();
                return;
            }
            // textarea は編集開始後のレンダーでマウントされるため、フォーカスは attachEditor に委ねる
            pendingEditorFocusRef.current = true;
            setDraft(task.description);
            setError(null);
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

    const currentTaskId = task?.id ?? null;
    if (currentTaskId !== lastTaskId) {
        setLastTaskId(currentTaskId);
        setDraft(task?.description ?? "");
        setIsEditing(false);
        setError(null);
        setTitleDraft(task?.title ?? "");
        setIsEditingTitle(false);
        setTitleError(null);
        setDueDateDraft(task?.due_date ?? "");
        setIsEditingDueDate(false);
        setDueDateError(null);
        setDependencyError(null);
        setSelectedDependsOnTaskId("");
    }

    if (task === null) {
        return <div className="flex h-full flex-1 items-center justify-center p-4 text-sm text-text-dim">タスクを選択してください</div>;
    }

    const status = resolveStatus({ completedAt: task.completed_at, isBlocked: task.is_blocked });
    const overdue = status !== "done" && task.due_date !== null && isOverdue(task.due_date);

    /** このタスクが依存する依存先タスク一覧 (task_dependencies.task_id === task.id) */
    const dependsOnTasks = dependencies
        .filter((dependency) => dependency.task_id === task.id)
        .map((dependency) => allTasks.find((candidate) => candidate.id === dependency.depends_on_task_id))
        .filter((candidate): candidate is AppTask => candidate !== undefined);

    /**
     * 依存先として追加できるタスク
     *
     * 自分自身は依存先にできず、既存の依存先を再度追加すると DEPENDENCY_ALREADY_EXISTS になるため、どちらも候補から除外する。
     * 循環 (TASK_DEPENDENCY_CYCLE) の判定は DB Trigger に委譲し、候補の絞り込みでは行わない
     */
    const dependsOnTaskIds = new Set(dependsOnTasks.map((dependsOnTask) => dependsOnTask.id));
    const dependencyCandidates = allTasks.filter((candidate) => candidate.id !== task.id && !dependsOnTaskIds.has(candidate.id));

    const handleRemoveDependency = async (dependsOnTaskId: string): Promise<void> => {
        setRemovingDependencyId(dependsOnTaskId);
        setDependencyError(null);
        const result = await removeDependency({ taskId: task.id, dependsOnTaskId });
        setRemovingDependencyId(null);
        if (!result.ok) {
            setDependencyError(formatDependencyError(result.code));
        }
    };

    const handleAddDependency = async (): Promise<void> => {
        if (selectedDependsOnTaskId === "") {
            return;
        }
        setIsAddingDependency(true);
        setDependencyError(null);
        const result = await addDependency({ taskId: task.id, dependsOnTaskId: selectedDependsOnTaskId });
        setIsAddingDependency(false);
        if (result.ok) {
            setSelectedDependsOnTaskId("");
            return;
        }
        setDependencyError(formatDependencyError(result.code));
    };

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
     * トリム後のタイトルを保存する
     *
     * 空文字は DB 制約 tasks_title_not_blank に反し、その CHECK 違反は TaskErrorCode へ変換できず
     * mapDbErrorOrThrow が re-throw するため、送信前にここで弾いてインラインエラーにする
     */
    const handleSaveTitle = async (): Promise<void> => {
        const trimmedTitle = titleDraft.trim();
        if (trimmedTitle === "") {
            setTitleError("タイトルは空にできません");
            return;
        }
        // 変更がなければ blur 確定などで無駄な更新を投げない
        if (trimmedTitle === task.title) {
            setTitleError(null);
            setIsEditingTitle(false);
            return;
        }
        setIsSavingTitle(true);
        setTitleError(null);
        const result = await updateTask({ taskId: task.id, title: trimmedTitle });
        setIsSavingTitle(false);
        if (result.ok) {
            setIsEditingTitle(false);
            return;
        }
        setTitleError(result.message);
    };

    const handleTitleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
        // IME 変換確定の Enter/Esc を編集確定・取り消しと取り違えない (SearchOverlay と同じ扱い)
        if (event.nativeEvent.isComposing) {
            return;
        }
        if (event.key === "Enter") {
            event.preventDefault();
            void handleSaveTitle();
        } else if (event.key === "Escape") {
            event.preventDefault();
            handleCancelTitleEdit();
        }
    };

    const handleTitleBlur = (): void => {
        if (isSavingTitle) {
            return;
        }
        void handleSaveTitle();
    };

    /**
     * タイトル編集のボタン押下で input が blur するのを防ぐ
     *
     * blur 確定を採用しているため、これがないとキャンセル押下時に blur の保存が先に走ってしまう
     * mousedown の既定動作 (フォーカス移動) だけを止めるので click ハンドラは通常どおり発火する
     */
    const handleTitleButtonMouseDown = (event: MouseEvent<HTMLButtonElement>): void => {
        event.preventDefault();
    };

    const handleStartEdit = (): void => {
        setDraft(task.description);
        setError(null);
        setIsEditing(true);
    };

    const handleCancelEdit = (): void => {
        setDraft(task.description);
        setError(null);
        setIsEditing(false);
    };

    const handleSave = async (): Promise<void> => {
        setIsSaving(true);
        setError(null);
        const result = await updateTask({ taskId: task.id, description: draft });
        setIsSaving(false);
        if (result.ok) {
            setIsEditing(false);
            return;
        }
        setError(result.message);
    };

    const handleStartEditDueDate = (): void => {
        setDueDateDraft(task.due_date ?? "");
        setDueDateError(null);
        setIsEditingDueDate(true);
    };

    const handleCancelEditDueDate = (): void => {
        setDueDateDraft(task.due_date ?? "");
        setDueDateError(null);
        setIsEditingDueDate(false);
    };

    /**
     * 期日を保存する
     *
     * input[type=date] はブラウザのローカルタイムゾーンでの YYYY-MM-DD を返すが、
     * due_date は日付のみの概念 (req.md §6) なのでタイムゾーン変換せずそのまま渡す。
     * 空文字 (クリアボタン押下、または入力欄を空にした状態) は null として期日を解除する
     */
    const handleSaveDueDate = async (): Promise<void> => {
        setIsSavingDueDate(true);
        setDueDateError(null);
        const result = await updateTask({ taskId: task.id, dueDate: dueDateDraft === "" ? null : dueDateDraft });
        setIsSavingDueDate(false);
        if (result.ok) {
            setIsEditingDueDate(false);
            return;
        }
        setDueDateError(result.message);
    };

    return (
        <div className="flex-1 overflow-y-auto p-4">
            {status === "blocked" ? <BlockedReasonBar task={task} allTasks={allTasks} dependencies={dependencies} /> : null}

            {isEditingTitle ? (
                <div className="mb-2 space-y-2">
                    <input
                        ref={titleInputRef}
                        type="text"
                        value={titleDraft}
                        onChange={handleTitleChange}
                        onKeyDown={handleTitleKeyDown}
                        onBlur={handleTitleBlur}
                        disabled={isSavingTitle}
                        aria-label="タイトルを編集"
                        placeholder="タスクのタイトルを入力…"
                        className="w-full rounded-md border border-border bg-bg px-3 py-2 text-base font-semibold text-text outline-none focus:border-accent disabled:opacity-60"
                    />
                    {titleError !== null ? <p className="text-xs text-overdue">{titleError}</p> : null}
                    <div className="flex justify-end gap-2">
                        <button
                            type="button"
                            onMouseDown={handleTitleButtonMouseDown}
                            onClick={handleCancelTitleEdit}
                            disabled={isSavingTitle}
                            className="rounded-md border border-border px-3 py-1 text-xs text-text-dim disabled:opacity-60"
                        >
                            キャンセル
                        </button>
                        <button
                            type="button"
                            onMouseDown={handleTitleButtonMouseDown}
                            onClick={() => {
                                void handleSaveTitle();
                            }}
                            disabled={isSavingTitle}
                            className="rounded-md bg-accent px-3 py-1 text-xs font-semibold text-accent-ink disabled:opacity-60"
                        >
                            {isSavingTitle ? "保存中…" : "保存"}
                        </button>
                    </div>
                </div>
            ) : (
                <div className="mb-2 flex items-start justify-between gap-2">
                    <h3 className={`text-base font-semibold ${status === "done" ? "text-text-dim line-through" : "text-text"}`}>{task.title}</h3>
                    <button type="button" onClick={handleStartTitleEdit} className="flex-shrink-0 text-xs text-accent hover:underline">
                        編集
                    </button>
                </div>
            )}

            <div className="mb-1.5">
                <span className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-bold ${STATUS_BADGE_CLASS[status]}`}>{STATUS_LABEL[status]}</span>
            </div>

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
                                disabled={isSavingDueDate}
                                aria-label="期日を編集"
                                className="rounded-md border border-border bg-bg px-2 py-1 text-xs text-text outline-none focus:border-accent disabled:opacity-60"
                            />
                            <button
                                type="button"
                                onClick={() => {
                                    setDueDateDraft("");
                                }}
                                disabled={isSavingDueDate || dueDateDraft === ""}
                                className="rounded-md border border-border px-2 py-1 text-xs text-text-dim disabled:opacity-60"
                            >
                                クリア
                            </button>
                        </div>
                        {dueDateError !== null ? <p className="text-xs text-overdue">{dueDateError}</p> : null}
                        <div className="flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={handleCancelEditDueDate}
                                disabled={isSavingDueDate}
                                className="rounded-md border border-border px-3 py-1 text-xs text-text-dim disabled:opacity-60"
                            >
                                キャンセル
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    void handleSaveDueDate();
                                }}
                                disabled={isSavingDueDate}
                                className="rounded-md bg-accent px-3 py-1 text-xs font-semibold text-accent-ink disabled:opacity-60"
                            >
                                {isSavingDueDate ? "保存中…" : "保存"}
                            </button>
                        </div>
                    </div>
                ) : null}
            </div>

            {task.completed_at !== null ? <div className="mb-1.5 text-xs text-text-dim">完了日時: {formatDateTime(task.completed_at)}</div> : null}

            {/* 依存先は 0 件でも追加 UI を出す必要があるため、一覧の有無に関わらずセクション自体は常に描画する */}
            <div className="mt-3">
                <div className="mb-1.5 text-xs text-text-dim">依存先</div>
                {dependsOnTasks.length > 0 ? (
                    <ul className="flex flex-col gap-1">
                        {dependsOnTasks.map((dependsOnTask) => (
                            <li key={dependsOnTask.id} className="flex items-center justify-between gap-2 rounded-base border border-border bg-bg-alt px-2.5 py-1 text-xs">
                                <span className={`truncate ${dependsOnTask.completed_at !== null ? "text-text-dim line-through" : "text-text"}`}>{dependsOnTask.title}</span>
                                <button
                                    type="button"
                                    onClick={() => {
                                        void handleRemoveDependency(dependsOnTask.id);
                                    }}
                                    disabled={removingDependencyId === dependsOnTask.id}
                                    aria-label={`${dependsOnTask.title} への依存を削除`}
                                    className="flex-shrink-0 px-1 text-text-dim hover:text-overdue disabled:opacity-60"
                                >
                                    ×
                                </button>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="text-xs text-text-dim">依存先はありません</p>
                )}

                {dependencyCandidates.length > 0 ? (
                    <div className="mt-1.5 flex items-center gap-2">
                        <select
                            value={selectedDependsOnTaskId}
                            onChange={(event) => setSelectedDependsOnTaskId(event.target.value)}
                            disabled={isAddingDependency}
                            aria-label="追加する依存先タスク"
                            className="min-w-0 flex-1 rounded-base border border-border bg-bg px-2 py-1 text-xs text-text disabled:opacity-60"
                        >
                            <option value="">依存先タスクを選択…</option>
                            {dependencyCandidates.map((candidate) => (
                                <option key={candidate.id} value={candidate.id}>
                                    {candidate.title}
                                </option>
                            ))}
                        </select>
                        <button
                            type="button"
                            onClick={() => {
                                void handleAddDependency();
                            }}
                            disabled={isAddingDependency || selectedDependsOnTaskId === ""}
                            className="flex-shrink-0 rounded-base border border-border px-2.5 py-1 text-xs text-accent hover:bg-accent/10 disabled:opacity-60"
                        >
                            {isAddingDependency ? "追加中…" : "追加"}
                        </button>
                    </div>
                ) : (
                    <p className="mt-1.5 text-xs text-text-dim">追加できる依存先タスクがありません</p>
                )}

                {dependencyError !== null ? <p className="mt-1 text-xs text-overdue">{dependencyError}</p> : null}
            </div>

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
                        <MarkdownEditor ref={attachEditor} value={draft} onChange={setDraft} disabled={isSaving} />
                        {error !== null ? <p className="text-xs text-overdue">{error}</p> : null}
                        <div className="flex justify-end gap-2">
                            <button type="button" onClick={handleCancelEdit} disabled={isSaving} className="rounded-md border border-border px-3 py-1 text-xs text-text-dim disabled:opacity-60">
                                キャンセル
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    void handleSave();
                                }}
                                disabled={isSaving}
                                className="rounded-md bg-accent px-3 py-1 text-xs font-semibold text-accent-ink disabled:opacity-60"
                            >
                                {isSaving ? "保存中…" : "保存"}
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="rounded-md border border-border bg-bg-alt px-3 py-2">
                        <MarkdownPreview source={task.description} />
                    </div>
                )}
            </div>
        </div>
    );
};
