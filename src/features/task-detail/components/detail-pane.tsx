"use client";

import { type JSX, type Ref, useImperativeHandle, useRef, useState } from "react";
import { removeDependency } from "@/features/task/actions/remove-dependency";
import { updateTask } from "@/features/task/actions/update-task";
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

/** due_date (YYYY-MM-DD) が Asia/Tokyo の「今日」より前かどうか */
const isOverdue = (dueDate: string): boolean => {
    const todayJst = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(new Date());
    return dueDate < todayJst;
};

/**
 * 右ペイン上部の詳細パネル (docs/frontend-design.md §7.1)
 *
 * タイトル・状態・期日・完了日時を表示し、blocked の場合は BlockedReasonBar を表示する
 * description はプレビュー (MarkdownPreview) / 編集 (MarkdownEditor) を切り替え、
 * 編集確定で updateTask を呼んで保存する (失敗時はインラインでエラーを表示する)
 */
export const DetailPane = ({ task, allTasks, dependencies, ref }: DetailPaneProps): JSX.Element => {
    // タスク切替時にのみ編集状態をリセットする (レンダー中の state 調整。React 公式の推奨パターンであり
    // useEffect による同期を避けることで useOutlineKeymap 側と同様に「必要な処理だけを行う」構成にする)
    const [lastTaskId, setLastTaskId] = useState<string | null>(task?.id ?? null);
    const [draft, setDraft] = useState(task?.description ?? "");
    const [isEditing, setIsEditing] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [dependencyError, setDependencyError] = useState<string | null>(null);
    const [removingDependencyId, setRemovingDependencyId] = useState<string | null>(null);

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
        setDependencyError(null);
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

    const handleRemoveDependency = async (dependsOnTaskId: string): Promise<void> => {
        setRemovingDependencyId(dependsOnTaskId);
        setDependencyError(null);
        const result = await removeDependency({ taskId: task.id, dependsOnTaskId });
        setRemovingDependencyId(null);
        if (!result.ok) {
            setDependencyError(result.message);
        }
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

    return (
        <div className="flex-1 overflow-y-auto p-4">
            {status === "blocked" ? <BlockedReasonBar task={task} allTasks={allTasks} dependencies={dependencies} /> : null}

            <h3 className={`mb-2 text-base font-semibold ${status === "done" ? "text-text-dim line-through" : "text-text"}`}>{task.title}</h3>

            <div className="mb-1.5">
                <span className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-bold ${STATUS_BADGE_CLASS[status]}`}>{STATUS_LABEL[status]}</span>
            </div>

            {task.due_date !== null ? (
                <div className={`mb-1.5 text-xs ${overdue ? "font-semibold text-overdue" : "text-text-dim"}`}>
                    期日: {formatDate(task.due_date)}
                    {overdue ? " (期限切れ)" : ""}
                </div>
            ) : null}

            {task.completed_at !== null ? <div className="mb-1.5 text-xs text-text-dim">完了日時: {formatDateTime(task.completed_at)}</div> : null}

            {dependsOnTasks.length > 0 ? (
                <div className="mt-3">
                    <div className="mb-1.5 text-xs text-text-dim">依存先</div>
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
                    {dependencyError !== null ? <p className="mt-1 text-xs text-overdue">{dependencyError}</p> : null}
                </div>
            ) : null}

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
                                className="rounded-md bg-accent px-3 py-1 text-xs font-semibold text-bg disabled:opacity-60"
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
