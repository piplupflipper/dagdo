import { describe, expect, it, vi } from "vitest";
import { runServerAction } from "@/features/task/lib/run-server-action";

const STALE_DEPLOYMENT_MESSAGE = "新しいバージョンが公開されています。ページを再読み込みしてください";
const TRANSPORT_FAILURE_MESSAGE = "サーバーとの通信に失敗しました。再試行しても直らない場合は、ページを再読み込みしてください";

describe("runServerAction", () => {
    it("Server Action が値を返せばそのまま通す", async () => {
        await expect(runServerAction(() => Promise.resolve({ ok: true, data: { id: "task-1" } } as const))).resolves.toEqual({ ok: true, data: { id: "task-1" } });
        await expect(runServerAction(() => Promise.resolve({ ok: false, code: "TASK_BLOCKED", message: "task is blocked" } as const))).resolves.toEqual({
            ok: false,
            code: "TASK_BLOCKED",
            message: "task is blocked",
        });
    });

    it("reject を捕まえて失敗形の値にする (呼び出し元へ例外を投げない)", async () => {
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const outcome = await runServerAction(() => Promise.reject(new Error("Failed to find Server Action.")));
        expect(outcome).toEqual({ ok: false, rejected: true, message: STALE_DEPLOYMENT_MESSAGE, isVersionSkew: true });
        // 文言は原因を 2 つに分けるだけで理由そのものは残らないため、切り分け用のログを出す
        expect(consoleError).toHaveBeenCalledTimes(1);
        consoleError.mockRestore();
    });

    it("同期的に throw する呼び出しも失敗形にする", async () => {
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const outcome = await runServerAction(() => {
            throw new Error("boom");
        });
        expect(outcome).toEqual({ ok: false, rejected: true, message: TRANSPORT_FAILURE_MESSAGE, isVersionSkew: false });
        consoleError.mockRestore();
    });

    /**
     * 公式の述語 (`next/navigation` の `unstable_isUnrecognizedActionError`) が注入されていること
     *
     * この Error は message にマーカーを持たないため、注入が外れると版ずれと判別できなくなる。
     * `UnrecognizedActionError` は next 内部のクラスであり、テストからは同名の Error を作って
     * `instanceof` の代わりに `name` で判別される経路を踏めないため、ここでは
     * next が export する述語そのものを通した結果を見る
     */
    it("公式の述語を注入している (fetch action の版ずれを message のマーカー無しで判別する)", async () => {
        const { UnrecognizedActionError } = await import("next/dist/client/components/unrecognized-action-error");
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const outcome = await runServerAction(() => Promise.reject(new UnrecognizedActionError("this deployment does not know that action")));
        expect(outcome).toEqual({ ok: false, rejected: true, message: STALE_DEPLOYMENT_MESSAGE, isVersionSkew: true });
        consoleError.mockRestore();
    });
});
