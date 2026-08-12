import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { JSX, KeyboardEvent } from "react";
import { InlineTitleEditor } from "@/features/outline/components/inline-title-editor";
import type { OutlineTreeRow } from "@/features/outline/lib/build-tree";
import type { InlineTitleCaret } from "@/features/outline/lib/inline-title-edit";
import type { AppTask } from "@/types/task";

export type OutlineRowProps = {
    row: OutlineTreeRow;
    registerRow: (taskId: string) => (element: HTMLDivElement | null) => void;
    isCursor: boolean;
    isVisualSelected: boolean;
    isFlashing: boolean;
    /** この行を行内編集中ならキャレット位置、編集中でなければ null (docs/frontend-design.md §6.1) */
    inlineEditCaret: InlineTitleCaret | null;
    onSelectCursor: (taskId: string) => void;
    onToggleCollapse: (taskId: string) => void;
    onToggleDone: (task: AppTask) => void;
    /** 行内編集の確定。トリム済みで空でないタイトルが渡る */
    onCommitInlineTitle: (taskId: string, title: string) => void;
    /** 行内編集の取り消し */
    onCancelInlineTitle: () => void;
    /** 一覧へフォーカスを戻す共通ヘルパー (`OutlineShell` が持つ、docs/frontend-design.md §6.1)。行内編集の Esc/Enter 終了時に使う */
    onFocusOutlineList: () => void;
};

const INDENT_PX = 20;

/** due_date (YYYY-MM-DD) を "M/D" 形式に整形する */
const formatDueLabel = (dueDate: string): string => {
    const [, month, day] = dueDate.split("-");
    return `期日 ${Number(month)}/${Number(day)}`;
};

/** Asia/Tokyo の「今日」より前の due_date かどうか (req.md §6 相当。未完了タスクのみ対象) */
const isOverdue = (task: AppTask): boolean => {
    if (task.due_date === null || task.completed_at !== null) {
        return false;
    }
    const todayJst = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(new Date());
    return task.due_date < todayJst;
};

/**
 * アウトライン 1 行 (バレット・タイトル・期日チップ・🔒, docs/frontend-design.md §7.1 / モック p26)
 *
 * dnd-kit の useSortable をこの行自身で呼び、ドラッグハンドルにのみ listeners を割り当てる
 * (行全体を click でカーソル選択に使うため、ドラッグ開始点をハンドルに限定する)
 */
export const OutlineRow = ({
    row,
    registerRow,
    isCursor,
    isVisualSelected,
    isFlashing,
    inlineEditCaret,
    onSelectCursor,
    onToggleCollapse,
    onToggleDone,
    onCommitInlineTitle,
    onCancelInlineTitle,
    onFocusOutlineList,
}: OutlineRowProps): JSX.Element => {
    const { task, depth, hasChildren } = row;
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });

    const isDone = task.completed_at !== null;
    const overdue = isOverdue(task);
    const registerNode = registerRow(task.id);

    const rowStateClass = isCursor ? "bg-accent/10 shadow-[inset_2px_0_0_var(--color-accent)]" : isVisualSelected ? "bg-accent/15" : "hover:bg-bg-alt";

    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelectCursor(task.id);
        }
    };

    return (
        <div
            ref={(element) => {
                setNodeRef(element);
                registerNode(element);
            }}
            style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}
            data-task-id={task.id}
            data-cursor={isCursor ? "true" : undefined}
        >
            <div
                role="option"
                aria-selected={isCursor}
                tabIndex={-1}
                onClick={() => onSelectCursor(task.id)}
                onKeyDown={handleKeyDown}
                className={`group flex items-center gap-1.5 rounded-base px-1.5 py-1 text-[13px] transition-shadow ${rowStateClass} ${isFlashing ? "animate-pulse" : ""}`}
                style={{ paddingLeft: 6 + depth * INDENT_PX }}
            >
                <button
                    type="button"
                    className="w-3.5 flex-shrink-0 cursor-grab text-[10px] text-text-dim opacity-0 group-hover:opacity-100"
                    aria-label="ドラッグして並べ替え"
                    {...attributes}
                    {...listeners}
                >
                    ⋮⋮
                </button>

                {hasChildren ? (
                    <button
                        type="button"
                        tabIndex={-1}
                        onClick={(event) => {
                            event.stopPropagation();
                            onToggleCollapse(task.id);
                        }}
                        className="flex h-4 w-4 flex-shrink-0 items-center justify-center text-[10px] text-text-dim"
                        aria-label="折り畳み"
                    >
                        ▾
                    </button>
                ) : (
                    <span className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
                )}

                <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-done" aria-hidden="true" />

                <button
                    type="button"
                    tabIndex={-1}
                    onClick={(event) => {
                        event.stopPropagation();
                        onToggleDone(task);
                    }}
                    className={`flex h-[19px] w-[19px] flex-shrink-0 items-center justify-center rounded-full border text-[10px] ${
                        isDone ? "border-accent bg-accent text-accent-ink" : task.is_blocked ? "border-blocked text-blocked" : "border-border bg-bg"
                    }`}
                    aria-label={!isDone && task.is_blocked ? "完了を切替(ブロック中)" : "完了を切替"}
                >
                    {isDone ? "✓" : task.is_blocked ? "🔒" : ""}
                </button>

                {/* モバイル幅では固定幅だと行が画面幅を超えて横スクロールを生むため、縮小・省略を許す。md 以上は従来どおり縮まない */}
                {inlineEditCaret !== null ? (
                    <InlineTitleEditor
                        initialTitle={task.title}
                        caret={inlineEditCaret}
                        onCommit={(title) => onCommitInlineTitle(task.id, title)}
                        onCancel={onCancelInlineTitle}
                        focusRow={onFocusOutlineList}
                    />
                ) : (
                    <span className={`min-w-0 flex-1 truncate md:min-w-[10em] md:flex-none ${isDone ? "text-text-dim line-through" : "text-text"}`}>{task.title}</span>
                )}

                <span className="ml-auto flex flex-shrink-0 flex-wrap items-center justify-end gap-1">
                    {isDone ? (
                        <span className="rounded-full border border-border bg-bg-alt px-2 py-0.5 text-[11px] text-text-dim">完了</span>
                    ) : task.due_date !== null ? (
                        <span
                            className={`rounded-full border px-2 py-0.5 text-[11px] ${overdue ? "border-overdue bg-overdue/10 font-semibold text-overdue" : "border-border bg-bg-alt text-text-dim"}`}
                        >
                            {formatDueLabel(task.due_date)}
                            {overdue ? "・期限切れ" : ""}
                        </span>
                    ) : null}
                </span>
            </div>
        </div>
    );
};
