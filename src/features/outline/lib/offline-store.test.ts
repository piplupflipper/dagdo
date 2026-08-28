import { describe, expect, it } from "vitest";
import { type OfflineSnapshot, parseOfflineSnapshot, serializeOfflineSnapshot } from "@/features/outline/lib/offline-store";
import type { AppTask, TaskDependency } from "@/types/task";

/** 検証対象のカラムをすべて埋めたタスク (id 以外は固定値) */
const task = (id: string): AppTask => ({
    id,
    user_id: "offline",
    title: `タスク ${id}`,
    description: "",
    parent_id: null,
    effective_parent_id: null,
    position: 0,
    sort_path: [0],
    due_date: null,
    is_blocked: false,
    completed_at: null,
    created_at: "2026-08-28T00:00:00.000Z",
    updated_at: "2026-08-28T00:00:00.000Z",
});

const dependency: TaskDependency = { user_id: "offline", task_id: "task-1", depends_on_task_id: "task-2", created_at: "2026-08-28T00:00:00.000Z" };

const emptySnapshot: OfflineSnapshot = { tasks: [], dependencies: [] };

describe("serializeOfflineSnapshot / parseOfflineSnapshot", () => {
    it("シリアライズした文字列をパースすると元のデータへ戻る (往復)", () => {
        const snapshot: OfflineSnapshot = { tasks: [task("task-1"), task("task-2")], dependencies: [dependency] };
        expect(parseOfflineSnapshot(serializeOfflineSnapshot(snapshot))).toEqual(snapshot);
    });

    it("空データも往復できる", () => {
        expect(parseOfflineSnapshot(serializeOfflineSnapshot(emptySnapshot))).toEqual(emptySnapshot);
    });
});

describe("parseOfflineSnapshot のフォールバック", () => {
    it("未保存 (null) は空データ", () => {
        expect(parseOfflineSnapshot(null)).toEqual(emptySnapshot);
    });

    it("壊れた JSON は空データ", () => {
        expect(parseOfflineSnapshot("{ tasks: [")).toEqual(emptySnapshot);
    });

    it("オブジェクト以外の JSON (数値・配列・null) は空データ", () => {
        expect(parseOfflineSnapshot("42")).toEqual(emptySnapshot);
        expect(parseOfflineSnapshot("[]")).toEqual(emptySnapshot);
        expect(parseOfflineSnapshot("null")).toEqual(emptySnapshot);
    });

    it("tasks / dependencies が配列でない場合は空データ", () => {
        expect(parseOfflineSnapshot(JSON.stringify({ tasks: {}, dependencies: [] }))).toEqual(emptySnapshot);
        expect(parseOfflineSnapshot(JSON.stringify({ tasks: [] }))).toEqual(emptySnapshot);
    });

    it("タスクのスキーマ不一致 (型違い・欠落) は 1 件でもあれば空データ", () => {
        const titleIsNumber = { ...task("task-1"), title: 1 };
        expect(parseOfflineSnapshot(JSON.stringify({ tasks: [titleIsNumber], dependencies: [] }))).toEqual(emptySnapshot);

        const { sort_path: _removed, ...missingSortPath } = task("task-1");
        expect(parseOfflineSnapshot(JSON.stringify({ tasks: [task("task-2"), missingSortPath], dependencies: [] }))).toEqual(emptySnapshot);

        const sortPathHasString = { ...task("task-1"), sort_path: [0, "1"] };
        expect(parseOfflineSnapshot(JSON.stringify({ tasks: [sortPathHasString], dependencies: [] }))).toEqual(emptySnapshot);
    });

    it("依存関係のスキーマ不一致は空データ", () => {
        expect(parseOfflineSnapshot(JSON.stringify({ tasks: [task("task-1")], dependencies: [{ task_id: "task-1" }] }))).toEqual(emptySnapshot);
    });
});
