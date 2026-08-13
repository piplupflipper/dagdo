import { describe, expect, it } from "vitest";
import { findBlockingCause } from "@/features/outline/lib/blocking-cause";
import type { AppTask, TaskDependency } from "@/types/task";

/** 判定に効くカラムだけを指定してタスクを作る (残りは計算に関与しない固定値) */
const task = ({ id, completedAt = null }: { id: string; completedAt?: string | null }): AppTask => ({
    id,
    user_id: "user-1",
    title: id,
    description: "",
    parent_id: null,
    effective_parent_id: null,
    position: 0,
    sort_path: [0],
    due_date: null,
    is_blocked: false,
    completed_at: completedAt,
    created_at: "2026-08-09T00:00:00.000Z",
    updated_at: "2026-08-09T00:00:00.000Z",
});

const dependency = (taskId: string, dependsOnTaskId: string): TaskDependency => ({
    user_id: "user-1",
    task_id: taskId,
    depends_on_task_id: dependsOnTaskId,
    created_at: "2026-08-09T00:00:00.000Z",
});

const byId = (tasks: readonly AppTask[]): Map<string, AppTask> => new Map(tasks.map((t) => [t.id, t]));

describe("findBlockingCause", () => {
    it("未完了の依存先を原因として返す", () => {
        const tasks = [task({ id: "a" }), task({ id: "blocker" })];
        expect(findBlockingCause("a", byId(tasks), [dependency("a", "blocker")])?.id).toBe("blocker");
    });

    it("依存先が完了済みなら原因ではない", () => {
        const tasks = [task({ id: "a" }), task({ id: "done", completedAt: "2026-08-09T00:00:00.000Z" })];
        expect(findBlockingCause("a", byId(tasks), [dependency("a", "done")])).toBeNull();
    });

    it("依存が 1 件も無ければ null", () => {
        const tasks = [task({ id: "a" })];
        expect(findBlockingCause("a", byId(tasks), [])).toBeNull();
    });

    it("他タスクの依存は無視する", () => {
        const tasks = [task({ id: "a" }), task({ id: "b" }), task({ id: "blocker" })];
        expect(findBlockingCause("a", byId(tasks), [dependency("b", "blocker")])).toBeNull();
    });

    it("依存先がタスク一覧に無い (ゴミ箱へ移動済み等) 場合は原因にしない", () => {
        const tasks = [task({ id: "a" })];
        expect(findBlockingCause("a", byId(tasks), [dependency("a", "missing")])).toBeNull();
    });

    it("未完了の依存先が複数あっても dependencies を走査して最初の 1 件だけを返す", () => {
        const tasks = [task({ id: "a" }), task({ id: "first" }), task({ id: "second" })];
        const dependencies = [dependency("a", "first"), dependency("a", "second")];
        expect(findBlockingCause("a", byId(tasks), dependencies)?.id).toBe("first");
    });

    it("完了済みの依存先を飛ばして未完了のものを探す", () => {
        const tasks = [task({ id: "a" }), task({ id: "done", completedAt: "2026-08-09T00:00:00.000Z" }), task({ id: "open" })];
        const dependencies = [dependency("a", "done"), dependency("a", "open")];
        expect(findBlockingCause("a", byId(tasks), dependencies)?.id).toBe("open");
    });
});
