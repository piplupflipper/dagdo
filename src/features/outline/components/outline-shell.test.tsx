import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OutlineShell } from "@/features/outline/components/outline-shell";
import { useOutlineStore } from "@/store/outline-store";
import type { AppTask } from "@/types/task";

/**
 * `OutlineShell` を `useOutlineMutations` / `usePendingCreate` / `OutlineHeader` へ分割した際の回帰テスト (Issue #34)
 *
 * 網羅は狙わず、分割で壊れやすい配線だけを確かめる。すなわち一覧が描けること、ヘッダのボタンが
 * ストアと繋がっていること、`o` 相当の新規作成が tempId → 実id の付け替えまで通ること、
 * 行の操作が Op のパイプラインへ流れることである。
 * Server Action は呼び出しの有無だけを見たいので、境界となる 4 モジュールを差し替える
 */

const callServerForOpMock = vi.fn();
const createTaskMock = vi.fn();

vi.mock("@/features/outline/lib/dispatch-op", () => ({
    callServerForOp: (...args: unknown[]) => callServerForOpMock(...args),
}));
vi.mock("@/features/task/actions/create-task", () => ({
    createTask: (input: unknown) => createTaskMock(input),
}));
vi.mock("@/features/task/actions/complete-task", () => ({ completeTask: vi.fn() }));
vi.mock("@/features/task/actions/update-task", () => ({ updateTask: vi.fn() }));
// 詳細ペインの依存追加・削除と、StatusLine のログアウト。いずれも Server Action であり、
// 素の import は認証まわりのサーバー専用モジュールまで辿ってしまうため差し替える
vi.mock("@/features/task/actions/add-dependency", () => ({ addDependency: vi.fn() }));
vi.mock("@/features/task/actions/remove-dependency", () => ({ removeDependency: vi.fn() }));
vi.mock("@/features/auth/actions/sign-out", () => ({ signOutAction: vi.fn() }));

// jsdom が備えないブラウザ API の穴埋め。DependencyRail の依存線の再計算と、ペイン比率の保存に要る
class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);
const storage = new Map<string, string>();
Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
        getItem: (key: string): string | null => storage.get(key) ?? null,
        setItem: (key: string, value: string): void => void storage.set(key, value),
        removeItem: (key: string): void => void storage.delete(key),
        clear: (): void => storage.clear(),
    },
});

/** 一覧の並びに効くカラムだけを指定してタスクを作る (残りは判定に関与しない固定値) */
const task = ({ id, title = id, sortPath }: { id: string; title?: string; sortPath: number[] }): AppTask => ({
    id,
    user_id: "user-1",
    title,
    description: "",
    parent_id: null,
    effective_parent_id: null,
    position: sortPath[sortPath.length - 1] ?? 0,
    sort_path: sortPath,
    due_date: null,
    is_blocked: false,
    completed_at: null,
    created_at: "2026-08-13T00:00:00.000Z",
    updated_at: "2026-08-13T00:00:00.000Z",
});

const tasks: AppTask[] = [task({ id: "task-1", title: "最初のタスク", sortPath: [0] }), task({ id: "task-2", title: "次のタスク", sortPath: [1] })];

const renderShell = (): void => {
    render(<OutlineShell userId="user-1" initialTasks={tasks} initialDependencies={[]} />);
};

beforeEach(() => {
    callServerForOpMock.mockResolvedValue({ ok: true, data: undefined });
    createTaskMock.mockResolvedValue({ ok: true, data: { id: "real-1" } });
    useOutlineStore.setState({
        mode: "NORMAL",
        cursorTaskId: null,
        collapsedTaskIds: new Set<string>(),
        visualAnchorTaskId: null,
        visualSelectedTaskIds: new Set<string>(),
        searchQuery: "",
        flashTaskId: null,
        visibleTaskIds: [],
    });
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe("初期表示", () => {
    it("一覧とヘッダを描く", () => {
        renderShell();
        expect(screen.getByRole("listbox", { name: "タスク一覧" })).toBeTruthy();
        expect(screen.getByText("最初のタスク")).toBeTruthy();
        expect(screen.getByRole("button", { name: "+ 新規タスク" })).toBeTruthy();
    });
});

describe("ヘッダのボタン", () => {
    it("検索ボタンは SEARCH モードへ入る", () => {
        renderShell();
        fireEvent.click(screen.getByRole("button", { name: "/ で検索欄を開く" }));
        expect(useOutlineStore.getState().mode).toBe("SEARCH");
    });

    it("ビジュアルボタンはカーソル行を選択して VISUAL モードへ入り、もう一度押すと戻る", () => {
        renderShell();
        fireEvent.click(screen.getByText("最初のタスク"));
        const visualButton = screen.getByRole("button", { name: "V ビジュアル" });
        fireEvent.click(visualButton);
        expect(useOutlineStore.getState().mode).toBe("VISUAL");
        expect(Array.from(useOutlineStore.getState().visualSelectedTaskIds)).toEqual(["task-1"]);
        fireEvent.click(visualButton);
        expect(useOutlineStore.getState().mode).toBe("NORMAL");
    });
});

describe("新規タスク", () => {
    it("createTask を呼び、settle 後にカーソルを実 id へ付け替える", async () => {
        // 楽観行 (tempId) と settle 後の実 id を順に踏むので、最終値ではなく通過した値を記録して確かめる
        const cursorHistory: (string | null)[] = [];
        const unsubscribe = useOutlineStore.subscribe((state) => cursorHistory.push(state.cursorTaskId));
        renderShell();
        fireEvent.click(screen.getByRole("button", { name: "+ 新規タスク" }));
        await waitFor(() => expect(createTaskMock).toHaveBeenCalledWith({ title: "新規タスク", parentId: null, position: null }));
        await waitFor(() => expect(cursorHistory).toContain("real-1"));
        unsubscribe();
    });

    /**
     * settle から revalidate 到着までの窓 (Issue #60)
     *
     * `createTask` を保留にしたまま `o` → `i` と進め、編集中に解決させる。
     * Server Action を差し替えたこのテストではサーバー由来の一覧が更新されないため、
     * 「解決したが実 id の行がまだ現れていない」状態がそのまま再現できる。
     * 修正前はここで一覧から行が消え、ストアの clamp がカーソルを先頭行へ寄せ、
     * その移動が行内編集を畳んでフォーカスを body へ落としていた
     */
    it("作成直後にタイトルを編集していると、settle をまたいでもフォーカスと下書きが残る", async () => {
        let resolveCreate: ((result: { ok: true; data: { id: string } }) => void) | undefined;
        createTaskMock.mockImplementation(() => new Promise((resolve) => (resolveCreate = resolve)));

        renderShell();
        fireEvent.click(screen.getByText("最初のタスク"));
        fireEvent.keyDown(document, { key: "o" });
        // 楽観行が描かれるまで待つ (createTask は保留のまま)
        await act(async () => {});
        fireEvent.keyDown(document, { key: "i" });
        fireEvent.change(screen.getByRole("textbox", { name: "タイトルを行内編集" }), { target: { value: "編集中のタイトル" } });

        await act(async () => {
            resolveCreate?.({ ok: true, data: { id: "real-1" } });
        });

        const input = screen.getByRole("textbox", { name: "タイトルを行内編集" });
        expect(document.activeElement).toBe(input);
        expect(input).toHaveProperty("value", "編集中のタイトル");
        expect(useOutlineStore.getState().cursorTaskId).toBe("real-1");

        // 窓の中で確定したタイトルも実 id で保存へ流れる (行が一覧から消えていると tasksById で引けず、黙って捨てていた)
        fireEvent.keyDown(input, { key: "Enter" });
        await waitFor(() => expect(callServerForOpMock).toHaveBeenCalledWith({ type: "updateTitle", taskId: "real-1", title: "編集中のタイトル" }, expect.anything()));
    });
});

describe("行の操作", () => {
    it("完了の切り替えは complete Op を Server Action の振り分けへ流す", async () => {
        renderShell();
        fireEvent.click(screen.getAllByRole("button", { name: "完了を切替" })[0]);
        await waitFor(() => expect(callServerForOpMock).toHaveBeenCalledWith({ type: "complete", taskId: "task-1" }, expect.anything()));
    });

    it("`dd` はゴミ箱へ移す softDelete Op を流す", async () => {
        renderShell();
        fireEvent.click(screen.getByText("最初のタスク"));
        fireEvent.keyDown(document, { key: "d" });
        fireEvent.keyDown(document, { key: "d" });
        await waitFor(() => expect(callServerForOpMock).toHaveBeenCalledWith({ type: "softDelete", taskId: "task-1" }, expect.anything()));
    });
});

/**
 * カーソルと DOM のフォーカスのずれ (Issue #58)
 *
 * `Enter` → `Esc` の往復でフォーカスは行の要素に残る。その状態で `j` を押しても
 * ストアの `cursorTaskId` が動くだけだったため、フォーカスが元の行に取り残されていた。
 * キーは `document.activeElement` へ送る (document へ直接送ると行のローカルハンドラを通らず、
 * 本来の伝播順 = React の委譲リスナ → document のハンドラ、を再現できない)
 */
describe("カーソル行とフォーカスの追従", () => {
    /** カーソル行の `role="option"` 要素 (focusOutlineList と同じ探索対象) */
    const cursorRow = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-cursor="true"] [role="option"]');

    /** `Enter` で説明の編集領域を開き、`Esc` で確定して一覧へフォーカスを戻す */
    const editAndReturnToOutline = (): void => {
        fireEvent.keyDown(document.activeElement ?? document, { key: "Enter" });
        const editor = document.activeElement;
        expect(editor?.tagName).toBe("TEXTAREA");
        fireEvent.keyDown(editor ?? document, { key: "Escape" });
    };

    it("編集から戻った後の `j` でフォーカスもカーソル行へ移る", () => {
        renderShell();
        fireEvent.click(screen.getByText("最初のタスク"));
        editAndReturnToOutline();
        expect(document.activeElement).toBe(cursorRow());

        fireEvent.keyDown(document.activeElement ?? document, { key: "j" });
        expect(useOutlineStore.getState().cursorTaskId).toBe("task-2");
        expect(document.activeElement).toBe(cursorRow());
    });

    it("編集から戻り `j` で移った先の `Enter` が、元の行へカーソルを戻さない", () => {
        renderShell();
        fireEvent.click(screen.getByText("最初のタスク"));
        editAndReturnToOutline();
        fireEvent.keyDown(document.activeElement ?? document, { key: "j" });

        fireEvent.keyDown(document.activeElement ?? document, { key: "Enter" });
        expect(useOutlineStore.getState().cursorTaskId).toBe("task-2");
        expect(document.activeElement?.tagName).toBe("TEXTAREA");
    });
});
