/**
 * DB エラー契約 (req.md §66)
 *
 * DB (Trigger / RPC / 制約) が返すエラーコード。
 * SQLSTATE ET001〜ET007 とメッセージ先頭のコード文字列の両方で判別できる
 * (supabase/migrations/20260808000004_triggers.sql 冒頭コメント参照)
 */
export type TaskErrorCode = "TASK_NOT_FOUND" | "TASK_PARENT_CYCLE" | "TASK_DEPENDENCY_CYCLE" | "TASK_BLOCKED" | "DEPENDENCY_ALREADY_EXISTS" | "INVALID_POSITION" | "INVALID_PARENT";

/**
 * 全 Server Action の戻り値を統一する discriminated union
 * (docs/frontend-design.md §8.3)
 *
 * message は英語のログ用文言。UI 表示用の日本語文言は呼び出し側が code から組み立てる
 */
export type ActionResult<T = void> = { ok: true; data: T } | { ok: false; code: TaskErrorCode; message: string };
