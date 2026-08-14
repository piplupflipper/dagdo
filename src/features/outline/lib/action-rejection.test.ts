import { describe, expect, it, vi } from "vitest";
import { isActionRejection, runServerAction, toActionRejection } from "@/features/outline/lib/action-rejection";

const STALE_DEPLOYMENT_MESSAGE = "新しいバージョンが公開されています。ページを再読み込みしてください";
const TRANSPORT_FAILURE_MESSAGE = "サーバーとの通信に失敗しました。しばらくしてから再試行してください";

/** `next/navigation` の `unstable_isUnrecognizedActionError` が見る Error (name だけで判別できる) */
const unrecognizedActionError = (message: string): Error => {
    const error = new Error(message);
    error.name = "UnrecognizedActionError";
    return error;
};

describe("toActionRejection", () => {
    it("版ずれを表す Error から再読み込みを促す文言を組み立てる", () => {
        // Next.js 16.3.0 のサーバー側 (action-handler.js) が MPA action で throw する文言
        const reason = new Error("Failed to find Server Action. This request might be from an older or newer deployment.\nRead more: https://nextjs.org/docs/messages/failed-to-find-server-action");
        expect(toActionRejection(reason)).toEqual({ ok: false, rejected: true, message: STALE_DEPLOYMENT_MESSAGE });
    });

    it("fetch action の版ずれ (UnrecognizedActionError) も版ずれと判別する", () => {
        // 404 + x-nextjs-action-not-found を受けてクライアントのルーターが throw する Error。
        // message に「Failed to find Server Action」の語は含まれず、name と文書 URL で判別する
        const reason = unrecognizedActionError('Server Action "abc123" was not found on the server. \nRead more: https://nextjs.org/docs/messages/failed-to-find-server-action');
        expect(toActionRejection(reason).message).toBe(STALE_DEPLOYMENT_MESSAGE);
    });

    it("name だけが UnrecognizedActionError でも版ずれと判別する", () => {
        expect(toActionRejection(unrecognizedActionError("")).message).toBe(STALE_DEPLOYMENT_MESSAGE);
    });

    it("版ずれ以外の Error は再試行を促す文言にする", () => {
        expect(toActionRejection(new TypeError("Failed to fetch")).message).toBe(TRANSPORT_FAILURE_MESSAGE);
    });

    it("Error 以外の throw 値も失敗形へ変換する", () => {
        // 文字列は message として読む
        expect(toActionRejection("Failed to find Server Action").message).toBe(STALE_DEPLOYMENT_MESSAGE);
        expect(toActionRejection("boom").message).toBe(TRANSPORT_FAILURE_MESSAGE);
        // Error でも文字列でもない値は判別材料なしとして版ずれ以外へ倒す
        expect(toActionRejection(undefined).message).toBe(TRANSPORT_FAILURE_MESSAGE);
        expect(toActionRejection(null).message).toBe(TRANSPORT_FAILURE_MESSAGE);
        expect(toActionRejection({ message: "Failed to find Server Action" }).message).toBe(TRANSPORT_FAILURE_MESSAGE);
    });

    it("常に ok: false の失敗形を返す (TaskErrorCode は持たない)", () => {
        const rejection = toActionRejection(new Error("boom"));
        expect(rejection.ok).toBe(false);
        expect(rejection).not.toHaveProperty("code");
    });
});

describe("isActionRejection", () => {
    it("reject 由来の失敗と DB エラー契約の失敗を見分ける", () => {
        expect(isActionRejection(toActionRejection(new Error("boom")))).toBe(true);
        expect(isActionRejection({ ok: false, code: "TASK_BLOCKED", message: "task is blocked" })).toBe(false);
    });
});

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
        expect(outcome).toEqual({ ok: false, rejected: true, message: STALE_DEPLOYMENT_MESSAGE });
        // 文言は原因を 2 つに分けるだけで理由そのものは残らないため、切り分け用のログを出す
        expect(consoleError).toHaveBeenCalledTimes(1);
        consoleError.mockRestore();
    });

    it("同期的に throw する呼び出しも失敗形にする", async () => {
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const outcome = await runServerAction(() => {
            throw new Error("boom");
        });
        expect(outcome).toEqual({ ok: false, rejected: true, message: TRANSPORT_FAILURE_MESSAGE });
        consoleError.mockRestore();
    });
});
