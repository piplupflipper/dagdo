"use client";

import { type CSSProperties, type JSX, useEffect, useRef, useState } from "react";
import { DagPanel } from "@/features/dag/components/dag-panel";
import { KeymapHelpOverlay } from "@/features/outline/components/keymap-help-overlay";
import { OutlineHeader } from "@/features/outline/components/outline-header";
import { OutlinePane } from "@/features/outline/components/outline-pane";
import { PaneDivider } from "@/features/outline/components/pane-divider";
import { StatusLine } from "@/features/outline/components/status-line";
import { useOutlineKeymap } from "@/features/outline/hooks/use-outline-keymap";
import { type OutlinePersistence, useOutlineMutations } from "@/features/outline/hooks/use-outline-mutations";
import { buildOutlineTree, collectCollapsibleTaskIds, deriveVisibleRows } from "@/features/outline/lib/build-tree";
import { findSiblingTaskId } from "@/features/outline/lib/flatten-for-dnd";
import type { InlineTitleCaret, InlineTitleEdit } from "@/features/outline/lib/inline-title-edit";
import { applyOutlineOp, type OutlineOp } from "@/features/outline/lib/outline-ops";
import { DEFAULT_LEFT_PANE_RATIO, PANE_RATIO_STORAGE_KEY, parseStoredPaneRatio } from "@/features/outline/lib/pane-ratio";
import { SearchOverlay } from "@/features/search/components/search-overlay";
import { filterTasks } from "@/features/search/lib/filter-tasks";
import { DetailPane, type DetailPaneHandle } from "@/features/task-detail/components/detail-pane";
import { MobileDetailSheet } from "@/features/task-detail/components/mobile-detail-sheet";
import { useOutlineStore } from "@/store/outline-store";
import type { AppTask, TaskDependency } from "@/types/task";

/**
 * カーソル行の `role="option"` 要素を探す
 *
 * `KeymapHelpOverlay` の `resolveRestoreTarget` と同じ探索対象である (docs/frontend-design.md §6.5)。
 * カーソル未選択、あるいはカーソル行が折りたたみ・絞り込みで描かれていない場合は null になる
 */
const findCursorRowElement = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-cursor="true"] [role="option"]');

type OutlineShellProps = {
    userId: string;
    initialTasks: AppTask[];
    initialDependencies: TaskDependency[];
    /**
     * 永続化アダプタの注入口 (オフラインモード、Issue #81)
     *
     * 省略時 (オンライン) は直列 Op キューが永続化を担う。/offline だけが localStorage 保存の
     * アダプタを渡し、オンライン/オフラインの分岐はこの props の有無 1 箇所から導く
     * (依存関係の節・ゴミ箱への導線・ログアウトの出し分けも、ここから導いた真偽値を props で配るだけ)
     */
    persistence?: OutlinePersistence;
};

/**
 * アウトライナー本体のクライアント境界コンポーネント (docs/frontend-design.md §7.1)
 *
 * これより下の features/outline/task-detail/dag/search 配下のコンポーネントは "use client" を再宣言しない。
 * セッション中はクライアント state (`tasks` / `dependencies`) を正とし、Op の適用は純関数 `applyOutlineOp`
 * (lib/outline-ops.ts) による同期 setState で行う。永続化は背後の直列 Op キュー (hooks/use-op-queue.ts) が
 * 自動で行う write-behind であり、props (RSC 由来) の変化は「キューが空のときだけ」state へ採用する
 * (reconcile ゲート、Issue #70)。
 *
 * このコンポーネント自身が持つのは、クライアント正 state と表示用の木の組み立て、書き換えを伴わない UI の状態
 * (ヘルプの開閉・行内タイトル編集・ペイン比率) とカーソル移動だけである。
 * タスクを書き換える操作は `useOutlineMutations` が持つ
 */
export const OutlineShell = ({ userId, initialTasks, initialDependencies, persistence }: OutlineShellProps): JSX.Element => {
    /** クライアント正のタスク一覧と依存関係。初回マウント時に props から取り込み、以後は reconcile ゲートが更新する */
    const [tasks, setTasks] = useState<AppTask[]>(initialTasks);
    const [dependencies, setDependencies] = useState<TaskDependency[]>(initialDependencies);

    /** オフラインモードか (Issue #81)。永続化アダプタの注入有無だけから導き、他の判定材料を持たない */
    const isOfflineMode = persistence !== undefined;

    /** 1 Op をクライアント正 state へ同期適用する (`useOutlineMutations` のパイプラインが呼ぶ) */
    const applyOp = (op: OutlineOp): void => {
        setTasks((previous) => applyOutlineOp(previous, dependencies, op, { fallbackUserId: userId }));
    };

    /**
     * `?` のヘルプオーバーレイの開閉状態 (Issue #16)
     *
     * モードは NORMAL / VISUAL / SEARCH の 3 値に保つ制約があるため `OutlineMode` には足さず、
     * UI ローカルの表示状態としてここで持つ (Zustand ストアにも置かない)
     */
    const [isHelpOpen, setIsHelpOpen] = useState(false);
    /**
     * `i` / `I` / `a` / `A` によるタイトルの行内編集の状態 (docs/frontend-design.md §6.1)
     *
     * ヘルプ開閉と同じく `OutlineMode` にもストアにも持たせず、ここで 1 個の値として持つ。
     * 編集中はフォーカスが input にあり、dispatcher が `isEditableTarget` で手前から素通しするため、
     * モードを増やさなくても `j` / `k` でカーソルだけが動くことはない (lib/inline-title-edit.ts)
     */
    const [inlineTitleEdit, setInlineTitleEdit] = useState<InlineTitleEdit | null>(null);
    /** `Enter` で DetailPane の編集領域へフォーカスを移すための参照 (docs/frontend-design.md §6.1) */
    const detailPaneRef = useRef<DetailPaneHandle | null>(null);

    /**
     * PC 2 ペインの左ペイン比率 (%、docs/frontend-design.md §7.1)
     *
     * 初期レンダリングは常に `DEFAULT_LEFT_PANE_RATIO` (60) とし、SSR とのハイドレーション不整合を避ける。
     * localStorage への保存値の復元は mount 後の `useEffect` で行う
     */
    const [leftPaneRatio, setLeftPaneRatio] = useState<number>(DEFAULT_LEFT_PANE_RATIO);
    /** 2 ペインを並べる行コンテナへの参照。PaneDivider がポインタ位置を比率へ変換する基準に使う */
    const paneRowRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const stored = parseStoredPaneRatio(window.localStorage.getItem(PANE_RATIO_STORAGE_KEY));
        if (stored !== null) {
            setLeftPaneRatio(stored);
        }
    }, []);

    /** ドラッグ終了時に確定した比率を localStorage へ保存する (次回訪問時に復元、docs/frontend-design.md §7.1) */
    const handlePaneRatioDragEnd = (ratio: number): void => {
        window.localStorage.setItem(PANE_RATIO_STORAGE_KEY, String(ratio));
    };

    /**
     * 一覧へフォーカスを戻す共通ヘルパー (docs/frontend-design.md §6.1)
     *
     * `DetailPane` / `MobileDetailSheet` の編集領域で `Esc` を押した後や、行内タイトル編集の終了後に呼ぶ。
     * blur だけでも `isEditableTarget`（use-outline-keymap.ts）の抑止からは外れグローバル keymap は復帰するが、
     * フォーカス位置を一覧側へ明示するためにこちらを使う。
     * カーソル行 (`[data-cursor="true"] [role="option"]`、outline-row.tsx。KeymapHelpOverlay の
     * `resolveRestoreTarget` と同じ探索対象) が見つかればそちらへ、カーソル未選択などで
     * 見つからない場合は一覧のスクロールコンテナ (`data-role="outline-scroll"`、tabIndex={-1}) へ focus する
     */
    const focusOutlineList = (): void => {
        const cursorRow = findCursorRowElement();
        if (cursorRow !== null) {
            cursorRow.focus();
            return;
        }
        document.querySelector<HTMLElement>('[data-role="outline-scroll"]')?.focus();
    };

    const mode = useOutlineStore((state) => state.mode);
    const cursorTaskId = useOutlineStore((state) => state.cursorTaskId);
    const visualSelectedTaskIds = useOutlineStore((state) => state.visualSelectedTaskIds);
    const collapsedTaskIds = useOutlineStore((state) => state.collapsedTaskIds);
    const flashTaskId = useOutlineStore((state) => state.flashTaskId);
    const searchQuery = useOutlineStore((state) => state.searchQuery);
    const setVisibleTaskIds = useOutlineStore((state) => state.setVisibleTaskIds);
    const setCursor = useOutlineStore((state) => state.setCursor);
    const toggleCollapsed = useOutlineStore((state) => state.toggleCollapsed);
    const collapseAllTasks = useOutlineStore((state) => state.collapseAll);

    /**
     * カーソル行へ DOM のフォーカスを追従させる (docs/frontend-design.md §6.6、Issue #58)
     *
     * `j` / `k` はストアの `cursorTaskId` を動かすだけで、フォーカスは押した時点の要素に残る。
     * `focusOutlineList` で一覧の行へ戻った後にカーソルだけが動くと、フォーカスされた行とカーソル行が食い違い、
     * ブラウザのフォーカスリングがカーソルとは別の行に残ったままになる。
     * 追従させるのはフォーカスが行の要素 (`role="option"`) にあるときだけで、行内編集の input や
     * `DetailPane` の textarea、ヘッダのボタンからは奪わない (input は行の内側にあるが `role` を持たないため区別できる)
     */
    useEffect(() => {
        if (cursorTaskId === null) {
            return;
        }
        const activeElement = document.activeElement;
        if (!(activeElement instanceof HTMLElement) || activeElement.getAttribute("role") !== "option") {
            return;
        }
        if (activeElement.closest("[data-task-id]")?.getAttribute("data-task-id") === cursorTaskId) {
            return;
        }
        findCursorRowElement()?.focus();
    }, [cursorTaskId]);

    const tasksById = new Map(tasks.map((task) => [task.id, task]));
    const rows = buildOutlineTree(tasks);
    const trimmedQuery = searchQuery.trim();
    const visibleRows =
        trimmedQuery.length === 0
            ? deriveVisibleRows(rows, collapsedTaskIds)
            : (() => {
                  const matchedIds = new Set(filterTasks({ tasks, query: trimmedQuery }).map((task) => task.id));
                  return rows.filter((row) => matchedIds.has(row.task.id));
              })();
    const visibleTaskIdList = visibleRows.map((row) => row.task.id);

    const cursorTask = cursorTaskId === null ? null : (tasksById.get(cursorTaskId) ?? null);

    // カーソルが別の行へ移ったら行内編集を畳む (行のクリックなど、input の外で起きた移動を拾う)。
    // useEffect による同期ではなくレンダー中の state 調整で行う (detail-pane.tsx の lastTaskId と同じパターン)
    const [lastCursorTaskId, setLastCursorTaskId] = useState<string | null>(cursorTaskId);
    if (cursorTaskId !== lastCursorTaskId) {
        setLastCursorTaskId(cursorTaskId);
        if (inlineTitleEdit !== null) {
            setInlineTitleEdit(null);
        }
    }

    // 編集中の行が表示行の集合から消えた場合も行内編集を畳む (`zM` / `zc` による折りたたみ、検索の絞り込み、他経路での削除)。
    // キー経由でここに来ることはない (編集中はフォーカスが input にあり dispatcher が isEditableTarget で素通しする) が、
    // 行の折りたたみボタンのクリックのようにキーボード以外の経路で表示行が変わったとき、
    // input が unmount されたまま inlineTitleEdit だけが残るのを防ぐ
    if (inlineTitleEdit !== null && !visibleTaskIdList.includes(inlineTitleEdit.taskId)) {
        setInlineTitleEdit(null);
    }

    useEffect(() => {
        setVisibleTaskIds(visibleTaskIdList);
    }, [visibleTaskIdList, setVisibleTaskIds]);

    const blockedCount = tasks.filter((task) => task.is_blocked).length;

    const {
        statusMessage,
        statusError,
        pendingCount,
        handleToggleDone,
        completeCursor,
        completeSelection,
        createSibling,
        copyTasksAsMarkdown,
        commitInlineTitleEdit,
        commitDescriptionEdit,
        commitDueDateEdit,
        moveCursorSibling,
        indentCursor,
        outdentCursor,
        softDeleteCursor,
        handleReorder,
        handleReparent,
        undo,
        redo,
        repeatLastChange,
    } = useOutlineMutations({ userId, tasks, tasksById, dependencies, cursorTask, applyOp, setInlineTitleEdit, persistence });

    /**
     * reconcile ゲート (Issue #70)
     *
     * props の変化 (router.refresh / revalidate 由来) は「キューが空のときだけ」クライアント正 state へ採用する。
     * キューに未送信・送信中の Op が 1 つでもあれば、サーバー由来の一覧は未送信分を含まない古い姿なので無視する
     * (キューが空になった後の reconcile トリガで改めて取り直す、Phase 3)。
     * 採用判定は「props の参照が変わり、かつキューが空」。tasks と dependencies は同時に採用する
     */
    const [lastInitialTasks, setLastInitialTasks] = useState<AppTask[]>(initialTasks);
    if (initialTasks !== lastInitialTasks) {
        setLastInitialTasks(initialTasks);
        if (pendingCount === 0) {
            setTasks(initialTasks);
            setDependencies(initialDependencies);
        }
    }

    /** `i` / `I` / `a` / `A`。カーソル行のタイトルの行内編集を開始する。実際のフォーカス移動は InlineTitleEditor の callback ref が行う */
    const startInlineTitleEdit = (caret: InlineTitleCaret): void => {
        if (cursorTask === null) {
            return;
        }
        setInlineTitleEdit({ taskId: cursorTask.id, caret, draft: cursorTask.title });
    };

    /** 行内タイトル編集中の下書きの変更。`InlineTitleEditor` を controlled にするための onChange */
    const updateInlineTitleDraft = (taskId: string, draft: string): void => {
        setInlineTitleEdit((current) => (current !== null && current.taskId === taskId ? { ...current, draft } : current));
    };

    const focusDetailEditor = (): void => {
        // タスク未選択のときは DetailPane が編集領域を持たない (「タスクを選択してください」表示) ため何もしない
        if (cursorTask === null) {
            return;
        }
        detailPaneRef.current?.focusEditor();
    };

    /**
     * `{` / `}`。同じ actual parent の 1 つ前 / 後の兄弟へカーソルを移す
     *
     * 端の兄弟にいるときは動かさない (`j` / `k` が端で留まるのと揃える)
     */
    const jumpToSibling = (direction: "up" | "down"): void => {
        if (cursorTaskId === null) {
            return;
        }
        const siblingTaskId = findSiblingTaskId({ tasks, taskId: cursorTaskId, direction });
        if (siblingTaskId === null) {
            return;
        }
        setCursor(siblingTaskId);
    };

    /**
     * `zM`。子を持つ行をすべて折りたたむ
     *
     * 対象 ID の算出をここで行い、ストアへは ID の集合だけを渡す。ストアの visibleTaskIds は depth も parent_id も持たず
     * 「子を持つ行」を判定できないためで、ストアへ木構造を複製しないための分担である (docs/frontend-design.md §5.2)。
     * 対になる `zR` がストアのアクション (expandAll) だけで完結するのと非対称なのはこの理由による
     */
    const collapseAll = (): void => {
        collapseAllTasks(collectCollapsibleTaskIds(rows));
    };

    useOutlineKeymap({
        handlers: {
            completeCursor,
            completeSelection,
            createSibling,
            startInlineTitleEdit,
            focusDetailEditor,
            jumpToSibling,
            collapseAll,
            moveCursorSibling,
            indentCursor,
            outdentCursor,
            softDeleteCursor,
            repeatLastChange,
            undo,
            redo,
            openHelp: () => setIsHelpOpen(true),
            closeHelp: () => setIsHelpOpen(false),
        },
        isHelpOpen,
    });

    return (
        <div className="flex h-dvh flex-col text-text">
            {/*
             * ヘルプ表示中の背面は inert にする (MobileDetailSheet が閉じている間と同じ道具)
             *
             * role="dialog" + aria-modal="true" で「背面は不活性」と支援技術へ宣言している以上、
             * Tab で背面へ抜けられる状態はその宣言と矛盾する。
             * 抜けた先が textarea だと isEditableTarget により dispatcher が手前で return するため、
             * q / Esc でヘルプを閉じられなくなる実害もある。
             * オーバーレイ自身 (KeymapHelpOverlay) はこのルート直下の兄弟であり inert の外に置く。
             * SearchOverlay は mode === "SEARCH" のときだけ描画されるが、? は NORMAL のエントリで、
             * SEARCH へ入る導線 (`/` とヘッダの検索ボタン) は表示中どちらも封じられるため対象外でよい
             */}
            <OutlineHeader isInert={isHelpOpen} onCreateTask={() => createSibling("below")} onCopyMarkdown={copyTasksAsMarkdown} />

            {/*
             * PC 幅は 2 ペイン、モバイル幅は左ペイン全幅 + MobileDetailSheet。切り替えは Tailwind のブレークポイントのみで行う。
             * 左ペインの幅比 (`leftPaneRatio`) は `md:flex-[0_0_var(--left-pane-percent)]` として CSS 変数越しに適用する。
             * `md:` 接頭辞が付いた Tailwind の responsive utility は @media 経由でのみ効くため、この変数を使っても
             * モバイル幅では素の `flex-1`（全幅）のままになる (docs/frontend-design.md §7.1)
             */}
            <div ref={paneRowRef} className="flex min-h-0 flex-1" inert={isHelpOpen}>
                <div className="flex min-w-0 flex-1 flex-col border-border md:flex-[0_0_var(--left-pane-percent)] md:border-r" style={{ "--left-pane-percent": `${leftPaneRatio}%` } as CSSProperties}>
                    <OutlinePane
                        visibleRows={visibleRows}
                        tasks={tasks}
                        dependencies={dependencies}
                        cursorTaskId={cursorTaskId}
                        visualSelectedTaskIds={visualSelectedTaskIds}
                        flashTaskId={flashTaskId}
                        inlineTitleEdit={inlineTitleEdit}
                        onSelectCursor={setCursor}
                        onToggleCollapse={toggleCollapsed}
                        onToggleDone={handleToggleDone}
                        onReorder={handleReorder}
                        onReparent={handleReparent}
                        onInlineTitleDraftChange={updateInlineTitleDraft}
                        onCommitInlineTitle={commitInlineTitleEdit}
                        onCancelInlineTitle={() => setInlineTitleEdit(null)}
                        onFocusOutlineList={focusOutlineList}
                    />
                    <StatusLine
                        mode={mode}
                        cursorTask={cursorTask}
                        totalCount={tasks.length}
                        blockedCount={blockedCount}
                        infoMessage={statusMessage}
                        errorMessage={statusError}
                        pendingCount={pendingCount}
                        isOfflineMode={isOfflineMode}
                    />
                </div>
                {/* dnd-kit の DndContext (行の並べ替え、OutlinePane 内) の外に置き、行 dnd とポインタ操作を競合させない */}
                <PaneDivider containerRef={paneRowRef} ratio={leftPaneRatio} onRatioChange={setLeftPaneRatio} onDragEnd={handlePaneRatioDragEnd} />
                <div className="hidden min-w-0 flex-1 flex-col bg-bg-alt backdrop-blur-sm md:flex">
                    <DetailPane
                        ref={detailPaneRef}
                        task={cursorTask}
                        allTasks={tasks}
                        dependencies={dependencies}
                        showDependencySection={!isOfflineMode}
                        onEscapeToOutline={focusOutlineList}
                        onCommitTitle={commitInlineTitleEdit}
                        onCommitDescription={commitDescriptionEdit}
                        onCommitDueDate={commitDueDateEdit}
                    />
                    <DagPanel centerTaskId={cursorTaskId} tasks={tasks} dependencies={dependencies} flashTaskId={flashTaskId} />
                </div>
            </div>

            <MobileDetailSheet
                task={cursorTask}
                allTasks={tasks}
                dependencies={dependencies}
                showDependencySection={!isOfflineMode}
                flashTaskId={flashTaskId}
                isInert={isHelpOpen}
                onClose={() => setCursor(null)}
                onEscapeToOutline={focusOutlineList}
                onCommitTitle={commitInlineTitleEdit}
                onCommitDescription={commitDescriptionEdit}
                onCommitDueDate={commitDueDateEdit}
            />

            <SearchOverlay />

            <KeymapHelpOverlay isOpen={isHelpOpen} onClose={() => setIsHelpOpen(false)} />
        </div>
    );
};
