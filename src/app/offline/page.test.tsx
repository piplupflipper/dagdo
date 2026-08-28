import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import OfflinePage from "@/app/offline/page";
import { resetOpQueueForTesting } from "@/features/outline/hooks/use-op-queue";
import { OFFLINE_STORE_KEY, type OfflineSnapshot, serializeOfflineSnapshot } from "@/features/outline/lib/offline-store";
import { useOutlineStore } from "@/store/outline-store";
import type { AppTask } from "@/types/task";

/**
 * オフラインモード (/offline、Issue #81) の回帰テスト
 *
 * OutlineShell の配線の網羅は outline-shell.test.tsx が担うため、ここで固定するのはオフライン固有の
 * 3 点である。すなわち操作しても Server Action の振り分け (`callServerForOp`) と reconcile の refresh が
 * 一切呼ばれないこと、Op の適用が localStorage へ保存されること、リロード相当 (再マウント + 読み込み) で
 * 復元されること。あわせてオフラインで殺す UI (依存関係の節・ゴミ箱導線・ログアウト) の出し分けと、
 * 壊れた JSON で画面が死なないことも見る
 */

const callServerForOpMock = vi.fn();
const routerRefreshMock = vi.fn();

vi.mock("@/features/outline/lib/dispatch-op", () => ({
    callServerForOp: (...args: unknown[]) => callServerForOpMock(...args),
}));
// useOutlineMutations が useRouter を呼ぶため差し替える (オフラインでは refresh が呼ばれないことの検証にも使う)。
// run-server-action.ts が同モジュールの unstable_isUnrecognizedActionError を使うので、実体を残して useRouter だけを上書きする
vi.mock("next/navigation", async (importOriginal) => {
    const actual = await importOriginal<typeof import("next/navigation")>();
    return { ...actual, useRouter: () => ({ refresh: routerRefreshMock }) };
});
// 詳細ペインの依存追加・削除と、StatusLine のログアウト。オフラインでは描画しないが、
// 素の import が認証まわりのサーバー専用モジュールまで辿ってしまうため差し替える (outline-shell.test.tsx と同じ)
vi.mock("@/features/task/actions/add-dependency", () => ({ addDependency: vi.fn() }));
vi.mock("@/features/task/actions/remove-dependency", () => ({ removeDependency: vi.fn() }));
vi.mock("@/features/auth/actions/sign-out", () => ({ signOutAction: vi.fn() }));

// jsdom が備えないブラウザ API の穴埋め (outline-shell.test.tsx と同じ)
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

/** 一覧の並びに効くカラムだけを指定してタスクを作る (user_id はオフラインの固定 sentinel) */
const task = ({ id, title = id, sortPath }: { id: string; title?: string; sortPath: number[] }): AppTask => ({
    id,
    user_id: "offline",
    title,
    description: "",
    parent_id: null,
    effective_parent_id: null,
    position: sortPath[sortPath.length - 1] ?? 0,
    sort_path: sortPath,
    due_date: null,
    is_blocked: false,
    completed_at: null,
    created_at: "2026-08-28T00:00:00.000Z",
    updated_at: "2026-08-28T00:00:00.000Z",
});

/** localStorage へ保存済みのオフラインデータを直接読み出す (保存経路の検証用) */
const storedSnapshot = (): OfflineSnapshot => JSON.parse(storage.get(OFFLINE_STORE_KEY) ?? "") as OfflineSnapshot;

/** 保存済みデータを事前に仕込む (読み込み経路の検証用) */
const seedSnapshot = (snapshot: OfflineSnapshot): void => void storage.set(OFFLINE_STORE_KEY, serializeOfflineSnapshot(snapshot));

beforeEach(() => {
    storage.clear();
    resetOpQueueForTesting();
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

describe("永続化の差し替え", () => {
    it("新規タスクの作成は Server Action を呼ばず、localStorage へ user_id 'offline' で保存される", async () => {
        render(<OfflinePage />);
        fireEvent.click(screen.getByRole("button", { name: "+ 新規タスク" }));
        await act(async () => {});

        const saved = storedSnapshot();
        expect(saved.tasks).toHaveLength(1);
        expect(saved.tasks[0]?.title).toBe("新規タスク");
        expect(saved.tasks[0]?.user_id).toBe("offline");
        expect(saved.dependencies).toEqual([]);
        expect(callServerForOpMock).not.toHaveBeenCalled();
        expect(routerRefreshMock).not.toHaveBeenCalled();
    });

    it("完了の切り替えも Server Action を呼ばず、適用後の state が保存される", async () => {
        seedSnapshot({ tasks: [task({ id: "task-1", title: "保存済みタスク", sortPath: [0] })], dependencies: [] });
        render(<OfflinePage />);

        fireEvent.click(await screen.findByRole("button", { name: "完了を切替" }));
        await act(async () => {});

        expect(storedSnapshot().tasks[0]?.completed_at).not.toBeNull();
        expect(callServerForOpMock).not.toHaveBeenCalled();
        expect(routerRefreshMock).not.toHaveBeenCalled();
    });

    it("リロード相当 (再マウント + 読み込み) で作成したタスクが復元される", async () => {
        const view = render(<OfflinePage />);
        fireEvent.click(screen.getByRole("button", { name: "+ 新規タスク" }));
        await act(async () => {});
        view.unmount();

        render(<OfflinePage />);
        expect(await screen.findByText("新規タスク")).toBeTruthy();
    });

    it("壊れた JSON が保存されていても空データで描ける", async () => {
        storage.set(OFFLINE_STORE_KEY, "{ tasks: [");
        render(<OfflinePage />);
        await act(async () => {});

        expect(screen.getByRole("listbox", { name: "タスク一覧" })).toBeTruthy();
        expect(screen.getByText("0件 / blocked 0")).toBeTruthy();
    });
});

describe("オフラインで殺す機能", () => {
    it("ゴミ箱・ログアウトの導線を出さず、ログインへの導線を出す", async () => {
        render(<OfflinePage />);
        await act(async () => {});

        expect(screen.getByRole("link", { name: "ログインへ" })).toBeTruthy();
        expect(screen.queryByRole("link", { name: "ゴミ箱" })).toBeNull();
        expect(screen.queryByRole("button", { name: "ログアウト" })).toBeNull();
    });

    it("タスクを選択しても詳細ペインに依存関係の節を描かない", async () => {
        seedSnapshot({ tasks: [task({ id: "task-1", title: "保存済みタスク", sortPath: [0] })], dependencies: [] });
        render(<OfflinePage />);

        fireEvent.click(await screen.findByText("保存済みタスク"));
        expect(screen.queryByText("依存先")).toBeNull();
        expect(screen.queryByRole("combobox", { name: "追加する依存先タスク" })).toBeNull();
    });
});
