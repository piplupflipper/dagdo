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
 * メッセージ先頭のコード文字列 → TaskErrorCode 対応表
 *
 * SQLSTATE が失われる経路 (PostgREST がラップし直す場合等) に備え、
 * `RAISE EXCEPTION` メッセージ先頭のコード文字列 (例: "TASK_NOT_FOUND: task ...") でも判別する
 */
const MESSAGE_PREFIX_TO_TASK_ERROR_CODE: Record<string, TaskErrorCode> = {
    TASK_NOT_FOUND: "TASK_NOT_FOUND",
    TASK_PARENT_CYCLE: "TASK_PARENT_CYCLE",
    TASK_DEPENDENCY_CYCLE: "TASK_DEPENDENCY_CYCLE",
    TASK_BLOCKED: "TASK_BLOCKED",
    DEPENDENCY_ALREADY_EXISTS: "DEPENDENCY_ALREADY_EXISTS",
    INVALID_POSITION: "INVALID_POSITION",
    INVALID_PARENT: "INVALID_PARENT",
};

/**
 * PostgrestError の SQLSTATE (`code`) から TaskErrorCode を判別する
 *
 * SQLSTATE を優先する理由: メッセージ文字列は将来の文言変更に弱いが、
 * SQLSTATE (ET001〜ET007) は migration が定める契約であり変わりにくい
 */
const resolveByCode = (code: string): TaskErrorCode | undefined => {
    return SQLSTATE_TO_TASK_ERROR_CODE[code];
};

/**
 * PostgrestError のメッセージ先頭のコード文字列から TaskErrorCode を判別する
 */
const resolveByMessagePrefix = (message: string): TaskErrorCode | undefined => {
    const prefix = message.split(":")[0]?.trim();
    if (prefix === undefined) {
        return undefined;
    }
    return MESSAGE_PREFIX_TO_TASK_ERROR_CODE[prefix];
};

/**
 * DB エラー (PostgrestError) を TaskErrorCode へ変換する純粋関数 (req.md §66, docs/frontend-design.md §8.3)
 *
 * SQLSTATE (`error.code`) を最優先で判定し、次にメッセージ先頭のコード文字列で判定する。
 * どちらでも判別できない契約外のエラーは undefined を返す (呼び出し側が re-throw する)
 *
 * 現状は本ファイル内の mapDbErrorOrThrow からのみ参照される内部関数とする。
 * 単体テスト用に温存している純粋関数であり、vitest 導入時に export を復帰する (第 11 章)
 */
const mapDbErrorToTaskErrorCode = (error: PostgrestError): TaskErrorCode | undefined => {
    return resolveByCode(error.code) ?? resolveByMessagePrefix(error.message);
};

/**
 * Server Action 内で PostgrestError を ActionResult の失敗形へ変換するために使う
 *
 * 契約外の (ET001〜ET007 に対応しない) エラーは TaskErrorCode へ変換できないため、
 * 握りつぶさず re-throw する (呼び出し元の Server Action が上位へ伝播させる)
 */
export const mapDbErrorOrThrow = (error: PostgrestError): { code: TaskErrorCode; message: string } => {
    const code = mapDbErrorToTaskErrorCode(error);
    if (code === undefined) {
        throw error;
    }
    return { code, message: error.message };
};
