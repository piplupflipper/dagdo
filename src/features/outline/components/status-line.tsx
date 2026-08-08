import Link from "next/link";
import type { JSX } from "react";
import { LogoutButton } from "@/features/auth/components/logout-button";
import type { OutlineMode } from "@/store/types";
import type { AppTask } from "@/types/task";

export type StatusLineProps = {
    mode: OutlineMode;
    cursorTask: AppTask | null;
    totalCount: number;
    blockedCount: number;
    infoMessage: string | null;
    errorMessage: string | null;
};

const MODE_LABEL: Record<OutlineMode, string> = {
    NORMAL: "NORMAL",
    VISUAL: "VISUAL",
    SEARCH: "SEARCH",
};

/**
 * モード・カーソル情報・件数・エラーを表示するステータス行 (docs/frontend-design.md §7.1、実装要点 6 / モック p26)
 *
 * errorMessage が非 null の間はそれを最優先で表示し、なければ infoMessage、
 * それもなければカーソル行の簡易情報を表示する
 */
export const StatusLine = ({ mode, cursorTask, totalCount, blockedCount, infoMessage, errorMessage }: StatusLineProps): JSX.Element => {
    const cursorInfo = cursorTask !== null ? `カーソル: ${cursorTask.title}${cursorTask.is_blocked ? " [blocked]" : ""}` : "カーソル: (なし)";
    const displayMessage = errorMessage ?? infoMessage ?? cursorInfo;

    return (
        <div className="flex flex-shrink-0 items-center gap-3 border-t border-border bg-bg-alt px-3.5 py-1.5 font-mono text-[11.5px] text-text-dim">
            <span className={`flex-shrink-0 rounded px-1.5 py-0.5 text-[10.5px] font-bold tracking-wide ${mode === "NORMAL" ? "bg-accent/10 text-accent" : "bg-blocked/10 text-blocked"}`}>
                {MODE_LABEL[mode]}
            </span>
            <span className={`min-w-0 flex-1 truncate ${errorMessage !== null ? "font-semibold text-overdue" : "text-text"}`}>{displayMessage}</span>
            <span className="flex-shrink-0 text-text-dim">
                {totalCount}件 / blocked {blockedCount}
            </span>
            <Link href="/trash" className="flex-shrink-0 text-text-dim hover:text-accent hover:underline">
                ゴミ箱
            </Link>
            <LogoutButton />
        </div>
    );
};
