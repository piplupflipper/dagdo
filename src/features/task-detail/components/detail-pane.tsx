"use client";

import { type JSX, type Ref, useImperativeHandle, useRef, useState } from "react";
import { isSameLogicalRow } from "@/features/task/lib/temp-id-renames";
import { resolveStatus, type TaskStatus } from "@/features/task-detail/lib/task-status";
import { formatDateTime, isOverdue } from "@/lib/date/timezone";
import type { AppTask, TaskDependency } from "@/types/task";
import { BlockedReasonBar } from "./blocked-reason-bar";
import { DependencySection } from "./dependency-section";
import { DescriptionField, type DescriptionFieldHandle } from "./description-field";
import { DueDateField } from "./due-date-field";
import { TitleField } from "./title-field";

/** DetailPane が親へ公開する命令的 API (docs/frontend-design.md §6.1 の `Enter` = 編集領域へフォーカスを移す、を実現するためのもの) */
export type DetailPaneHandle = {
    /** 説明の編集を開始し、MarkdownEditor の textarea へフォーカスを移す。タスク未選択時は何もしない */
    focusEditor: () => void;
};

/** DetailPane の props (OutlineShell が参照する公開契約。task / allTasks / dependencies のシグネチャ変更禁止) */
export type DetailPaneProps = {
    task: AppTask | null;
    allTasks: AppTask[];
    dependencies: TaskDependency[];
    /**
     * `OutlineShell` の `createSibling` が settle 時に記録する、tempId → 実id の対応表
     *
     * `task` は `OutlineShell` の `cursorTask` (id で解決) をそのまま渡されるため、楽観 create の
     * tempId が実id へ切り替わった瞬間、`task.id` も tempId → 実id へ変わる。下の `currentTaskId !== lastTaskId`
     * 判定は本来「別のタスクへ切り替わった」ことを検知する調整だが、この対応表に載っている変化であれば
     * 「同一論理タスクの id 付け替え」なので、タイトル/説明/期日の編集下書きを破棄しない
     */
    tempIdRenames: ReadonlyMap<string, string>;
    /**
     * 編集領域 (タイトル・説明・期日・依存先追加) で `Esc` を押した際、一覧へフォーカスを戻す共通ヘルパー
     *
     * `OutlineShell` が持つ 1 個の関数を props でそのまま渡す (docs/frontend-design.md §6.1)。
     * 各編集領域の `Esc` ハンドラ自体は各子コンポーネントが担う。
     * タイトル・説明・期日は全体方針「Esc = 確定」（docs/frontend-design.md §5）に従って確定する。
     * 依存先追加候補の `select` だけは方針からの意図的な例外としてキャンセルのままとする (第 6.5 節)。
     * このヘルパーはいずれの場合も、確定またはキャンセルの処理が終わった後のフォーカス移動だけを担当する
     */
    onEscapeToOutline: () => void;
    /**
     * タイトル編集の確定 (docs/frontend-design.md §5.2)
     *
     * `OutlineShell` の `commitInlineTitleEdit` を props でそのまま渡す。行内タイトル編集 (`i`/`A`) と
     * 同じ `updateTitle` Op を経由する単一の保存経路であり、変更が無ければ Server Action を投げない判定も
     * 呼び出し先が担うため、本コンポーネント側では変更有無を判定せずに常に呼んでよい
     */
    onCommitTitle: (taskId: string, title: string) => void;
    /**
     * 説明編集の確定
     *
     * `updateDescription` Op を経由する。楽観適用が同期的に効くため、呼び出し後は `updateTask` の応答を
     * 待たずに編集領域を畳んでよい (「保存中」のブロッキング表示は行わない)
     */
    onCommitDescription: (taskId: string, description: string) => void;
    /** 期日編集の確定。`updateDueDate` Op を経由する。onCommitDescription と同じくブロッキングしない */
    onCommitDueDate: (taskId: string, dueDate: string | null) => void;
    /** OutlineShell が focusEditor を呼ぶための ref (React 19 では ref を通常の prop として受け取れるため forwardRef は使わない) */
    ref?: Ref<DetailPaneHandle>;
};

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

/**
 * 右ペイン上部の詳細パネル (docs/frontend-design.md §7.1)
 *
 * 状態バッジ・完了日時・BlockedReasonBar をこのコンポーネントが描き、編集を伴う 4 つの節は
 * それぞれ自分の下書きと編集中フラグを持つ子コンポーネントへ降ろしてある
 * (`TitleField` / `DueDateField` / `DependencySection` / `DescriptionField`)。
 * タイトル・説明・期日は編集確定で `onCommitTitle` / `onCommitDescription` / `onCommitDueDate`
 * （`OutlineShell` が注入する、それぞれ `updateTitle` / `updateDescription` / `updateDueDate` Op を経由する
 * ハンドラ）を呼んで保存する (docs/frontend-design.md §5.2)。
 * 楽観適用が同期的に効くため、呼び出し後は Server Action の応答を待たずに編集領域を畳んでよい。
 * 「保存中」のブロッキング表示・disabled は行わない。
 * 保存に失敗した場合は `OutlineShell` の `StatusLine` へエラー表示される (本コンポーネントはそれを待たない)。
 *
 * 各編集領域の `Esc` keydown は、全体方針「Esc = 確定して一覧へフォーカスを戻す」
 * (docs/frontend-design.md §5) に従い、タイトル・説明・期日のいずれも確定として処理する (第 6.5 節)。
 * タイトルは空文字のまま `Esc` を押した場合、行内タイトル編集 (`i`/`A`) の空 `Esc` と同じく
 * インラインエラーを出して編集領域に留まり、フォーカスも一覧へ戻さない。
 * 依存先追加候補の `select` だけは方針からの意図的な例外としてキャンセルのままとする。
 * いずれの場合も、確定またはキャンセルの処理が終わった後は `onEscapeToOutline`（`OutlineShell` の共通ヘルパー）で
 * フォーカスを一覧側へ戻し、document の keydown ハンドラ（`use-outline-keymap.ts`）の `isEditableTarget` 抑止から
 * 抜けて NORMAL の操作へ復帰する (docs/frontend-design.md §6.1)
 */
export const DetailPane = ({ task, allTasks, dependencies, tempIdRenames, onEscapeToOutline, onCommitTitle, onCommitDescription, onCommitDueDate, ref }: DetailPaneProps): JSX.Element => {
    // タスク切替時にのみ編集状態をリセットする (レンダー中の state 調整。React 公式の推奨パターンであり
    // useEffect による同期を避けることで useOutlineKeymap 側と同様に「必要な処理だけを行う」構成にする)
    const [lastTaskId, setLastTaskId] = useState<string | null>(task?.id ?? null);
    /**
     * 「別のタスクへ切り替わった」と判定するたびに増える値
     *
     * 各節の下書き・編集中フラグは子コンポーネントが持つため、親は「初期化せよ」という合図だけを配る。
     * タイトル・期日・説明の 3 節はこれを `key` に混ぜて作り直し (3 節は同じ children 配列に並ぶため、
     * 値だけを key にすると兄弟間で重複する。節ごとの接頭辞を付けて区別する)、
     * 進行中の通信フラグを持つ `DependencySection` だけは値として受け取り、初期化対象を自分で選ぶ
     */
    const [resetToken, setResetToken] = useState(0);
    const descriptionFieldRef = useRef<DescriptionFieldHandle | null>(null);

    // ref は毎レンダー張り替え、focusEditor が常に最新の子を参照できるようにする。
    // タスク未選択のときは DescriptionField 自体が描かれず ref も null なので、呼んでも何も起きない
    useImperativeHandle(ref, () => ({
        focusEditor: (): void => {
            descriptionFieldRef.current?.focusEditor();
        },
    }));

    const currentTaskId = task?.id ?? null;
    if (currentTaskId !== lastTaskId) {
        // tempId → 実id への付け替え (tempIdRenames のコメント参照) であれば、
        // 「別のタスクへ切り替わった」わけではないので編集下書きを破棄しない
        const isSameLogicalTask = isSameLogicalRow(tempIdRenames, lastTaskId, currentTaskId);
        setLastTaskId(currentTaskId);
        if (!isSameLogicalTask) {
            setResetToken((previous) => previous + 1);
        }
    }

    if (task === null) {
        return <div className="flex h-full flex-1 items-center justify-center p-4 text-sm text-text-dim">タスクを選択してください</div>;
    }

    const status = resolveStatus({ completedAt: task.completed_at, isBlocked: task.is_blocked });
    const overdue = status !== "done" && task.due_date !== null && isOverdue(task.due_date);

    return (
        <div className="flex-1 overflow-y-auto p-4">
            {status === "blocked" ? <BlockedReasonBar task={task} allTasks={allTasks} dependencies={dependencies} /> : null}

            <TitleField key={`title-${resetToken}`} task={task} isDone={status === "done"} onCommitTitle={onCommitTitle} onEscapeToOutline={onEscapeToOutline} />

            <div className="mb-1.5">
                <span className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-bold ${STATUS_BADGE_CLASS[status]}`}>{STATUS_LABEL[status]}</span>
            </div>

            <DueDateField key={`due-date-${resetToken}`} task={task} overdue={overdue} onCommitDueDate={onCommitDueDate} onEscapeToOutline={onEscapeToOutline} />

            {task.completed_at !== null ? <div className="mb-1.5 text-xs text-text-dim">完了日時: {formatDateTime(task.completed_at)}</div> : null}

            <DependencySection task={task} allTasks={allTasks} dependencies={dependencies} resetToken={resetToken} onEscapeToOutline={onEscapeToOutline} />

            <DescriptionField key={`description-${resetToken}`} ref={descriptionFieldRef} task={task} onCommitDescription={onCommitDescription} onEscapeToOutline={onEscapeToOutline} />
        </div>
    );
};
