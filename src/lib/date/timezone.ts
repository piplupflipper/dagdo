/**
 * Asia/Tokyo 基準の日付・日時ユーティリティ (docs/frontend-design.md の `src/lib/date/timezone.ts`, req.md §6)
 *
 * 表示する日付・日時と「今日」の判定は、実行環境のタイムゾーンに関わらずすべてこの時間帯で行う。
 * `Intl.DateTimeFormat` の生成は安くないため、書式ごとに 1 つだけ作ってモジュールスコープで使い回す
 * (以前は outline-row / detail-pane / trash-row がそれぞれレンダーのたびに生成していた)
 */

const TIME_ZONE = "Asia/Tokyo";

/** YYYY/MM/DD */
const dateFormatter = new Intl.DateTimeFormat("ja-JP", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });

/** YYYY/MM/DD hh:mm */
const dateTimeFormatter = new Intl.DateTimeFormat("ja-JP", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });

/** YYYY-MM-DD。`tasks.due_date` と同じ表記で日付を比較するために en-CA を使う */
const isoDateFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE });

/** ISO 文字列を YYYY/MM/DD 表記へ整形する */
export const formatDate = (iso: string): string => dateFormatter.format(new Date(iso));

/** ISO 文字列を YYYY/MM/DD hh:mm 表記へ整形する */
export const formatDateTime = (iso: string): string => dateTimeFormatter.format(new Date(iso));

/**
 * due_date (YYYY-MM-DD) が「今日」より前かどうか
 *
 * 完了済みのタスクを期限切れ扱いから外すかどうかは呼び出し元の責務とし、ここでは判定しない
 * (一覧は行が `completed_at` を見て除外し、詳細ペインは `status` を見て除外する)
 */
export const isOverdue = (dueDate: string): boolean => dueDate < isoDateFormatter.format(new Date());
