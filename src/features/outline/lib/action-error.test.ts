import { describe, expect, it } from "vitest";
import { formatActionError, formatOutcomeError, formatTaskError } from "@/features/outline/lib/action-error";
import { toActionRejection } from "@/features/task/lib/action-rejection";
import type { TaskErrorCode } from "@/features/task/lib/action-result";

const ALL_CODES: readonly TaskErrorCode[] = ["TASK_NOT_FOUND", "TASK_PARENT_CYCLE", "TASK_DEPENDENCY_CYCLE", "TASK_BLOCKED", "DEPENDENCY_ALREADY_EXISTS", "INVALID_POSITION", "INVALID_PARENT"];

describe("formatTaskError", () => {
    it("記号名と本文を全角ダッシュで繋いだ 1 行にする", () => {
        expect(formatTaskError("TASK_BLOCKED", "設計 が未完了のため完了できません")).toBe("TASK_BLOCKED — 設計 が未完了のため完了できません");
    });

    it("表示専用の連番 (旧 E1000〜E1006) を前置しない", () => {
        for (const code of ALL_CODES) {
            expect(formatTaskError(code, "message")).not.toMatch(/E10\d\d/);
        }
    });

    it("全 TaskErrorCode で記号名がそのまま先頭に出る", () => {
        for (const code of ALL_CODES) {
            expect(formatTaskError(code, "message").startsWith(`${code} — `)).toBe(true);
        }
    });
});

describe("formatActionError", () => {
    it("ActionResult の失敗形から code と message を取り出して組み立てる", () => {
        expect(formatActionError({ ok: false, code: "INVALID_POSITION", message: "position out of range" })).toBe("INVALID_POSITION — position out of range");
    });

    it("formatTaskError と同じ形を返す (TASK_BLOCKED の分岐と表示が食い違わない)", () => {
        const result = { ok: false, code: "TASK_BLOCKED", message: "task is blocked" } as const;
        expect(formatActionError(result)).toBe(formatTaskError(result.code, result.message));
    });

    it("message が空でも記号名とダッシュは残る", () => {
        expect(formatActionError({ ok: false, code: "TASK_NOT_FOUND", message: "" })).toBe("TASK_NOT_FOUND — ");
    });
});

describe("formatOutcomeError", () => {
    it("DB エラー契約の失敗は formatActionError と同じ形にする", () => {
        expect(formatOutcomeError({ ok: false, code: "INVALID_POSITION", message: "position out of range" })).toBe("INVALID_POSITION — position out of range");
    });

    it("reject 由来の失敗は TaskErrorCode の記号名を前置しない", () => {
        const rejection = toActionRejection(new Error("Failed to find Server Action."));
        expect(formatOutcomeError(rejection)).toBe("新しいバージョンが公開されています。ページを再読み込みしてください");
        for (const code of ALL_CODES) {
            expect(formatOutcomeError(rejection).startsWith(code)).toBe(false);
        }
    });

    it("版ずれ以外の reject も記号名なしの日本語文言で出す", () => {
        expect(formatOutcomeError(toActionRejection(new TypeError("Failed to fetch")))).toBe("サーバーとの通信に失敗しました。再試行しても直らない場合は、ページを再読み込みしてください");
    });
});
