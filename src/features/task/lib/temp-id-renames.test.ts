import { describe, expect, it } from "vitest";
import { isSameLogicalRow } from "@/features/task/lib/temp-id-renames";

describe("isSameLogicalRow", () => {
    const renamedIds = new Map([
        ["temp-1", "real-1"],
        ["temp-2", "real-2"],
    ]);

    it("記録済みの tempId → 実id への変化は同一論理行と判定する", () => {
        expect(isSameLogicalRow(renamedIds, "temp-1", "real-1")).toBe(true);
        expect(isSameLogicalRow(renamedIds, "temp-2", "real-2")).toBe(true);
    });

    it("記録の無い変化 (別の行への移動) は同一論理行と判定しない", () => {
        expect(isSameLogicalRow(renamedIds, "real-1", "other-task")).toBe(false);
        expect(isSameLogicalRow(renamedIds, "temp-1", "other-task")).toBe(false);
        expect(isSameLogicalRow(renamedIds, "temp-1", "real-2")).toBe(false);
    });

    it("付け替えの向きは逆にはたどらない", () => {
        expect(isSameLogicalRow(renamedIds, "real-1", "temp-1")).toBe(false);
    });

    it("previousId / nextId のいずれかが null なら同一論理行ではない", () => {
        expect(isSameLogicalRow(renamedIds, null, "real-1")).toBe(false);
        expect(isSameLogicalRow(renamedIds, "temp-1", null)).toBe(false);
        expect(isSameLogicalRow(renamedIds, null, null)).toBe(false);
    });
});
