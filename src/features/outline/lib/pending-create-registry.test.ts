import { describe, expect, it } from "vitest";
import { createPendingCreateRegistry, mergeSettledRows, pruneConfirmedRenames, queuePendingTitle, recordRename, takePendingTitle } from "@/features/outline/lib/pending-create-registry";
import { isSameLogicalRow } from "@/features/task/lib/temp-id-renames";
import type { AppTask } from "@/types/task";

/** 差し込みの判定に効くのは id だけなので、残りは固定値で埋める */
const row = (id: string, title = id): AppTask => ({
    id,
    user_id: "user-1",
    title,
    description: "",
    parent_id: null,
    effective_parent_id: null,
    position: 0,
    sort_path: [0],
    due_date: null,
    is_blocked: false,
    completed_at: null,
    created_at: "2026-08-13T00:00:00.000Z",
    updated_at: "2026-08-13T00:00:00.000Z",
});

describe("recordRename", () => {
    it("記録した対応は同一論理行の判定 (isSameLogicalRow) で引ける", () => {
        const registry = createPendingCreateRegistry();
        recordRename(registry, "temp-1", "real-1", undefined);
        expect(isSameLogicalRow(registry.renamedIds, "temp-1", "real-1")).toBe(true);
    });

    it("複数の create を独立に記録できる", () => {
        const registry = createPendingCreateRegistry();
        recordRename(registry, "temp-1", "real-1", undefined);
        recordRename(registry, "temp-2", "real-2", undefined);
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
        recordRename(registry, "temp-1", "real-1", undefined);
        pruneConfirmedRenames(registry, (realId) => realId === "real-1");
        expect(isSameLogicalRow(registry.renamedIds, "temp-1", "real-1")).toBe(false);
    });

    it("まだ存在が確認できない対応は残す", () => {
        const registry = createPendingCreateRegistry();
        recordRename(registry, "temp-1", "real-1", undefined);
        pruneConfirmedRenames(registry, () => false);
        expect(isSameLogicalRow(registry.renamedIds, "temp-1", "real-1")).toBe(true);
    });

    it("複数の対応のうち、確認できたものだけを取り除く", () => {
        const registry = createPendingCreateRegistry();
        recordRename(registry, "temp-1", "real-1", undefined);
        recordRename(registry, "temp-2", "real-2", undefined);
        pruneConfirmedRenames(registry, (realId) => realId === "real-1");
        expect(isSameLogicalRow(registry.renamedIds, "temp-1", "real-1")).toBe(false);
        expect(isSameLogicalRow(registry.renamedIds, "temp-2", "real-2")).toBe(true);
    });
});

describe("mergeSettledRows", () => {
    it("対応が無ければ一覧をそのまま返す", () => {
        const registry = createPendingCreateRegistry();
        const tasks = [row("task-1"), row("task-2")];
        expect(mergeSettledRows(tasks, registry)).toBe(tasks);
    });

    it("生きている tempId の楽観行を実 id 名義へ読み替える (settle 直後、楽観 op がまだ効いている間)", () => {
        const registry = createPendingCreateRegistry();
        recordRename(registry, "temp-1", "real-1", row("real-1", "新規タスク"));
        const merged = mergeSettledRows([row("task-1"), row("temp-1", "新規タスク")], registry);
        expect(merged.map((task) => task.id)).toEqual(["task-1", "real-1"]);
        expect(merged[1]?.title).toBe("新規タスク");
    });

    it("楽観行が捨てられた後はスナップショットで埋める (revalidate 到着前の窓)", () => {
        const registry = createPendingCreateRegistry();
        recordRename(registry, "temp-1", "real-1", row("real-1", "新規タスク"));
        const merged = mergeSettledRows([row("task-1")], registry);
        expect(merged.map((task) => task.id)).toEqual(["task-1", "real-1"]);
    });

    it("実 id の行が既に来ていれば、残っている tempId の楽観行を落として重複させない", () => {
        const registry = createPendingCreateRegistry();
        recordRename(registry, "temp-1", "real-1", row("real-1", "新規タスク"));
        const merged = mergeSettledRows([row("task-1"), row("real-1", "サーバー由来"), row("temp-1", "新規タスク")], registry);
        expect(merged.map((task) => task.id)).toEqual(["task-1", "real-1"]);
        expect(merged[1]?.title).toBe("サーバー由来");
    });

    it("スナップショットを預かっていない対応 (行の先読みに失敗した create) は埋めない", () => {
        const registry = createPendingCreateRegistry();
        recordRename(registry, "temp-1", "real-1", undefined);
        expect(mergeSettledRows([row("task-1")], registry).map((task) => task.id)).toEqual(["task-1"]);
    });

    it("剪定された対応はもう差し込まない", () => {
        const registry = createPendingCreateRegistry();
        recordRename(registry, "temp-1", "real-1", row("real-1", "新規タスク"));
        pruneConfirmedRenames(registry, (realId) => realId === "real-1");
        expect(mergeSettledRows([row("task-1")], registry).map((task) => task.id)).toEqual(["task-1"]);
    });
});
