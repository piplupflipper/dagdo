import { describe, expect, it } from "vitest";
import { createPendingCreateRegistry, pruneConfirmedRenames, queuePendingTitle, recordRename, resolveRenamedLookup, takePendingTitle } from "@/features/outline/lib/pending-create-registry";
import { isSameLogicalRow } from "@/features/task/lib/temp-id-renames";

describe("recordRename", () => {
    it("記録した対応は同一論理行の判定 (isSameLogicalRow) で引ける", () => {
        const registry = createPendingCreateRegistry();
        recordRename(registry, "temp-1", "real-1");
        expect(isSameLogicalRow(registry.renamedIds, "temp-1", "real-1")).toBe(true);
    });

    it("複数の create を独立に記録できる", () => {
        const registry = createPendingCreateRegistry();
        recordRename(registry, "temp-1", "real-1");
        recordRename(registry, "temp-2", "real-2");
        expect(isSameLogicalRow(registry.renamedIds, "temp-1", "real-1")).toBe(true);
        expect(isSameLogicalRow(registry.renamedIds, "temp-2", "real-2")).toBe(true);
        expect(isSameLogicalRow(registry.renamedIds, "temp-1", "real-2")).toBe(false);
    });
});

describe("queuePendingTitle / takePendingTitle", () => {
    it("キューされたタイトルを取り出せる", () => {
        const registry = createPendingCreateRegistry();
        queuePendingTitle(registry, "temp-1", "新しいタイトル");
        expect(takePendingTitle(registry, "temp-1")).toBe("新しいタイトル");
    });

    it("取り出すとキューから消費され、二重に取り出せない", () => {
        const registry = createPendingCreateRegistry();
        queuePendingTitle(registry, "temp-1", "新しいタイトル");
        takePendingTitle(registry, "temp-1");
        expect(takePendingTitle(registry, "temp-1")).toBeUndefined();
    });

    it("キューが無ければ undefined を返す (create の title のままでよいケース)", () => {
        const registry = createPendingCreateRegistry();
        expect(takePendingTitle(registry, "temp-1")).toBeUndefined();
    });

    it("同一 tempId への再キューは最新の 1 件で上書きする (settle 前に複数回確定した場合)", () => {
        const registry = createPendingCreateRegistry();
        queuePendingTitle(registry, "temp-1", "1回目");
        queuePendingTitle(registry, "temp-1", "2回目");
        expect(takePendingTitle(registry, "temp-1")).toBe("2回目");
    });

    it("異なる tempId のキューは互いに独立している", () => {
        const registry = createPendingCreateRegistry();
        queuePendingTitle(registry, "temp-1", "タイトルA");
        queuePendingTitle(registry, "temp-2", "タイトルB");
        expect(takePendingTitle(registry, "temp-1")).toBe("タイトルA");
        expect(takePendingTitle(registry, "temp-2")).toBe("タイトルB");
    });
});

describe("pruneConfirmedRenames", () => {
    it("実 id の行が存在すると確認できた対応を取り除く", () => {
        const registry = createPendingCreateRegistry();
        recordRename(registry, "temp-1", "real-1");
        pruneConfirmedRenames(registry, (realId) => realId === "real-1");
        expect(isSameLogicalRow(registry.renamedIds, "temp-1", "real-1")).toBe(false);
    });

    it("まだ存在が確認できない対応は残す", () => {
        const registry = createPendingCreateRegistry();
        recordRename(registry, "temp-1", "real-1");
        pruneConfirmedRenames(registry, () => false);
        expect(isSameLogicalRow(registry.renamedIds, "temp-1", "real-1")).toBe(true);
    });

    it("複数の対応のうち、確認できたものだけを取り除く", () => {
        const registry = createPendingCreateRegistry();
        recordRename(registry, "temp-1", "real-1");
        recordRename(registry, "temp-2", "real-2");
        pruneConfirmedRenames(registry, (realId) => realId === "real-1");
        expect(isSameLogicalRow(registry.renamedIds, "temp-1", "real-1")).toBe(false);
        expect(isSameLogicalRow(registry.renamedIds, "temp-2", "real-2")).toBe(true);
    });
});

describe("resolveRenamedLookup", () => {
    it("直接見つかればそれを返す (フォールバックは使わない)", () => {
        const byId = new Map([["real-1", { id: "real-1", title: "本体" }]]);
        const renamedIds = new Map([["temp-1", "real-1"]]);
        const result = resolveRenamedLookup(byId, renamedIds, "real-1", (value, id) => ({ ...value, id }));
        expect(result).toEqual({ id: "real-1", title: "本体" });
    });

    it("直接見つからず、対応表に実id への記録があれば tempId 側の値を実id 名義で返す", () => {
        const byId = new Map([["temp-1", { id: "temp-1", title: "新規タスク" }]]);
        const renamedIds = new Map([["temp-1", "real-1"]]);
        const result = resolveRenamedLookup(byId, renamedIds, "real-1", (value, id) => ({ ...value, id }));
        expect(result).toEqual({ id: "real-1", title: "新規タスク" });
    });

    it("対応表にも tempId 側にも無ければ undefined を返す", () => {
        const byId = new Map<string, { id: string; title: string }>();
        const renamedIds = new Map([["temp-1", "real-1"]]);
        const result = resolveRenamedLookup(byId, renamedIds, "real-1", (value, id) => ({ ...value, id }));
        expect(result).toBeUndefined();
    });

    it("id が対応表に一切関係なければ undefined を返す", () => {
        const byId = new Map([["temp-1", { id: "temp-1", title: "新規タスク" }]]);
        const renamedIds = new Map<string, string>();
        const result = resolveRenamedLookup(byId, renamedIds, "unrelated-id", (value, id) => ({ ...value, id }));
        expect(result).toBeUndefined();
    });
});
