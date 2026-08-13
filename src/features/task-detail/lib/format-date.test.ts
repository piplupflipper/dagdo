import { afterEach, describe, expect, it, vi } from "vitest";
import { formatDate, formatDateTime, isOverdue } from "@/features/task-detail/lib/format-date";

describe("formatDate", () => {
    it("Asia/Tokyo の年月日へ整形する", () => {
        expect(formatDate("2026-08-13")).toBe("2026/08/13");
    });

    it("UTC 深夜は Asia/Tokyo では翌日になる", () => {
        expect(formatDate("2026-08-13T15:30:00.000Z")).toBe("2026/08/14");
    });
});

describe("formatDateTime", () => {
    it("Asia/Tokyo の年月日と時刻へ整形する", () => {
        expect(formatDateTime("2026-08-13T00:00:00.000Z")).toBe("2026/08/13 09:00");
    });
});

describe("isOverdue", () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    /** Asia/Tokyo で 2026-08-13 の昼にあたる時刻に固定する */
    const freezeAt = (iso: string): void => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(iso));
    };

    it("今日より前の期日は期限切れ", () => {
        freezeAt("2026-08-13T03:00:00.000Z");
        expect(isOverdue("2026-08-12")).toBe(true);
    });

    it("今日の期日は期限切れではない", () => {
        freezeAt("2026-08-13T03:00:00.000Z");
        expect(isOverdue("2026-08-13")).toBe(false);
    });

    it("今日より後の期日は期限切れではない", () => {
        freezeAt("2026-08-13T03:00:00.000Z");
        expect(isOverdue("2026-08-14")).toBe(false);
    });

    it("「今日」は実行環境のタイムゾーンではなく Asia/Tokyo で判定する", () => {
        // UTC では 2026-08-13 だが Asia/Tokyo では既に 2026-08-14 なので、2026-08-13 は期限切れになる
        freezeAt("2026-08-13T16:00:00.000Z");
        expect(isOverdue("2026-08-13")).toBe(true);
    });
});
