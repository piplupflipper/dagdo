import { describe, expect, it } from "vitest";
import { resolveCaretRange } from "@/features/outline/lib/inline-title-edit";

describe("resolveCaretRange", () => {
    it("`i` (start) はキャレットを先頭へ置く", () => {
        expect(resolveCaretRange({ caret: "start", valueLength: 5 })).toEqual({ start: 0, end: 0 });
    });

    it("`A` (end) はキャレットを末尾へ置く", () => {
        expect(resolveCaretRange({ caret: "end", valueLength: 5 })).toEqual({ start: 5, end: 5 });
    });

    it("いずれも選択範囲を持たない (vim の i / A に倣い全選択にはしない)", () => {
        for (const caret of ["start", "end"] as const) {
            const { start, end } = resolveCaretRange({ caret, valueLength: 3 });
            expect(start, caret).toBe(end);
        }
    });

    it("空タイトルではどちらも 0 になる", () => {
        expect(resolveCaretRange({ caret: "start", valueLength: 0 })).toEqual({ start: 0, end: 0 });
        expect(resolveCaretRange({ caret: "end", valueLength: 0 })).toEqual({ start: 0, end: 0 });
    });
});
