import type { TaskErrorCode } from "@/features/task/lib/action-result";

/**
 * 依存の追加・削除で起こり得るエラーコードに対応する UI 表示用の日本語文言
 *
 * ActionResult の message は英語のログ用文言であり (action-result.ts)、UI 表示用の日本語は呼び出し側が code から組み立てる
 */
const DEPENDENCY_ERROR_MESSAGE: Partial<Record<TaskErrorCode, string>> = {
    TASK_NOT_FOUND: "対象のタスクが見つかりません",
    TASK_DEPENDENCY_CYCLE: "循環する依存は追加できません",
    DEPENDENCY_ALREADY_EXISTS: "その依存はすでに追加されています",
};

/** 依存操作の失敗コードを表示用の日本語文言へ変換する (対応表にないコードはコードを添えて示す) */
export const formatDependencyError = (code: TaskErrorCode): string => DEPENDENCY_ERROR_MESSAGE[code] ?? `依存関係の更新に失敗しました (${code})`;
