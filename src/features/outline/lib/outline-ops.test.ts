import { describe, expect, it } from "vitest";
import { applyOutlineOp, resolveReorderedSiblingIds } from "@/features/outline/lib/outline-ops";
import type { AppTask, TaskDependency } from "@/types/task";

/** 構造操作に効くカラムだけを指定してタスクを作る (残りは計算に関与しない固定値) */
const task = ({
    id,
    parentId = null,
    effectiveParentId = parentId,
    position = 0,
    sortPath = [position],
    completedAt = null,
}: {
    id: string;
    parentId?: string | null;
    effectiveParentId?: string | null;
    position?: number;
    sortPath?: number[];
    completedAt?: string | null;
}): AppTask => ({
    id,
    user_id: "user-1",
    title: id,
    description: "",
    parent_id: parentId,
    effective_parent_id: effectiveParentId,
    position,
    sort_path: sortPath,
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

describe("applyOutlineOp: sort_path の再計算", () => {
    it("ネストした行の sort_path は祖先の position を連結したものになる", () => {
        const tasks = [task({ id: "a", position: 0, sortPath: [0] }), task({ id: "b", parentId: "a", position: 0, sortPath: [0, 0] })];
        // b を a の下で 1 つ後ろへ reorder しても、他の兄弟が居ないので位置は変わらないが、
        // 独立した c を追加して b1 の sort_path が [a.position, b.position, b1.position] になることを見る
        const withGrandchild = [...tasks, task({ id: "b1", parentId: "b", position: 0, sortPath: [0, 0, 0] })];
        const result = applyOutlineOp(withGrandchild, [], { type: "reopen", taskId: "b1" });
        const map = byId(result);
        expect(map.get("b1")?.sort_path).toEqual([0, 0, 0]);
    });

    it("兄弟順が入れ替わると sort_path の末尾がそれに追従する (move で position が変わる)", () => {
        const tasks = [task({ id: "a", position: 0 }), task({ id: "b", position: 1 })];
        const result = applyOutlineOp(tasks, [], { type: "move", taskId: "a", newParentId: null, newPosition: 2 });
        const map = byId(result);
        // a: 旧グループ (parent=null) の隙間詰めで b が 0 へ、a 自身は新 position 2 (今回は同一グループなので詰め後 1 になるはず)
        // move_task の隙間詰め/隙間空けをそのまま適用すると b は 0、a は 2 → 最終的に a=1 (自グループ内移動なので隙間空け側の +1 は a 自身には効かない)
        expect(map.get("a")?.sort_path).toEqual([map.get("a")?.position]);
        expect(map.get("b")?.sort_path).toEqual([map.get("b")?.position]);
    });

    it("実 parent が削除済みで存在しない行は、直前の sort_path の祖先部分を引き継ぎつつ自分の position を反映する", () => {
        // a(0) -> b(0, 論理削除済みなので tasks には存在しない) -> c(0)。
        // c.sort_path は [a.position, b.position(=5), c.position] として既に正しく解決済みだったとする
        const tasks = [task({ id: "a", position: 0, sortPath: [0] }), task({ id: "c", parentId: "b", effectiveParentId: "a", position: 3, sortPath: [0, 5, 3] })];
        const result = applyOutlineOp(tasks, [], { type: "reopen", taskId: "c" });
        const c = byId(result).get("c");
        expect(c?.sort_path).toEqual([0, 5, 3]);
        expect(c?.effective_parent_id).toBe("a");
    });
});

describe("applyOutlineOp: softDelete 後の effective_parent_id (透明化)", () => {
    it("削除された行の直接の子は、削除された行自身が透明化していた先へ effective_parent_id が引き上がる", () => {
        // a(生存) -> b(削除対象) -> c。削除前は c.effective_parent_id === b
        const tasks = [task({ id: "a", position: 0 }), task({ id: "b", parentId: "a", effectiveParentId: "a", position: 0 }), task({ id: "c", parentId: "b", effectiveParentId: "b", position: 0 })];
        const result = applyOutlineOp(tasks, [], { type: "softDelete", taskId: "b" });
        expect(result.some((t) => t.id === "b")).toBe(false);
        expect(byId(result).get("c")?.effective_parent_id).toBe("a");
    });

    it("多段の削除でも、直前の削除で正しく引き上げられた値を土台にさらに正しく引き上がる", () => {
        // root -> mid1(削除済み) -> mid2 -> leaf。mid2 を削除すると leaf は root の直下へ透明化される
        const tasks = [
            task({ id: "root", position: 0 }),
            task({ id: "mid2", parentId: "mid1", effectiveParentId: "root", position: 0 }),
            task({ id: "leaf", parentId: "mid2", effectiveParentId: "mid2", position: 0 }),
        ];
        const result = applyOutlineOp(tasks, [], { type: "softDelete", taskId: "mid2" });
        expect(byId(result).get("leaf")?.effective_parent_id).toBe("root");
    });

    it("ルート直下の行が削除されると、直接の子の effective_parent_id は null (新たなルート) になる", () => {
        const tasks = [task({ id: "a", position: 0 }), task({ id: "b", parentId: "a", effectiveParentId: "a", position: 0 })];
        const result = applyOutlineOp(tasks, [], { type: "softDelete", taskId: "a" });
        expect(byId(result).get("b")?.effective_parent_id).toBeNull();
    });

    it("restore で行を戻すと、実 parent を持つ子の effective_parent_id が復元される", () => {
        const snapshot = task({ id: "b", parentId: "a", effectiveParentId: "a", position: 0 });
        const tasks = [task({ id: "a", position: 0 }), task({ id: "c", parentId: "b", effectiveParentId: "a", position: 0 })];
        const result = applyOutlineOp(tasks, [], { type: "restore", taskId: "b", snapshot });
        expect(result.some((t) => t.id === "b")).toBe(true);
        expect(byId(result).get("c")?.effective_parent_id).toBe("b");
    });
});

describe("applyOutlineOp: complete による依存先タスクの is_blocked 解除", () => {
    it("依存先を complete すると、依存元の is_blocked が false になる", () => {
        const tasks = [task({ id: "blocker", position: 0 }), task({ id: "blocked", position: 1 })];
        const deps = [dependency("blocked", "blocker")];
        const before = applyOutlineOp(tasks, deps, { type: "reopen", taskId: "blocker" });
        expect(byId(before).get("blocked")?.is_blocked).toBe(true);

        const after = applyOutlineOp(before, deps, { type: "complete", taskId: "blocker" });
        expect(byId(after).get("blocked")?.is_blocked).toBe(false);
        expect(byId(after).get("blocker")?.completed_at).not.toBeNull();
    });

    it("reopen すると再び is_blocked が true になる", () => {
        const tasks = [task({ id: "blocker", position: 0, completedAt: "2026-08-09T00:00:00.000Z" }), task({ id: "blocked", position: 1 })];
        const deps = [dependency("blocked", "blocker")];
        const result = applyOutlineOp(tasks, deps, { type: "reopen", taskId: "blocker" });
        expect(byId(result).get("blocked")?.is_blocked).toBe(true);
    });

    it("依存先が論理削除済み (ローカルに存在しない) 場合は blocked に数えない", () => {
        const tasks = [task({ id: "blocked", position: 0 })];
        const deps = [dependency("blocked", "missing-deleted-blocker")];
        const result = applyOutlineOp(tasks, deps, { type: "reopen", taskId: "blocked" });
        expect(byId(result).get("blocked")?.is_blocked).toBe(false);
    });

    it("すでに完了しているタスクは依存先が未完了でも is_blocked にならない", () => {
        const tasks = [task({ id: "blocker", position: 0 }), task({ id: "blocked", position: 1, completedAt: "2026-08-09T00:00:00.000Z" })];
        const deps = [dependency("blocked", "blocker")];
        const result = applyOutlineOp(tasks, deps, { type: "reopen", taskId: "blocker" });
        expect(byId(result).get("blocked")?.is_blocked).toBe(false);
    });
});

describe("applyOutlineOp: create の兄弟末尾/途中挿入", () => {
    it("position を省略すると兄弟グループの末尾に追加する", () => {
        const tasks = [task({ id: "a", position: 0 }), task({ id: "b", position: 1 })];
        const result = applyOutlineOp(tasks, [], { type: "create", tempId: "temp-1", title: "新規タスク", parentId: null, position: null });
        const created = byId(result).get("temp-1");
        expect(created?.position).toBe(2);
        expect(byId(result).get("a")?.position).toBe(0);
        expect(byId(result).get("b")?.position).toBe(1);
    });

    it("position を指定すると、その位置以降の兄弟を +1 ずらして割り込む", () => {
        const tasks = [task({ id: "a", position: 0 }), task({ id: "b", position: 1 }), task({ id: "c", position: 2 })];
        const result = applyOutlineOp(tasks, [], { type: "create", tempId: "temp-1", title: "新規タスク", parentId: null, position: 1 });
        const map = byId(result);
        expect(map.get("a")?.position).toBe(0);
        expect(map.get("temp-1")?.position).toBe(1);
        expect(map.get("b")?.position).toBe(2);
        expect(map.get("c")?.position).toBe(3);
    });

    it("親を指定すると子として作られ、他の親を持つ兄弟には影響しない", () => {
        const tasks = [task({ id: "parent", position: 0 }), task({ id: "child", parentId: "parent", position: 0 }), task({ id: "other-root", position: 1 })];
        const result = applyOutlineOp(tasks, [], { type: "create", tempId: "temp-1", title: "新規タスク", parentId: "parent", position: 0 });
        const map = byId(result);
        expect(map.get("temp-1")?.parent_id).toBe("parent");
        expect(map.get("temp-1")?.position).toBe(0);
        expect(map.get("child")?.position).toBe(1);
        expect(map.get("other-root")?.position).toBe(1);
    });

    it("tasks が 0 件のときは fallbackUserId を user_id として使う", () => {
        const result = applyOutlineOp([], [], { type: "create", tempId: "temp-1", title: "最初のタスク", parentId: null, position: null }, { fallbackUserId: "session-user" });
        expect(result[0]?.user_id).toBe("session-user");
        expect(result[0]?.position).toBe(0);
    });
});

describe("applyOutlineOp: reorder/move の位置詰め", () => {
    it("reorder は兄弟が占める position の集合を保ったまま順序だけ入れ替える (削除済み兄弟による欠番も保持する)", () => {
        // A(0) / B(1, 論理削除済みなので tasks には存在しない) / C(2) の兄弟グループ
        const tasks = [task({ id: "a", position: 0 }), task({ id: "c", position: 2 })];
        // c を rank 0 (先頭) へ
        const result = applyOutlineOp(tasks, [], { type: "reorder", taskId: "c", newPosition: 0 });
        const map = byId(result);
        // slot は [0, 2] のまま、順序だけ入れ替わる (欠番 1 は動かさない)
        expect(map.get("c")?.position).toBe(0);
        expect(map.get("a")?.position).toBe(2);
    });

    it("move は旧兄弟グループの隙間を詰め、新兄弟グループに隙間を空ける", () => {
        // root: a(0) b(1) c(2)。b を outdent 相当で newParentId=null, newPosition=1 へ移す想定のかわりに、
        // 明示的に newParentId を変えて子グループへ移す move を確認する
        const tasks = [task({ id: "a", position: 0 }), task({ id: "b", position: 1 }), task({ id: "c", position: 2 }), task({ id: "child-of-a", parentId: "a", position: 0 })];
        const result = applyOutlineOp(tasks, [], { type: "move", taskId: "b", newParentId: "a", newPosition: 1 });
        const map = byId(result);
        // 旧グループ (root) の隙間詰め: c は 2 -> 1
        expect(map.get("c")?.position).toBe(1);
        expect(map.get("a")?.position).toBe(0);
        // 新グループ (a の子) の隙間空け: child-of-a は 0 -> 変化なし (b の newPosition=1 は 0 の後ろなので詰め不要)
        expect(map.get("child-of-a")?.position).toBe(0);
        expect(map.get("b")?.parent_id).toBe("a");
        expect(map.get("b")?.position).toBe(1);
    });

    it("move で新グループの挿入位置より後ろの兄弟は +1 される", () => {
        const tasks = [task({ id: "parent", position: 0 }), task({ id: "x", parentId: "parent", position: 0 }), task({ id: "y", parentId: "parent", position: 1 }), task({ id: "moved", position: 1 })];
        const result = applyOutlineOp(tasks, [], { type: "move", taskId: "moved", newParentId: "parent", newPosition: 0 });
        const map = byId(result);
        expect(map.get("moved")?.position).toBe(0);
        expect(map.get("x")?.position).toBe(1);
        expect(map.get("y")?.position).toBe(2);
    });
});

describe("resolveReorderedSiblingIds", () => {
    it("対象を現在の rank から抜いて、新しい rank へ挿し直した順序を返す", () => {
        const tasks = [task({ id: "a", position: 0 }), task({ id: "b", position: 1 }), task({ id: "c", position: 2 })];
        expect(resolveReorderedSiblingIds(tasks, { taskId: "a", newPosition: 2 })).toEqual({ parentId: null, orderedTaskIds: ["b", "c", "a"] });
    });

    it("未知のタスクには null を返す", () => {
        const tasks = [task({ id: "a", position: 0 })];
        expect(resolveReorderedSiblingIds(tasks, { taskId: "unknown", newPosition: 0 })).toBeNull();
    });
});
