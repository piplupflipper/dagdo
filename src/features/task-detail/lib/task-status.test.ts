import { describe, expect, it } from "vitest";
import { resolveStatus } from "@/features/task-detail/lib/task-status";

describe("resolveStatus", () => {
    it("completed_at があれば done を返す", () => {
        expect(resolveStatus({ completedAt: "2026-08-13T00:00:00.000Z", isBlocked: false })).toBe("done");
    });

    it("完了済みなら is_blocked より done を優先する", () => {
        expect(resolveStatus({ completedAt: "2026-08-13T00:00:00.000Z", isBlocked: true })).toBe("done");
    });

    it("未完了で is_blocked なら blocked を返す", () => {
        expect(resolveStatus({ completedAt: null, isBlocked: true })).toBe("blocked");
    });

    it("未完了でブロックされていなければ ready を返す", () => {
        expect(resolveStatus({ completedAt: null, isBlocked: false })).toBe("ready");
    });
});
