import type { PostgrestError } from "@supabase/supabase-js";
import type { TaskErrorCode } from "@/features/task/lib/action-result";

/**
 * SQLSTATE (PostgrestError.code) → TaskErrorCode 対応表
 *
 * supabase/migrations/20260808000004_triggers.sql と
 * supabase/migrations/20260808000005_rpc_functions.sql 冒頭コメントが定める割り当て
 */
const SQLSTATE_TO_TASK_ERROR_CODE: Record<string, TaskErrorCode> = {
    ET001: "TASK_NOT_FOUND",
    ET002: "TASK_PARENT_CYCLE",
    ET003: "TASK_DEPENDENCY_CYCLE",
    ET004: "TASK_BLOCKED",
    ET005: "DEPENDENCY_ALREADY_EXISTS",
    ET006: "INVALID_POSITION",
    ET007: "INVALID_PARENT",
};

/**
 * メッセージ先頭に現れうるコード文字列の集合
 *
 * SQLSTATE が失われる経路 (PostgREST がラップし直す場合等) に備え、
 * `RAISE EXCEPTION` メッセージ先頭のコード文字列 (例: "TASK_NOT_FOUND: task ...") でも判別する。
 * コード文字列は TaskErrorCode そのものなので、対応表ではなく所属判定で足りる
 */
const MESSAGE_PREFIX_CODES: ReadonlySet<string> = new Set<TaskErrorCode>([
    "TASK_NOT_FOUND",
    "TASK_PARENT_CYCLE",
    "TASK_DEPENDENCY_CYCLE",
    "TASK_BLOCKED",
    "DEPENDENCY_ALREADY_EXISTS",
    "INVALID_POSITION",
    "INVALID_PARENT",
]);

/**
 * PostgrestError のメッセージ先頭のコード文字列から TaskErrorCode を判別する
 */
const resolveByMessagePrefix = (message: string): TaskErrorCode | undefined => {
    const prefix = message.split(":")[0]?.trim();
    if (prefix === undefined || !MESSAGE_PREFIX_CODES.has(prefix)) {
        return undefined;
    }
    // 所属判定を通った時点で prefix は TaskErrorCode のいずれかである (集合の要素型が TaskErrorCode)
    return prefix as TaskErrorCode;
};

/**
 * Server Action 内で PostgrestError を ActionResult の失敗形へ変換するために使う (req.md §66, docs/frontend-design.md §8.3)
 *
 * SQLSTATE (`error.code`) を最優先で判定し、次にメッセージ先頭のコード文字列で判定する。
 * SQLSTATE を優先する理由: メッセージ文字列は将来の文言変更に弱いが、
 * SQLSTATE (ET001〜ET007) は migration が定める契約であり変わりにくい。
 *
 * どちらでも判別できない契約外のエラーは TaskErrorCode へ変換できないため、
 * 握りつぶさず re-throw する (呼び出し元の Server Action が上位へ伝播させる)
 */
export const mapDbErrorOrThrow = (error: PostgrestError): { code: TaskErrorCode; message: string } => {
    const code = SQLSTATE_TO_TASK_ERROR_CODE[error.code] ?? resolveByMessagePrefix(error.message);
    if (code === undefined) {
        throw error;
    }
    return { code, message: error.message };
};
