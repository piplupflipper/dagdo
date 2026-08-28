import { describe, expect, it } from "vitest";
import { isActionRejection, toActionRejection } from "@/features/task/lib/action-rejection";

const STALE_DEPLOYMENT_MESSAGE = "新しいバージョンが公開されています。ページを再読み込みしてください";
const TRANSPORT_FAILURE_MESSAGE = "サーバーとの通信に失敗しました。再試行しても直らない場合は、ページを再読み込みしてください";

/** `next/navigation` の `unstable_isUnrecognizedActionError` が判別する Error (name で見分けられる) */
const unrecognizedActionError = (message: string): Error => {
    const error = new Error(message);
    error.name = "UnrecognizedActionError";
    return error;
};

/** 注入する述語の代役。`unstable_isUnrecognizedActionError` と同じく `UnrecognizedActionError` だけを true にする */
const isUnrecognizedActionError = (reason: unknown): boolean => reason instanceof Error && reason.name === "UnrecognizedActionError";

describe("toActionRejection", () => {
    it("版ずれを表す Error から再読み込みを促す文言を組み立てる", () => {
        // Next.js 16.3.0 のサーバー側 (action-handler.js) が MPA action で throw する文言
        const reason = new Error("Failed to find Server Action. This request might be from an older or newer deployment.\nRead more: https://nextjs.org/docs/messages/failed-to-find-server-action");
        expect(toActionRejection(reason)).toEqual({ ok: false, rejected: true, message: STALE_DEPLOYMENT_MESSAGE, isVersionSkew: true });
    });

    it("fetch action の版ずれは message のマーカー (文書 URL) でも判別する", () => {
        // 404 + x-nextjs-action-not-found を受けてクライアントのルーターが throw する Error。
        // message に「Failed to find Server Action」の語は含まれず、文書 URL の側で拾う
        const reason = unrecognizedActionError('Server Action "abc123" was not found on the server. \nRead more: https://nextjs.org/docs/messages/failed-to-find-server-action');
        expect(toActionRejection(reason).message).toBe(STALE_DEPLOYMENT_MESSAGE);
    });

    it("版ずれ以外の Error は再試行と再読み込みを促す文言にする", () => {
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

    it("isVersionSkew は版ずれのときだけ true になる (Op キューの flusher が停止とリトライを分岐する材料)", () => {
        expect(toActionRejection(new Error("Failed to find Server Action")).isVersionSkew).toBe(true);
        expect(toActionRejection(new TypeError("Failed to fetch")).isVersionSkew).toBe(false);
    });
});

/**
 * 版ずれ判別の注入 (`run-server-action.ts` が `unstable_isUnrecognizedActionError` を渡す)
 *
 * 注入された述語と message のマーカーは択一ではなく併用する。
 * 前者だけでは MPA action の版ずれ (素の Error) を、後者だけでは Next.js が文言を変えたときの
 * fetch action の版ずれを取りこぼすためである
 */
describe("toActionRejection への述語の注入", () => {
    it("注入した述語が true なら、message にマーカーが無くても版ずれと判別する", () => {
        // Next.js が将来 message を変えた場合を模す (name だけが手掛かりに残る)
        const reason = unrecognizedActionError("this deployment does not know that action");
        expect(toActionRejection(reason).message).toBe(TRANSPORT_FAILURE_MESSAGE);
        expect(toActionRejection(reason, isUnrecognizedActionError).message).toBe(STALE_DEPLOYMENT_MESSAGE);
    });

    it("注入した述語が false でも、message のマーカーがあれば版ずれと判別する", () => {
        // 公式の述語は MPA action の素の Error を版ずれとは判別しない
        const reason = new Error("Failed to find Server Action. This request might be from an older or newer deployment.");
        expect(isUnrecognizedActionError(reason)).toBe(false);
        expect(toActionRejection(reason, isUnrecognizedActionError).message).toBe(STALE_DEPLOYMENT_MESSAGE);
    });

    it("述語もマーカーも当たらなければ版ずれ以外へ倒す", () => {
        expect(toActionRejection(new TypeError("Failed to fetch"), isUnrecognizedActionError).message).toBe(TRANSPORT_FAILURE_MESSAGE);
    });
});

describe("isActionRejection", () => {
    it("reject 由来の失敗と DB エラー契約の失敗を見分ける", () => {
        expect(isActionRejection(toActionRejection(new Error("boom")))).toBe(true);
        expect(isActionRejection({ ok: false, code: "TASK_BLOCKED", message: "task is blocked" })).toBe(false);
    });
});
