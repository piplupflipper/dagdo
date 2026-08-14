import { type ActionFailure, isActionRejection } from "@/features/outline/lib/action-rejection";
import type { ActionResult, TaskErrorCode } from "@/features/task/lib/action-result";

/**
 * ステータス行に出す DB エラー (req.md §66) の表示文言を組み立てる純粋ロジック
 *
 * 以前は `E1000`〜`E1006` という表示専用の連番を併記していたが、この連番は
 * `map-db-error.ts` の SQLSTATE `ET001`〜`ET007` と割り当ての順序が一致しておらず
 * (`ET001` = `TASK_NOT_FOUND` に対し `E1001` = `TASK_BLOCKED`)、
 * 利用者の報告と migration の SQL 検索を食い違わせるため廃止した。
 * 表示は `TaskErrorCode` の記号名のみとし、番号は SQLSTATE 1 系統に絞る
 */

/**
 * `TaskErrorCode` と本文から表示文言を組み立てる
 *
 * `formatActionError` が使えない箇所 (Server Action の英語 message ではなく、
 * 呼び出し側が組み立てた日本語文言を出す `TASK_BLOCKED` の分岐) からも同じ形を得るために切り出す
 */
export const formatTaskError = (code: TaskErrorCode, message: string): string => `${code} — ${message}`;

/** Server Action の失敗結果 (`ActionResult` の `ok: false`) をそのまま表示文言にする */
export const formatActionError = (result: Extract<ActionResult, { ok: false }>): string => formatTaskError(result.code, result.message);

/**
 * 失敗した `ActionOutcome` をステータス行の文言にする (docs/frontend-design.md §8.4)
 *
 * reject 由来の失敗 (`ActionRejection`) は `TaskErrorCode` を持たないため、記号名のプレフィックスは付けず、
 * `action-rejection.ts` が組み立てた日本語文言をそのまま出す
 */
export const formatOutcomeError = (failure: ActionFailure): string => (isActionRejection(failure) ? failure.message : formatActionError(failure));
