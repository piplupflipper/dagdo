import { act, cleanup, fireEvent, type RenderResult, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OutlineShell } from "@/features/outline/components/outline-shell";
import { resetOpQueueForTesting } from "@/features/outline/hooks/use-op-queue";
import type { OutlineOp } from "@/features/outline/lib/outline-ops";
import { useOutlineStore } from "@/store/outline-store";
import type { AppTask, TaskDependency } from "@/types/task";

/**
 * `OutlineShell` の配線の回帰テスト (Issue #34、write-behind 化は Issue #70)
 *
 * 網羅は狙わず、壊れやすい配線だけを確かめる。すなわち一覧が描けること、ヘッダのボタンが
 * ストアと繋がっていること、操作が「validate → apply → enqueue」のパイプラインを通って
 * 直列 Op キューから Server Action の振り分け (`callServerForOp`) へ流れること、
 * キューの失敗形 (版ずれ停止・防波堤ヒット) がステータス行へ届くことである。
 * Server Action は呼び出しの有無だけを見たいので、境界となるモジュールを差し替える
 */

const callServerForOpMock = vi.fn();
const routerRefreshMock = vi.fn();

vi.mock("@/features/outline/lib/dispatch-op", () => ({
    callServerForOp: (...args: unknown[]) => callServerForOpMock(...args),
}));
// reconcile トリガ (Issue #70) が useRouter().refresh() を打つため差し替える。
// run-server-action.ts が同モジュールの unstable_isUnrecognizedActionError を使うので、実体を残して useRouter だけを上書きする
vi.mock("next/navigation", async (importOriginal) => {
    const actual = await importOriginal<typeof import("next/navigation")>();
    return { ...actual, useRouter: () => ({ refresh: routerRefreshMock }) };
});
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

const renderShell = (initialDependencies: TaskDependency[] = []): RenderResult => render(<OutlineShell userId="user-1" initialTasks={tasks} initialDependencies={initialDependencies} />);

beforeEach(() => {
    // Op キューの実体はモジュールスコープのシングルトンであり、前のケースの停止フラグや未送信 Op が残るため毎回消す
    resetOpQueueForTesting();
    callServerForOpMock.mockResolvedValue({ ok: true, data: undefined });
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
    it("クライアント採番の id で create Op を流し、カーソルを即座にその id へ合わせる", async () => {
        renderShell();
        fireEvent.click(screen.getByRole("button", { name: "+ 新規タスク" }));

        await waitFor(() => expect(callServerForOpMock).toHaveBeenCalledWith({ type: "create", id: expect.any(String), title: "新規タスク", parentId: null, position: null }, expect.anything()));
        const createOp = callServerForOpMock.mock.calls[0]?.[0] as Extract<OutlineOp, { type: "create" }>;
        // id はクライアントが採番した実 PK であり、settle を待たずカーソルはこの id のまま動かない
        expect(useOutlineStore.getState().cursorTaskId).toBe(createOp.id);
    });

    /** `o` で作成し、create の送信を保留にしたまま `i` でタイトルを編集し始める。戻り値は送信を解決させる関数と編集中の input */
    const createAndStartEditing = async (): Promise<{ settle: () => Promise<void>; input: HTMLElement }> => {
        let resolveCreate: ((result: { ok: true; data: { id: string } }) => void) | undefined;
        callServerForOpMock.mockImplementation((op: OutlineOp) => {
            if (op.type === "create") {
                return new Promise((resolve) => (resolveCreate = resolve));
            }
            return Promise.resolve({ ok: true, data: undefined });
        });

        renderShell();
        fireEvent.click(screen.getByText("最初のタスク"));
        fireEvent.keyDown(document, { key: "o" });
        // 行は同期適用で即座に描かれる (createTask の応答は待たない)
        await act(async () => {});
        fireEvent.keyDown(document, { key: "i" });
        const input = screen.getByRole("textbox", { name: "タイトルを行内編集" });
        fireEvent.change(input, { target: { value: "編集中のタイトル" } });

        const settle = async (): Promise<void> => {
            await act(async () => {
                resolveCreate?.({ ok: true, data: { id: "unused" } });
            });
        };
        return { settle, input };
    };

    it("create の送信が終わる前に確定したタイトルも、直列キューが create の後に同じ id で送る", async () => {
        const { settle, input } = await createAndStartEditing();

        // 確定はキューに積まれるだけで、create が未完了の間は送信されない (in-flight は最大 1)
        fireEvent.keyDown(input, { key: "Enter" });
        expect(callServerForOpMock.mock.calls.filter(([op]) => (op as OutlineOp).type === "updateTitle")).toHaveLength(0);

        await settle();
        const createOp = callServerForOpMock.mock.calls[0]?.[0] as Extract<OutlineOp, { type: "create" }>;
        await waitFor(() => expect(callServerForOpMock).toHaveBeenCalledWith({ type: "updateTitle", taskId: createOp.id, title: "編集中のタイトル" }, expect.anything()));
    });

    it("create の送信中も行は同じ id のまま編集を続けられる (settle による付け替えが無い)", async () => {
        const { settle, input } = await createAndStartEditing();
        await settle();

        expect(screen.getByRole("textbox", { name: "タイトルを行内編集" })).toBe(input);
        expect(document.activeElement).toBe(input);
        expect(input).toHaveProperty("value", "編集中のタイトル");
    });
});

/**
 * 行内タイトル編集を開始する 4 キー (Issue #63)
 *
 * テーブル側の対応は `keymap-table.test.ts` が固定しているので、ここでは
 * 「キーを押すと実際に input が現れ、キャレットが指定の位置に置かれる」ところまでを通しで見る
 */
describe("行内タイトル編集のキー", () => {
    const cases: readonly { key: string; caret: number }[] = [
        { key: "i", caret: 0 },
        { key: "I", caret: 0 },
        { key: "a", caret: "最初のタスク".length },
        { key: "A", caret: "最初のタスク".length },
    ];

    for (const { key, caret } of cases) {
        it(`\`${key}\` はカーソル行のタイトルを行内編集し、キャレットを ${caret} に置く`, () => {
            renderShell();
            fireEvent.click(screen.getByText("最初のタスク"));
            fireEvent.keyDown(document, { key });

            const input = screen.getByRole("textbox", { name: "タイトルを行内編集" });
            expect(input).toHaveProperty("value", "最初のタスク");
            expect(input).toHaveProperty("selectionStart", caret);
            expect(document.activeElement).toBe(input);
        });
    }
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
 * 事前バリデーション (Issue #70)
 *
 * enqueue 前 (apply 前) に手元の一覧で判定し、失敗なら apply も送信も行わない。
 * `TASK_BLOCKED` は原因タスク名を含む日本語文言を出す (findBlockingCause による差し替え、現行踏襲)
 */
describe("事前バリデーション", () => {
    const blockedDependency: TaskDependency = { user_id: "user-1", task_id: "task-1", depends_on_task_id: "task-2", created_at: "2026-08-13T00:00:00.000Z" };

    it("blocked なタスクの完了は Server Action を呼ばず、原因タスク名を含む文言を出す", async () => {
        renderShell([blockedDependency]);
        fireEvent.click(screen.getAllByRole("button", { name: "完了を切替" })[0]);

        expect(await screen.findByText("TASK_BLOCKED — 次のタスク が未完了のため完了できません")).toBeTruthy();
        expect(callServerForOpMock).not.toHaveBeenCalled();
        // 楽観適用もしていない (チェックボックスは空のまま)
        expect(screen.getAllByRole("button", { name: "完了を切替" })[0]?.textContent).toBe("");
    });

    it("VISUAL の一括完了は validate を通過した分だけ送り、件数を出す", async () => {
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
        renderShell([blockedDependency]);

        fireEvent.click(screen.getByText("最初のタスク"));
        fireEvent.click(screen.getByRole("button", { name: "V ビジュアル" }));
        fireEvent.keyDown(document, { key: "x" });

        expect(await screen.findByText("1件中0件を完了")).toBeTruthy();
        expect(callServerForOpMock).not.toHaveBeenCalled();
        consoleError.mockRestore();
    });
});

/**
 * ドットリピート (Issue #74)
 *
 * 記述子とハンドラの対応は `repeat-command.test.ts`、記録対象のキーは `keymap-table.test.ts` が固定しているので、
 * ここでは「キー → 記録 → `.` による再発行」が実際の一覧の上で通ることと、レジスタの上書き規則
 * (弾かれた操作は上書きしない・空なら no-op) を通しで見る
 */
describe("ドットリピート", () => {
    /** 一覧に描かれた行の taskId を表示順で取り出す */
    const rowOrder = (): string[] => Array.from(document.querySelectorAll("[data-task-id]")).map((row) => row.getAttribute("data-task-id") ?? "");

    /** 3 行のフラットな一覧。`J` の繰り返しで並びの変化を追うために使う */
    const threeTasks: AppTask[] = [
        task({ id: "task-1", title: "一番目", sortPath: [0] }),
        task({ id: "task-2", title: "二番目", sortPath: [1] }),
        task({ id: "task-3", title: "三番目", sortPath: [2] }),
    ];

    it("`x` の後に `j` で移動して `.` を押すと、移動先の行が complete される", async () => {
        renderShell();
        fireEvent.click(screen.getByText("最初のタスク"));
        fireEvent.keyDown(document, { key: "x" });
        fireEvent.keyDown(document, { key: "j" });
        fireEvent.keyDown(document, { key: "." });

        await waitFor(() => expect(callServerForOpMock).toHaveBeenCalledWith({ type: "complete", taskId: "task-2" }, expect.anything()));
        // 両方の行が完了として描かれている
        expect(screen.getAllByRole("button", { name: "完了を切替" }).map((toggle) => toggle.textContent)).toEqual(["✓", "✓"]);
    });

    it("`J` の後の `.` はもう 1 つ下へ動かす (direction が保たれる)", () => {
        render(<OutlineShell userId="user-1" initialTasks={threeTasks} initialDependencies={[]} />);
        fireEvent.click(screen.getByText("一番目"));
        fireEvent.keyDown(document, { key: "J" });
        expect(rowOrder()).toEqual(["task-2", "task-1", "task-3"]);

        fireEvent.keyDown(document, { key: "." });
        expect(rowOrder()).toEqual(["task-2", "task-3", "task-1"]);
    });

    it("バリデーションで弾かれた操作 (blocked 行への `x`) はレジスタを上書きしない", async () => {
        // task-1 は未完了の task-3 に依存しており、complete が事前バリデーションで弾かれる
        const blockedDependency: TaskDependency = { user_id: "user-1", task_id: "task-1", depends_on_task_id: "task-3", created_at: "2026-08-13T00:00:00.000Z" };
        render(<OutlineShell userId="user-1" initialTasks={threeTasks} initialDependencies={[blockedDependency]} />);

        // `J` で reorder を記録した後、blocked 行への `x` が弾かれる
        fireEvent.click(screen.getByText("二番目"));
        fireEvent.keyDown(document, { key: "J" });
        expect(rowOrder()).toEqual(["task-1", "task-3", "task-2"]);
        // カーソル選択後はタイトルが詳細ペイン側にも現れるため、一覧 (listbox) の中の行を押す
        fireEvent.click(within(screen.getByRole("listbox", { name: "タスク一覧" })).getByText("一番目"));
        fireEvent.keyDown(document, { key: "x" });
        expect(await screen.findByText("TASK_BLOCKED — 三番目 が未完了のため完了できません")).toBeTruthy();

        // `.` は弾かれた complete ではなく、記録済みの reorder (下へ) を再発行する
        fireEvent.keyDown(document, { key: "." });
        expect(rowOrder()).toEqual(["task-3", "task-1", "task-2"]);
        expect(callServerForOpMock).not.toHaveBeenCalledWith({ type: "complete", taskId: "task-1" }, expect.anything());
    });

    it("レジスタが空のときの `.` は no-op", async () => {
        renderShell();
        fireEvent.click(screen.getByText("最初のタスク"));
        fireEvent.keyDown(document, { key: "." });

        await act(async () => {});
        expect(callServerForOpMock).not.toHaveBeenCalled();
        expect(rowOrder()).toEqual(["task-1", "task-2"]);
    });
});

/**
 * Op キューの失敗形 (Issue #70)
 *
 * write-behind のため、失敗してもクライアント正 state は巻き戻らない (表示は操作直後のまま)。
 * 版ずれは flusher の停止 + 再読み込みを促す文言、防波堤ヒットは残キュー破棄 + エラー文言で伝える
 */
describe("Op キューの失敗", () => {
    /** カーソル行のチェックボックス。完了が適用されていれば `✓` */
    const firstToggleLabel = (): string => screen.getAllByRole("button", { name: "完了を切替" })[0]?.textContent ?? "";

    it("版ずれの reject はステータス行へ再読み込みを促す文言を出し、クライアント状態は巻き戻さない", async () => {
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
        callServerForOpMock.mockRejectedValue(new Error("Failed to find Server Action. This request might be from an older or newer deployment."));
        renderShell();

        fireEvent.click(screen.getAllByRole("button", { name: "完了を切替" })[0]);

        expect(await screen.findByText("新しいバージョンが公開されています。ページを再読み込みしてください")).toBeTruthy();
        // クライアント正 state は正のまま (useOptimistic の巻き戻しは廃止)
        expect(firstToggleLabel()).toBe("✓");
        // flusher は停止しており、以降の操作を送信しない
        fireEvent.click(screen.getAllByRole("button", { name: "完了を切替" })[1]);
        await act(async () => {});
        expect(callServerForOpMock).toHaveBeenCalledTimes(1);
        consoleError.mockRestore();
    });

    it("`ok: false` (サーバー防波堤) は残キューを破棄してエラー文言を出す", async () => {
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
        callServerForOpMock.mockResolvedValue({ ok: false, code: "TASK_NOT_FOUND", message: "task not found" });
        renderShell();

        fireEvent.click(screen.getAllByRole("button", { name: "完了を切替" })[0]);

        expect(await screen.findByText("TASK_NOT_FOUND — task not found")).toBeTruthy();
        expect(firstToggleLabel()).toBe("✓");
        consoleError.mockRestore();
    });
});

/**
 * reconcile トリガと未同期表示 (Issue #70)
 *
 * キューが空になった瞬間と防波堤ヒットで残キューを破棄した直後に `router.refresh()` を打つ。
 * 未同期の Op がある間はステータス行に「未同期 N 件」を常設表示する
 */
describe("reconcile トリガと未同期表示", () => {
    it("キューが空になると router.refresh を打つ", async () => {
        renderShell();
        expect(routerRefreshMock).not.toHaveBeenCalled();

        fireEvent.click(screen.getAllByRole("button", { name: "完了を切替" })[0]);
        await waitFor(() => expect(routerRefreshMock).toHaveBeenCalledTimes(1));
    });

    it("防波堤ヒットで残キューを破棄した直後にも router.refresh を打つ", async () => {
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
        callServerForOpMock.mockResolvedValue({ ok: false, code: "TASK_NOT_FOUND", message: "task not found" });
        renderShell();

        fireEvent.click(screen.getAllByRole("button", { name: "完了を切替" })[0]);

        expect(await screen.findByText("TASK_NOT_FOUND — task not found")).toBeTruthy();
        expect(routerRefreshMock).toHaveBeenCalledTimes(1);
        consoleError.mockRestore();
    });

    it("unmount → 再マウントでも未同期件数を引き継ぐ (キューの実体はシングルトン)", async () => {
        // 送信を保留にして in-flight の 1 件を未同期のまま残す (/trash への遷移中も送信は続く想定)
        callServerForOpMock.mockImplementation(() => new Promise(() => undefined));
        const view = renderShell();
        fireEvent.click(screen.getAllByRole("button", { name: "完了を切替" })[0]);
        expect(await screen.findByText("未同期 1 件")).toBeTruthy();

        view.unmount();
        renderShell();
        expect(await screen.findByText("未同期 1 件")).toBeTruthy();
    });

    it("未同期の Op がある間はステータス行に件数を出し、送信が終わると消す", async () => {
        // 送信を保留にして in-flight の 1 件を未同期のまま残す
        let resolveComplete: ((result: { ok: true; data: undefined }) => void) | undefined;
        callServerForOpMock.mockImplementation(() => new Promise((resolve) => (resolveComplete = resolve)));
        renderShell();
        expect(screen.queryByText("未同期 1 件")).toBeNull();

        fireEvent.click(screen.getAllByRole("button", { name: "完了を切替" })[0]);
        expect(await screen.findByText("未同期 1 件")).toBeTruthy();

        await act(async () => {
            resolveComplete?.({ ok: true, data: undefined });
        });
        expect(screen.queryByText("未同期 1 件")).toBeNull();
    });
});

/**
 * reconcile ゲート (Issue #70)
 *
 * props (RSC 由来) の変化は「キューが空のときだけ」クライアント正 state へ採用する
 */
describe("reconcile ゲート", () => {
    const refreshedTasks: AppTask[] = [task({ id: "task-1", title: "サーバーで変わったタスク", sortPath: [0] }), task({ id: "task-2", title: "次のタスク", sortPath: [1] })];

    it("キューが空なら新しい props を採用する", async () => {
        const view = renderShell();
        view.rerender(<OutlineShell userId="user-1" initialTasks={refreshedTasks} initialDependencies={[]} />);
        expect(await screen.findByText("サーバーで変わったタスク")).toBeTruthy();
    });

    it("未同期の Op がある間は props を無視する", async () => {
        // 送信を保留にしてキューを空でなくしておく (complete が in-flight のまま残る)
        callServerForOpMock.mockImplementation(() => new Promise(() => undefined));
        const view = renderShell();
        fireEvent.click(screen.getAllByRole("button", { name: "完了を切替" })[0]);
        await act(async () => {});

        view.rerender(<OutlineShell userId="user-1" initialTasks={refreshedTasks} initialDependencies={[]} />);
        expect(screen.getByText("最初のタスク")).toBeTruthy();
        expect(screen.queryByText("サーバーで変わったタスク")).toBeNull();
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
