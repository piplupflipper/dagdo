"use client";

import { type JSX, useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import { DagPanel } from "@/features/dag/components/dag-panel";
import { OutlinePane } from "@/features/outline/components/outline-pane";
import { StatusLine } from "@/features/outline/components/status-line";
import { useOutlineKeymap } from "@/features/outline/hooks/use-outline-keymap";
import { buildOutlineTree, deriveVisibleRows } from "@/features/outline/lib/build-tree";
import { computeIndent, computeOutdent, computeSiblingSwap, type ReparentResult, type SiblingReorderResult } from "@/features/outline/lib/flatten-for-dnd";
import { SearchOverlay } from "@/features/search/components/search-overlay";
import { filterTasks } from "@/features/search/lib/filter-tasks";
import { completeTask } from "@/features/task/actions/complete-task";
import { createTask } from "@/features/task/actions/create-task";
import { moveTask } from "@/features/task/actions/move-task";
import { reopenTask } from "@/features/task/actions/reopen-task";
import { reorderTasks } from "@/features/task/actions/reorder-tasks";
import { softDeleteTask } from "@/features/task/actions/soft-delete-task";
import type { ActionResult, TaskErrorCode } from "@/features/task/lib/action-result";
import { DetailPane, type DetailPaneHandle } from "@/features/task-detail/components/detail-pane";
import { MobileDetailSheet } from "@/features/task-detail/components/mobile-detail-sheet";
import { useOutlineStore } from "@/store/outline-store";
import type { AppTask, TaskDependency } from "@/types/task";

export type OutlineShellProps = {
    userId: string;
    initialTasks: AppTask[];
    initialDependencies: TaskDependency[];
};

type OptimisticAction = { type: "complete"; taskId: string } | { type: "reopen"; taskId: string };

/**
 * 楽観的更新のオーバーレイ計算 (docs/frontend-design.md §5.3, §8.2)
 *
 * completeTask 楽観適用時のみ、そのタスクに依存する他タスクの is_blocked を暫定 false にする例外を持つ。
 * この暫定値は revalidate 完了後にサーバー由来の値へ必ず置き換わり、正とはしない
 */
const applyOptimisticOverlay = (tasks: readonly AppTask[], dependencies: readonly TaskDependency[], action: OptimisticAction): AppTask[] => {
    const nowIso = new Date().toISOString();
    const dependentTaskIds = action.type === "complete" ? new Set(dependencies.filter((dependency) => dependency.depends_on_task_id === action.taskId).map((dependency) => dependency.task_id)) : null;

    return tasks.map((task) => {
        if (task.id === action.taskId) {
            return action.type === "complete" ? { ...task, completed_at: nowIso } : { ...task, completed_at: null };
        }
        if (dependentTaskIds?.has(task.id) && task.is_blocked) {
            return { ...task, is_blocked: false };
        }
        return task;
    });
};

/** DB エラー契約 (req.md §66) の表示用コード。ステータスラインの "E1001: ..." 表示に使う */
const ERROR_DISPLAY_CODE: Record<TaskErrorCode, string> = {
    TASK_NOT_FOUND: "E1000",
    TASK_BLOCKED: "E1001",
    TASK_PARENT_CYCLE: "E1002",
    TASK_DEPENDENCY_CYCLE: "E1003",
    DEPENDENCY_ALREADY_EXISTS: "E1004",
    INVALID_POSITION: "E1005",
    INVALID_PARENT: "E1006",
};

const formatActionError = (result: Extract<ActionResult, { ok: false }>): string => `${ERROR_DISPLAY_CODE[result.code]}: ${result.code} — ${result.message}`;

/** completeTask が TASK_BLOCKED を返した際の原因タスクを、依存関係から自前で計算する (実装要点 2) */
const findBlockingCause = (taskId: string, tasksById: ReadonlyMap<string, AppTask>, dependencies: readonly TaskDependency[]): AppTask | null => {
    for (const dependency of dependencies) {
        if (dependency.task_id !== taskId) {
            continue;
        }
        const blocker = tasksById.get(dependency.depends_on_task_id);
        if (blocker !== undefined && blocker.completed_at === null) {
            return blocker;
        }
    }
    return null;
};

/**
 * アウトライナー本体のクライアント境界コンポーネント (docs/frontend-design.md §7.1)
 *
 * これより下の features/outline/task-detail/dag/search 配下のコンポーネントは "use client" を再宣言しない。
 * タスクデータは props (RSC 由来) を正とし、useOptimistic で complete/reopen 操作のみをオーバーレイする (docs/frontend-design.md §5.2)
 */
export const OutlineShell = ({ userId, initialTasks, initialDependencies }: OutlineShellProps): JSX.Element => {
    // Server Action はセッション (Cookie) から user を解決するため props としては未使用。
    // 将来クライアント側でのユーザー表示等が必要になった場合に備えて props には残す
    void userId;

    const dependencies = initialDependencies;
    const [optimisticTasks, applyOptimisticAction] = useOptimistic(initialTasks, (state: AppTask[], action: OptimisticAction) => applyOptimisticOverlay(state, dependencies, action));
    const [, startTransition] = useTransition();
    const [statusMessage, setStatusMessage] = useState<string | null>(null);
    const [statusError, setStatusError] = useState<string | null>(null);
    /** `Enter` で DetailPane の編集領域へフォーカスを移すための参照 (docs/frontend-design.md §6.1) */
    const detailPaneRef = useRef<DetailPaneHandle | null>(null);

    const mode = useOutlineStore((state) => state.mode);
    const cursorTaskId = useOutlineStore((state) => state.cursorTaskId);
    const visualSelectedTaskIds = useOutlineStore((state) => state.visualSelectedTaskIds);
    const collapsedTaskIds = useOutlineStore((state) => state.collapsedTaskIds);
    const flashTaskId = useOutlineStore((state) => state.flashTaskId);
    const searchQuery = useOutlineStore((state) => state.searchQuery);
    const setVisibleTaskIds = useOutlineStore((state) => state.setVisibleTaskIds);
    const setCursor = useOutlineStore((state) => state.setCursor);
    const toggleCollapsed = useOutlineStore((state) => state.toggleCollapsed);
    const flashTask = useOutlineStore((state) => state.flashTask);
    const exitVisual = useOutlineStore((state) => state.exitVisual);

    const tasksById = new Map(optimisticTasks.map((task) => [task.id, task]));
    const rows = buildOutlineTree(optimisticTasks);
    const trimmedQuery = searchQuery.trim();
    const visibleRows =
        trimmedQuery.length === 0
            ? deriveVisibleRows(rows, collapsedTaskIds)
            : (() => {
                  const matchedIds = new Set(filterTasks({ tasks: optimisticTasks, query: trimmedQuery }).map((task) => task.id));
                  return rows.filter((row) => matchedIds.has(row.task.id));
              })();
    const visibleTaskIdList = visibleRows.map((row) => row.task.id);

    useEffect(() => {
        setVisibleTaskIds(visibleTaskIdList);
    }, [visibleTaskIdList, setVisibleTaskIds]);

    const cursorTask = cursorTaskId !== null ? (tasksById.get(cursorTaskId) ?? null) : null;
    const blockedCount = optimisticTasks.filter((task) => task.is_blocked).length;

    const runComplete = (taskId: string): void => {
        startTransition(async () => {
            applyOptimisticAction({ type: "complete", taskId });
            const result = await completeTask({ taskId });
            if (result.ok) {
                setStatusError(null);
                return;
            }
            if (result.code === "TASK_BLOCKED") {
                const cause = findBlockingCause(taskId, tasksById, dependencies);
                if (cause !== null) {
                    flashTask(cause.id);
                }
                setStatusError(`${ERROR_DISPLAY_CODE.TASK_BLOCKED}: TASK_BLOCKED — ${cause?.title ?? "依存先"} が未完了のため完了できません`);
                return;
            }
            setStatusError(formatActionError(result));
        });
    };

    const runReopen = (taskId: string): void => {
        startTransition(async () => {
            applyOptimisticAction({ type: "reopen", taskId });
            const result = await reopenTask({ taskId });
            if (!result.ok) {
                setStatusError(formatActionError(result));
            }
        });
    };

    const handleToggleDone = (task: AppTask): void => {
        if (task.completed_at !== null) {
            runReopen(task.id);
            return;
        }
        runComplete(task.id);
    };

    const completeCursor = (): void => {
        if (cursorTask === null || cursorTask.completed_at !== null) {
            return;
        }
        runComplete(cursorTask.id);
    };

    const completeSelection = (): void => {
        const taskIds = Array.from(visualSelectedTaskIds);
        if (taskIds.length === 0) {
            exitVisual();
            return;
        }
        startTransition(async () => {
            let successCount = 0;
            for (const taskId of taskIds) {
                applyOptimisticAction({ type: "complete", taskId });
                const result = await completeTask({ taskId });
                if (result.ok) {
                    successCount += 1;
                } else {
                    console.error(`[outline] completeTask failed for ${taskId}: ${result.code} ${result.message}`);
                }
            }
            setStatusMessage(`${taskIds.length}件中${successCount}件を完了`);
            exitVisual();
        });
    };

    const createBelowCursor = (): void => {
        const parentId = cursorTask?.parent_id ?? null;
        startTransition(async () => {
            const result = await createTask({ title: "新規タスク", parentId });
            if (result.ok) {
                setCursor(result.data.id);
                setStatusError(null);
                return;
            }
            setStatusError(formatActionError(result));
        });
    };

    const focusDetailEditor = (): void => {
        // タスク未選択のときは DetailPane が編集領域を持たない (「タスクを選択してください」表示) ため何もしない
        if (cursorTask === null) {
            return;
        }
        detailPaneRef.current?.focusEditor();
    };

    const moveCursorSibling = (direction: "up" | "down"): void => {
        if (cursorTaskId === null) {
            return;
        }
        const result: SiblingReorderResult | null = computeSiblingSwap({ tasks: optimisticTasks, taskId: cursorTaskId, direction });
        if (result === null) {
            return;
        }
        startTransition(async () => {
            const actionResult = await reorderTasks(result);
            if (!actionResult.ok) {
                setStatusError(formatActionError(actionResult));
            }
        });
    };

    const indentCursor = (): void => {
        if (cursorTaskId === null) {
            return;
        }
        const result: ReparentResult | null = computeIndent({ tasks: optimisticTasks, taskId: cursorTaskId });
        if (result === null) {
            return;
        }
        startTransition(async () => {
            const actionResult = await moveTask({ taskId: cursorTaskId, newParentId: result.newParentId, newPosition: result.newPosition });
            if (!actionResult.ok) {
                setStatusError(formatActionError(actionResult));
            }
        });
    };

    const outdentCursor = (): void => {
        if (cursorTaskId === null) {
            return;
        }
        const result: ReparentResult | null = computeOutdent({ tasks: optimisticTasks, taskId: cursorTaskId });
        if (result === null) {
            return;
        }
        startTransition(async () => {
            const actionResult = await moveTask({ taskId: cursorTaskId, newParentId: result.newParentId, newPosition: result.newPosition });
            if (!actionResult.ok) {
                setStatusError(formatActionError(actionResult));
            }
        });
    };

    const softDeleteCursor = (): void => {
        if (cursorTaskId === null) {
            return;
        }
        startTransition(async () => {
            const actionResult = await softDeleteTask({ taskId: cursorTaskId });
            if (!actionResult.ok) {
                setStatusError(formatActionError(actionResult));
            }
        });
    };

    const handleReorder = (result: SiblingReorderResult): void => {
        startTransition(async () => {
            const actionResult = await reorderTasks(result);
            if (!actionResult.ok) {
                setStatusError(formatActionError(actionResult));
            }
        });
    };

    const handleReparent = (taskId: string, result: ReparentResult): void => {
        startTransition(async () => {
            const actionResult = await moveTask({ taskId, newParentId: result.newParentId, newPosition: result.newPosition });
            if (!actionResult.ok) {
                setStatusError(formatActionError(actionResult));
            }
        });
    };

    useOutlineKeymap({
        completeCursor,
        completeSelection,
        createBelowCursor,
        focusDetailEditor,
        moveCursorSibling,
        indentCursor,
        outdentCursor,
        softDeleteCursor,
    });

    return (
        <div className="flex h-dvh flex-col bg-bg text-text">
            <div className="flex flex-shrink-0 items-center gap-2 border-b border-border bg-bg-alt px-3.5 py-2">
                <button
                    type="button"
                    onClick={() => useOutlineStore.getState().enterSearch()}
                    className="flex min-w-0 flex-1 items-center gap-1.5 rounded-base border border-border bg-bg px-2.5 py-1.5 text-left text-xs text-text-dim md:min-w-[200px] md:flex-initial"
                >
                    <span aria-hidden="true">⌕</span>
                    <span className="truncate">/ で検索欄を開く</span>
                </button>
                <button
                    type="button"
                    onClick={() => (mode === "VISUAL" ? exitVisual() : useOutlineStore.getState().enterVisual())}
                    className="flex-shrink-0 rounded-base border border-border px-2.5 py-1.5 text-xs text-accent hover:bg-accent/10"
                >
                    V ビジュアル
                </button>
                <button type="button" onClick={createBelowCursor} className="flex-shrink-0 rounded-base border border-border px-2.5 py-1.5 text-xs text-accent hover:bg-accent/10">
                    + 新規タスク
                </button>
                {/* キーボード操作のヒントはモバイル幅では意味がなく、横幅も圧迫するため md 以上でのみ表示する */}
                <span className="ml-auto hidden text-[11px] text-text-dim md:inline">j k 移動・x 完了・V 範囲選択・/ 検索</span>
            </div>

            {/* PC 幅は 2 ペイン、モバイル幅は左ペイン全幅 + MobileDetailSheet。切り替えは Tailwind のブレークポイントのみで行う */}
            <div className="flex min-h-0 flex-1">
                <div className="flex min-w-0 flex-1 flex-col border-border md:flex-[0_0_60%] md:border-r">
                    <OutlinePane
                        visibleRows={visibleRows}
                        tasks={optimisticTasks}
                        dependencies={dependencies}
                        cursorTaskId={cursorTaskId}
                        visualSelectedTaskIds={visualSelectedTaskIds}
                        flashTaskId={flashTaskId}
                        onSelectCursor={setCursor}
                        onToggleCollapse={toggleCollapsed}
                        onToggleDone={handleToggleDone}
                        onReorder={handleReorder}
                        onReparent={handleReparent}
                    />
                    <StatusLine mode={mode} cursorTask={cursorTask} totalCount={optimisticTasks.length} blockedCount={blockedCount} infoMessage={statusMessage} errorMessage={statusError} />
                </div>
                <div className="hidden min-w-0 flex-1 flex-col bg-bg-alt md:flex">
                    <DetailPane ref={detailPaneRef} task={cursorTask} allTasks={optimisticTasks} dependencies={dependencies} />
                    <DagPanel centerTaskId={cursorTaskId} tasks={optimisticTasks} dependencies={dependencies} flashTaskId={flashTaskId} />
                </div>
            </div>

            <MobileDetailSheet task={cursorTask} allTasks={optimisticTasks} dependencies={dependencies} flashTaskId={flashTaskId} onClose={() => setCursor(null)} />

            <SearchOverlay />
        </div>
    );
};
