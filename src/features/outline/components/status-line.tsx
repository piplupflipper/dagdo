import Link from "next/link";
import type { JSX } from "react";
import { LogoutButton } from "@/features/auth/components/logout-button";
import type { OutlineMode } from "@/store/types";
import type { AppTask } from "@/types/task";

type StatusLineProps = {
    mode: OutlineMode;
    cursorTask: AppTask | null;
    totalCount: number;
    blockedCount: number;
    infoMessage: string | null;
    errorMessage: string | null;
    /** Op キューの未同期件数 (送信中含む)。0 より大きい間だけ「未同期 N 件」を常設表示する (Issue #70) */
    pendingCount: number;
    /**
     * オフラインモードか (Issue #81)。既定はオンライン (false)
     *
     * オフラインではゴミ箱への導線を出さず (dd はローカル除去のみで undo でだけ戻る)、
     * ログアウトの代わりにログインへの導線を出す
     */
    isOfflineMode?: boolean;
};

const MODE_LABEL: Record<OutlineMode, string> = {
    NORMAL: "NORMAL",
    VISUAL: "VISUAL",
    SEARCH: "SEARCH",
};

/**
 * モード・カーソル情報・件数・エラーを表示するステータス行 (docs/frontend-design.md §7.1 / モック p26)
 *
 * errorMessage が非 null の間はそれを最優先で表示し、なければ infoMessage、
 * それもなければカーソル行の簡易情報を表示する。
 * 未同期件数 (`pendingCount`) はこれらのメッセージとは別枠で、件数表示の並びに控えめに常設する (SPEC §8)
 */
export const StatusLine = ({ mode, cursorTask, totalCount, blockedCount, infoMessage, errorMessage, pendingCount, isOfflineMode = false }: StatusLineProps): JSX.Element => {
    const cursorInfo = cursorTask !== null ? `カーソル: ${cursorTask.title}${cursorTask.is_blocked ? " [blocked]" : ""}` : "カーソル: (なし)";
    const displayMessage = errorMessage ?? infoMessage ?? cursorInfo;

    return (
        <div className="flex flex-shrink-0 items-center gap-3 border-t border-border bg-bg-alt px-3.5 py-1.5 font-mono text-[11.5px] text-text-dim backdrop-blur-xl">
            <span className={`flex-shrink-0 rounded px-1.5 py-0.5 text-[10.5px] font-bold tracking-wide ${mode === "NORMAL" ? "bg-accent/10 text-accent" : "bg-blocked/10 text-blocked"}`}>
                {MODE_LABEL[mode]}
            </span>
            <span className={`min-w-0 flex-1 truncate ${errorMessage !== null ? "font-semibold text-overdue" : "text-text"}`}>{displayMessage}</span>
            {pendingCount > 0 ? <span className="flex-shrink-0 text-text-dim">未同期 {pendingCount} 件</span> : null}
            <span className="flex-shrink-0 text-text-dim">
                {totalCount}件 / blocked {blockedCount}
            </span>
            {isOfflineMode ? (
                <Link href="/login" className="flex-shrink-0 text-text-dim hover:text-accent hover:underline">
                    ログインへ
                </Link>
            ) : (
                <>
                    <Link href="/trash" className="flex-shrink-0 text-text-dim hover:text-accent hover:underline">
                        ゴミ箱
                    </Link>
                    <LogoutButton />
                </>
            )}
        </div>
    );
};
