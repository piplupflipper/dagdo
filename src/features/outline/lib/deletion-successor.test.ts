import { describe, expect, it } from "vitest";
import { findDeletionSuccessor } from "@/features/outline/lib/deletion-successor";

describe("findDeletionSuccessor", () => {
    it("中間行の削除は 1 つ下の行を返す", () => {
        expect(findDeletionSuccessor(["a", "b", "c"], "b")).toBe("c");
    });

    it("最終行の削除は 1 つ上の行を返す", () => {
        expect(findDeletionSuccessor(["a", "b", "c"], "c")).toBe("b");
    });

    it("唯一の行の削除は null を返す", () => {
        expect(findDeletionSuccessor(["a"], "a")).toBeNull();
    });

    it("対象が可視行に無ければ null を返す", () => {
        expect(findDeletionSuccessor(["a", "b"], "x")).toBeNull();
    });
});
