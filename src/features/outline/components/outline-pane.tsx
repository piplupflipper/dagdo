import { DndContext, type DragEndEvent, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { arrayMove, SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { type JSX, useRef } from "react";
import { DependencyRail } from "@/features/outline/components/dependency-rail";
import { OutlineRow } from "@/features/outline/components/outline-row";
import { useRowRefs } from "@/features/outline/hooks/use-row-refs";
import type { OutlineTreeRow } from "@/features/outline/lib/build-tree";
import { computeDropResult, flattenForDnd, type ReparentResult, type SiblingReorderResult } from "@/features/outline/lib/flatten-for-dnd";
import type { InlineTitleEdit } from "@/features/outline/lib/inline-title-edit";
import type { AppTask, TaskDependency } from "@/types/task";

type OutlinePaneProps = {
    visibleRows: readonly OutlineTreeRow[];
    tasks: readonly AppTask[];
    dependencies: readonly TaskDependency[];
    cursorTaskId: string | null;
    visualSelectedTaskIds: ReadonlySet<string>;
    flashTaskId: string | null;
    /** 行内編集中のタスクとキャレット位置。編集していなければ null (docs/frontend-design.md §6.1) */
    inlineTitleEdit: InlineTitleEdit | null;
    onSelectCursor: (taskId: string) => void;
    onToggleCollapse: (taskId: string) => void;
    onToggleDone: (task: AppTask) => void;
    onReorder: (taskId: string, result: SiblingReorderResult) => void;
    onReparent: (taskId: string, result: ReparentResult) => void;
    /** 行内編集の下書きの変更 (`inline-title-editor.tsx` の controlled value、バグ修正) */
    onInlineTitleDraftChange: (taskId: string, draft: string) => void;
    onCommitInlineTitle: (taskId: string, title: string) => void;
    onCancelInlineTitle: () => void;
    /** 一覧へフォーカスを戻す共通ヘルパー (`OutlineShell` が持つ、docs/frontend-design.md §6.1)。行内編集の Esc/Enter 終了時に使う */
    onFocusOutlineList: () => void;
};

/**
 * DndContext の固定 ID
 *
 * dnd-kit は id 未指定だとモジュールスコープのカウンタから aria-describedby 用 ID を採番するため、
 * SSR とハイドレーション時の CSR とで採番結果がずれて hydration error になる。
 * id を渡すとその値がそのまま aria-describedby に使われ、サーバー/クライアントで一致する
 * (@dnd-kit/utilities の useUniqueId は第 2 引数が truthy ならそれを返す)。
 * DndContext はこのページに 1 つだけなので固定文字列で衝突しない
 */
const DND_CONTEXT_ID = "outline-dnd";

/**
 * 左ペイン全体 (docs/frontend-design.md §7.1)
 *
 * DependencyRail (ガター) + OutlineRow の一覧を表示し、dnd-kit の DndContext/SortableContext を構成する。
 * ドロップ確定時の新しい parent・position の算出は flatten-for-dnd.ts の純粋関数を使い、
 * キーボード代替 (J/K/</>) と同じロジックを共有する (docs/frontend-design.md §9)。
 * ポインタ操作の完成度は最小限とし、同一 depth 内での並べ替え・ドロップ先の親への reparent のみ扱う
 */
export const OutlinePane = ({
    visibleRows,
    tasks,
    dependencies,
    cursorTaskId,
    visualSelectedTaskIds,
    flashTaskId,
    inlineTitleEdit,
    onSelectCursor,
    onToggleCollapse,
    onToggleDone,
    onReorder,
    onReparent,
    onInlineTitleDraftChange,
    onCommitInlineTitle,
    onCancelInlineTitle,
    onFocusOutlineList,
}: OutlinePaneProps): JSX.Element => {
    const containerRef = useRef<HTMLDivElement>(null);
    const { registerRow, rowMapRef } = useRowRefs();
    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
    const dndItems = flattenForDnd(visibleRows);
    const tasksById = new Map(tasks.map((task) => [task.id, task]));
    const visibleTaskIds = visibleRows.map((row) => row.task.id);

    const handleDragEnd = (event: DragEndEvent): void => {
        const { active, over } = event;
        if (over === null || active.id === over.id) {
            return;
        }
        const activeId = String(active.id);
        const overId = String(over.id);
        const overItem = dndItems.find((item) => item.id === overId);
        if (overItem === undefined) {
            return;
        }

        const targetSiblingIds = dndItems.filter((item) => item.parentId === overItem.parentId).map((item) => item.id);
        const fromIndex = targetSiblingIds.indexOf(activeId);
        const overIndex = targetSiblingIds.indexOf(overId);
        const orderedIds = fromIndex >= 0 ? arrayMove(targetSiblingIds, fromIndex, overIndex) : [...targetSiblingIds.slice(0, overIndex), activeId, ...targetSiblingIds.slice(overIndex)];

        const dropResult = computeDropResult({ tasks, taskId: activeId, targetParentId: overItem.parentId, targetOrderedIds: orderedIds });
        if (dropResult.kind === "reorder") {
            onReorder(activeId, dropResult.result);
        } else {
            onReparent(activeId, dropResult.result);
        }
    };

    return (
        <div ref={containerRef} tabIndex={-1} className="flex min-h-0 flex-1 overflow-y-auto bg-bg backdrop-blur-sm outline-none" data-role="outline-scroll">
            <DependencyRail containerRef={containerRef} rowMapRef={rowMapRef} visibleTaskIds={visibleTaskIds} dependencies={dependencies} tasksById={tasksById} cursorTaskId={cursorTaskId} />
            <DndContext id={DND_CONTEXT_ID} sensors={sensors} onDragEnd={handleDragEnd}>
                <SortableContext items={dndItems.map((item) => item.id)} strategy={verticalListSortingStrategy}>
                    <div className="min-w-0 flex-1 py-2 pr-3.5 pl-2.5" role="listbox" aria-label="タスク一覧" data-role="outline-tree">
                        {visibleRows.map((row) => (
                            <OutlineRow
                                key={row.task.id}
                                row={row}
                                registerRow={registerRow}
                                isCursor={row.task.id === cursorTaskId}
                                isVisualSelected={visualSelectedTaskIds.has(row.task.id)}
                                isFlashing={row.task.id === flashTaskId}
                                inlineEditCaret={inlineTitleEdit?.taskId === row.task.id ? inlineTitleEdit.caret : null}
                                inlineEditDraft={inlineTitleEdit?.taskId === row.task.id ? inlineTitleEdit.draft : null}
                                onSelectCursor={onSelectCursor}
                                onToggleCollapse={onToggleCollapse}
                                onToggleDone={onToggleDone}
                                onInlineTitleDraftChange={onInlineTitleDraftChange}
                                onCommitInlineTitle={onCommitInlineTitle}
                                onCancelInlineTitle={onCancelInlineTitle}
                                onFocusOutlineList={onFocusOutlineList}
                            />
                        ))}
                    </div>
                </SortableContext>
            </DndContext>
        </div>
    );
};
