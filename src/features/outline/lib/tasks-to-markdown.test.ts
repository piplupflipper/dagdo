import { describe, expect, it } from "vitest";
import { tasksToMarkdown } from "@/features/outline/lib/tasks-to-markdown";
import type { AppTask } from "@/types/task";

/** 親子関係と並び順に効くカラムだけを指定してタスクを作る (残りは判定に関与しない固定値) */
const task = ({
    id,
    title = id,
    parentId = null,
    effectiveParentId,
    sortPath,
    completedAt = null,
}: {
    id: string;
    title?: string;
    parentId?: string | null;
    effectiveParentId?: string | null;
    sortPath: number[];
    completedAt?: string | null;
}): AppTask => ({
    id,
    user_id: "user-1",
    title,
    description: "",
    parent_id: parentId,
    effective_parent_id: effectiveParentId === undefined ? parentId : effectiveParentId,
    position: sortPath[sortPath.length - 1] ?? 0,
    sort_path: sortPath,
    due_date: null,
    is_blocked: false,
    completed_at: completedAt,
    created_at: "2026-08-28T00:00:00.000Z",
    updated_at: "2026-08-28T00:00:00.000Z",
});

describe("tasksToMarkdown", () => {
    it("タスクが無ければ空文字を返す", () => {
        expect(tasksToMarkdown([])).toBe("");
    });

    it("ルート直下の兄弟を sort_path 順の素の箇条書きにする", () => {
        expect(tasksToMarkdown([task({ id: "b", title: "後", sortPath: [1] }), task({ id: "a", title: "先", sortPath: [0] })])).toBe("- 先\n- 後");
    });

    it("effective_parent_id の階層を 4 スペースのインデントで表す", () => {
        const nested: readonly AppTask[] = [
            task({ id: "a", title: "親", sortPath: [0] }),
            task({ id: "a1", title: "子", parentId: "a", sortPath: [0, 0] }),
            task({ id: "a1a", title: "孫", parentId: "a1", sortPath: [0, 0, 0] }),
            task({ id: "b", title: "弟", sortPath: [1] }),
        ];
        expect(tasksToMarkdown(nested)).toBe("- 親\n    - 子\n        - 孫\n- 弟");
    });

    it("完了済みでもチェックボックス等は付けずタイトルだけ出す", () => {
        expect(tasksToMarkdown([task({ id: "done", title: "済", sortPath: [0], completedAt: "2026-08-28T00:00:00.000Z" })])).toBe("- 済");
    });

    it("削除済み祖先は effective_parent_id で透明化し、actual parent_id は見ない", () => {
        const tasks: readonly AppTask[] = [
            task({ id: "root", title: "残った親", sortPath: [0] }),
            task({ id: "child", title: "孫相当", parentId: "deleted", effectiveParentId: "root", sortPath: [0, 1, 0] }),
        ];
        expect(tasksToMarkdown(tasks)).toBe("- 残った親\n    - 孫相当");
    });
});
