import { describe, expect, it } from "vitest";
import { dependsOnTasksOf } from "@/features/task/lib/depends-on-tasks";
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

const idsOf = (tasks: readonly AppTask[]): string[] => tasks.map((task) => task.id);

describe("dependsOnTasksOf", () => {
    it("依存先の実体を dependencies の並び順で返す", () => {
        const tasks = [task({ id: "a" }), task({ id: "first" }), task({ id: "second" })];
        const dependencies = [dependency("a", "first"), dependency("a", "second")];
        expect(idsOf(dependsOnTasksOf(tasks, dependencies, "a", { onlyIncomplete: false }))).toEqual(["first", "second"]);
    });

    it("依存が 1 件も無ければ空", () => {
        expect(dependsOnTasksOf([task({ id: "a" })], [], "a", { onlyIncomplete: false })).toEqual([]);
    });

    it("他タスクの依存は無視する", () => {
        const tasks = [task({ id: "a" }), task({ id: "b" }), task({ id: "blocker" })];
        expect(dependsOnTasksOf(tasks, [dependency("b", "blocker")], "a", { onlyIncomplete: false })).toEqual([]);
    });

    it("tasks に無い依存先 (ゴミ箱へ移動済み等) は落とす", () => {
        const tasks = [task({ id: "a" })];
        expect(dependsOnTasksOf(tasks, [dependency("a", "missing")], "a", { onlyIncomplete: false })).toEqual([]);
    });

    it("onlyIncomplete が false なら完了済みの依存先も返す", () => {
        const tasks = [task({ id: "a" }), task({ id: "done", completedAt: "2026-08-09T00:00:00.000Z" }), task({ id: "open" })];
        const dependencies = [dependency("a", "done"), dependency("a", "open")];
        expect(idsOf(dependsOnTasksOf(tasks, dependencies, "a", { onlyIncomplete: false }))).toEqual(["done", "open"]);
    });

    it("onlyIncomplete が true なら完了済みの依存先を落とす", () => {
        const tasks = [task({ id: "a" }), task({ id: "done", completedAt: "2026-08-09T00:00:00.000Z" }), task({ id: "open" })];
        const dependencies = [dependency("a", "done"), dependency("a", "open")];
        expect(idsOf(dependsOnTasksOf(tasks, dependencies, "a", { onlyIncomplete: true }))).toEqual(["open"]);
    });
});
