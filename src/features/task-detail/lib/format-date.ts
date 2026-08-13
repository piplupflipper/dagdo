/**
 * 詳細ペインの日付表示ヘルパー
 *
 * いずれも Asia/Tokyo 固定である。同種の整形は outline-row.tsx / trash-row.tsx にもあるが、
 * 重複の解消は Issue #35 (`src/lib/date/timezone.ts` への集約) が担当するため、ここでは移設のみ行う
 */

/** ISO 文字列を Asia/Tokyo の YYYY/MM/DD 表記へ整形する */
export const formatDate = (iso: string): string => new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));

/** ISO 文字列を Asia/Tokyo の YYYY/MM/DD hh:mm 表記へ整形する */
export const formatDateTime = (iso: string): string =>
    new Intl.DateTimeFormat("ja-JP", {
        timeZone: "Asia/Tokyo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    }).format(new Date(iso));

/** due_date (YYYY-MM-DD) が Asia/Tokyo の「今日」より前かどうか */
export const isOverdue = (dueDate: string): boolean => {
    const todayJst = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(new Date());
    return dueDate < todayJst;
};
