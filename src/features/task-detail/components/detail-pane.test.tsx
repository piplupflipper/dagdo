import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DetailPane, type DetailPaneHandle } from "@/features/task-detail/components/detail-pane";
import type { AppTask, TaskDependency } from "@/types/task";

/**
 * 詳細ペインを 4 つの子コンポーネントへ分割した際の回帰テスト (Issue #34)
 *
 * 網羅は狙わず、分割で壊れやすい点だけを確かめる。すなわち
 * 各節の下書きが子の state になっても編集と確定が通ること、タスク切替で下書きが初期化されること、
 * 空タイトルの `Esc` が編集領域に留まること、`DetailPaneHandle.focusEditor` が子まで届くことである
 */

const addDependencyMock = vi.fn();
const removeDependencyMock = vi.fn();

vi.mock("@/features/task/actions/add-dependency", () => ({
    addDependency: (input: unknown) => addDependencyMock(input),
}));
vi.mock("@/features/task/actions/remove-dependency", () => ({
    removeDependency: (input: unknown) => removeDependencyMock(input),
}));

/** 詳細ペインの表示に効くカラムだけを指定してタスクを作る (残りは判定に関与しない固定値) */
const task = ({ id, title = id, description = "", dueDate = null }: { id: string; title?: string; description?: string; dueDate?: string | null }): AppTask => ({
    id,
    user_id: "user-1",
    title,
    description,
    parent_id: null,
    effective_parent_id: null,
    position: 0,
    sort_path: [0],
    due_date: dueDate,
    is_blocked: false,
    completed_at: null,
    created_at: "2026-08-13T00:00:00.000Z",
    updated_at: "2026-08-13T00:00:00.000Z",
});

const renderPane = (overrides: { task?: AppTask; allTasks?: AppTask[]; dependencies?: TaskDependency[] } = {}) => {
    const handlers = {
        onEscapeToOutline: vi.fn(),
        onCommitTitle: vi.fn(),
        onCommitDescription: vi.fn(),
        onCommitDueDate: vi.fn(),
    };
    const ref = createRef<DetailPaneHandle>();
    const currentTask = overrides.task ?? task({ id: "task-1", title: "元のタイトル", description: "元の説明" });
    const view = render(<DetailPane ref={ref} task={currentTask} allTasks={overrides.allTasks ?? [currentTask]} dependencies={overrides.dependencies ?? []} {...handlers} />);
    /** 同じ props のまま task だけを差し替えて再レンダーする */
    const rerenderWithTask = (nextTask: AppTask): void => {
        view.rerender(<DetailPane ref={ref} task={nextTask} allTasks={[nextTask]} dependencies={overrides.dependencies ?? []} {...handlers} />);
    };
    return { ...handlers, ref, rerenderWithTask };
};

/** 節ごとに「編集」ボタンが並ぶため、対象の節を aria-label が付いた入力欄の有無で選び分ける */
const startEditing = (index: number): void => {
    fireEvent.click(screen.getAllByRole("button", { name: "編集" })[index]);
};

beforeEach(() => {
    addDependencyMock.mockResolvedValue({ ok: true, data: undefined });
    removeDependencyMock.mockResolvedValue({ ok: true, data: undefined });
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe("タイトルの編集", () => {
    it("Enter で確定し、表示へ戻る", () => {
        const { onCommitTitle } = renderPane();
        startEditing(0);
        const input = screen.getByRole("textbox", { name: "タイトルを編集" });
        fireEvent.change(input, { target: { value: "  新しいタイトル  " } });
        fireEvent.keyDown(input, { key: "Enter" });
        expect(onCommitTitle).toHaveBeenCalledWith("task-1", "新しいタイトル");
        expect(screen.queryByRole("textbox", { name: "タイトルを編集" })).toBeNull();
    });

    it("Esc は確定したうえで一覧へフォーカスを戻す", () => {
        const { onCommitTitle, onEscapeToOutline } = renderPane();
        startEditing(0);
        const input = screen.getByRole("textbox", { name: "タイトルを編集" });
        fireEvent.change(input, { target: { value: "Esc で確定" } });
        fireEvent.keyDown(input, { key: "Escape" });
        expect(onCommitTitle).toHaveBeenCalledWith("task-1", "Esc で確定");
        expect(onEscapeToOutline).toHaveBeenCalledTimes(1);
    });

    it("空文字のまま Esc を押すとインラインエラーを出して編集領域に留まる", () => {
        const { onCommitTitle, onEscapeToOutline } = renderPane();
        startEditing(0);
        const input = screen.getByRole("textbox", { name: "タイトルを編集" });
        fireEvent.change(input, { target: { value: "   " } });
        fireEvent.keyDown(input, { key: "Escape" });
        expect(onCommitTitle).not.toHaveBeenCalled();
        expect(onEscapeToOutline).not.toHaveBeenCalled();
        expect(screen.getByRole("textbox", { name: "タイトルを編集" })).toBe(input);
        expect(screen.getByText("タイトルは空にできません")).toBeTruthy();
    });

    it("IME 変換確定の Enter / Esc は確定として扱わない", () => {
        const { onCommitTitle, onEscapeToOutline } = renderPane();
        startEditing(0);
        const input = screen.getByRole("textbox", { name: "タイトルを編集" });
        fireEvent.keyDown(input, { key: "Enter", isComposing: true });
        fireEvent.keyDown(input, { key: "Escape", isComposing: true });
        expect(onCommitTitle).not.toHaveBeenCalled();
        expect(onEscapeToOutline).not.toHaveBeenCalled();
    });

    it("編集開始時に input へフォーカスし、既存タイトルを選択状態にする", () => {
        renderPane();
        startEditing(0);
        const input = screen.getByRole("textbox", { name: "タイトルを編集" });
        expect(document.activeElement).toBe(input);
        expect([(input as HTMLInputElement).selectionStart, (input as HTMLInputElement).selectionEnd]).toEqual([0, "元のタイトル".length]);
    });
});

describe("期日の編集", () => {
    it("入力した日付で確定し、Esc は一覧へフォーカスを戻す", () => {
        const { onCommitDueDate, onEscapeToOutline } = renderPane();
        startEditing(1);
        const input = screen.getByLabelText("期日を編集");
        fireEvent.change(input, { target: { value: "2026-09-01" } });
        fireEvent.keyDown(input, { key: "Escape" });
        expect(onCommitDueDate).toHaveBeenCalledWith("task-1", "2026-09-01");
        expect(onEscapeToOutline).toHaveBeenCalledTimes(1);
    });

    it("クリアしてから保存すると期日を解除する (空文字は null)", () => {
        const { onCommitDueDate } = renderPane({ task: task({ id: "task-1", dueDate: "2026-09-01" }) });
        startEditing(1);
        fireEvent.click(screen.getByRole("button", { name: "クリア" }));
        fireEvent.click(screen.getByRole("button", { name: "保存" }));
        expect(onCommitDueDate).toHaveBeenCalledWith("task-1", null);
    });
});

describe("説明の編集", () => {
    it("Ctrl+Enter で確定し、一覧へはフォーカスを戻さない", () => {
        const { onCommitDescription, onEscapeToOutline } = renderPane();
        startEditing(2);
        const textarea = screen.getByRole("textbox");
        fireEvent.change(textarea, { target: { value: "新しい説明" } });
        fireEvent.keyDown(textarea, { key: "Enter", ctrlKey: true });
        expect(onCommitDescription).toHaveBeenCalledWith("task-1", "新しい説明");
        expect(onEscapeToOutline).not.toHaveBeenCalled();
    });

    it("Esc は確定したうえで一覧へフォーカスを戻す", () => {
        const { onCommitDescription, onEscapeToOutline } = renderPane();
        startEditing(2);
        const textarea = screen.getByRole("textbox");
        fireEvent.change(textarea, { target: { value: "Esc で確定" } });
        fireEvent.keyDown(textarea, { key: "Escape" });
        expect(onCommitDescription).toHaveBeenCalledWith("task-1", "Esc で確定");
        expect(onEscapeToOutline).toHaveBeenCalledTimes(1);
    });
});

describe("DetailPaneHandle.focusEditor", () => {
    it("説明の編集を開始し textarea へフォーカスする (`Enter` の導線)", () => {
        const { ref } = renderPane();
        // 本番では keydown ハンドラの中から呼ばれ、そのバッチで再レンダーまで進む
        act(() => {
            ref.current?.focusEditor();
        });
        const textarea = screen.getByRole("textbox");
        expect(textarea.tagName).toBe("TEXTAREA");
        expect(document.activeElement).toBe(textarea);
    });

    it("すでに編集中なら textarea へフォーカスを移すだけで下書きを巻き戻さない", () => {
        const { ref } = renderPane();
        startEditing(2);
        const textarea = screen.getByRole("textbox");
        fireEvent.change(textarea, { target: { value: "編集途中" } });
        textarea.blur();
        act(() => {
            ref.current?.focusEditor();
        });
        expect(document.activeElement).toBe(textarea);
        expect((textarea as HTMLTextAreaElement).value).toBe("編集途中");
    });

    it("タスク未選択のときは何も起きない", () => {
        render(<DetailPane task={null} allTasks={[]} dependencies={[]} onEscapeToOutline={vi.fn()} onCommitTitle={vi.fn()} onCommitDescription={vi.fn()} onCommitDueDate={vi.fn()} />);
        expect(screen.getByText("タスクを選択してください")).toBeTruthy();
    });
});

describe("依存先", () => {
    const dependency: TaskDependency = { task_id: "task-1", depends_on_task_id: "task-2", user_id: "user-1", created_at: "2026-08-13T00:00:00.000Z" };
    const base = task({ id: "task-1", title: "本体" });
    const other = task({ id: "task-2", title: "依存先タスク" });

    it("候補を選んで追加すると addDependency を呼ぶ", async () => {
        renderPane({ task: base, allTasks: [base, other] });
        fireEvent.change(screen.getByLabelText("追加する依存先タスク"), { target: { value: "task-2" } });
        fireEvent.click(screen.getByRole("button", { name: "追加" }));
        await waitFor(() => expect(addDependencyMock).toHaveBeenCalledWith({ taskId: "task-1", dependsOnTaskId: "task-2" }));
    });

    it("× で removeDependency を呼ぶ", async () => {
        renderPane({ task: base, allTasks: [base, other], dependencies: [dependency] });
        fireEvent.click(screen.getByRole("button", { name: "依存先タスク への依存を削除" }));
        await waitFor(() => expect(removeDependencyMock).toHaveBeenCalledWith({ taskId: "task-1", dependsOnTaskId: "task-2" }));
    });

    it("失敗したらコードに対応する日本語のエラーを出す", async () => {
        addDependencyMock.mockResolvedValue({ ok: false, code: "TASK_DEPENDENCY_CYCLE", message: "cycle" });
        renderPane({ task: base, allTasks: [base, other] });
        fireEvent.change(screen.getByLabelText("追加する依存先タスク"), { target: { value: "task-2" } });
        fireEvent.click(screen.getByRole("button", { name: "追加" }));
        expect(await screen.findByText("循環する依存は追加できません")).toBeTruthy();
    });

    it("候補の select での Esc は選択を破棄して一覧へフォーカスを戻す (「Esc = 確定」からの例外)", () => {
        const { onEscapeToOutline } = renderPane({ task: base, allTasks: [base, other] });
        const select = screen.getByLabelText("追加する依存先タスク");
        fireEvent.change(select, { target: { value: "task-2" } });
        fireEvent.keyDown(select, { key: "Escape" });
        expect((select as HTMLSelectElement).value).toBe("");
        expect(onEscapeToOutline).toHaveBeenCalledTimes(1);
        expect(addDependencyMock).not.toHaveBeenCalled();
    });
});

describe("タスクの切り替え", () => {
    it("別のタスクへ切り替わると編集中の下書きを破棄する", () => {
        const { rerenderWithTask } = renderPane();
        startEditing(2);
        fireEvent.change(screen.getByRole("textbox"), { target: { value: "破棄される下書き" } });
        rerenderWithTask(task({ id: "task-2", title: "次のタスク", description: "次の説明" }));
        expect(screen.queryByRole("textbox")).toBeNull();
        expect(screen.getByText("次の説明")).toBeTruthy();
    });

    it("別のタスクへ切り替わると依存先の選択とエラー表示も初期化する", async () => {
        addDependencyMock.mockResolvedValue({ ok: false, code: "TASK_DEPENDENCY_CYCLE", message: "cycle" });
        const base = task({ id: "task-1", title: "本体" });
        const other = task({ id: "task-2", title: "依存先タスク" });
        const { rerenderWithTask } = renderPane({ task: base, allTasks: [base, other] });
        fireEvent.change(screen.getByLabelText("追加する依存先タスク"), { target: { value: "task-2" } });
        fireEvent.click(screen.getByRole("button", { name: "追加" }));
        expect(await screen.findByText("循環する依存は追加できません")).toBeTruthy();
        rerenderWithTask(other);
        expect(screen.queryByText("循環する依存は追加できません")).toBeNull();
    });
});
