import { describe, expect, it } from "vitest";
import { formatDependencyError } from "@/features/task-detail/lib/dependency-error";

describe("formatDependencyError", () => {
    it("対応表にあるコードは日本語の文言へ変換する", () => {
        expect(formatDependencyError("TASK_NOT_FOUND")).toBe("対象のタスクが見つかりません");
        expect(formatDependencyError("TASK_DEPENDENCY_CYCLE")).toBe("循環する依存は追加できません");
        expect(formatDependencyError("DEPENDENCY_ALREADY_EXISTS")).toBe("その依存はすでに追加されています");
    });

    it("対応表にないコードは既定の文言にコードを添えて返す", () => {
        expect(formatDependencyError("TASK_BLOCKED")).toBe("依存関係の更新に失敗しました (TASK_BLOCKED)");
    });
});
