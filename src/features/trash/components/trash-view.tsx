"use client";

import Link from "next/link";
import type { JSX } from "react";
import type { TrashTask } from "@/types/task";
import { TrashRow } from "./trash-row";

type TrashViewProps = {
    tasks: TrashTask[];
};

/**
 * ゴミ箱一覧 (docs/frontend-design.md §4, §7.1)
 *
 * app/trash/page.tsx (RSC) から deleted_at IS NOT NULL のタスク一覧を props として受け取る。
 * メイン画面 (/) への戻り導線を上部に置く (StatusLine の /trash 導線と対になる)
 */
export const TrashView = ({ tasks }: TrashViewProps): JSX.Element => {
    return (
        <div className="flex h-dvh flex-col text-text">
            <div className="flex flex-shrink-0 items-center gap-3 border-b border-border bg-bg-alt px-3.5 py-2 backdrop-blur-xl">
                <Link href="/" className="text-xs text-accent hover:underline">
                    ← アウトラインへ戻る
                </Link>
                <h1 className="text-sm font-semibold">ゴミ箱</h1>
                <span className="ml-auto flex-shrink-0 text-[11px] text-text-dim">{tasks.length}件</span>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-2">
                {tasks.length === 0 ? (
                    <p className="p-4 text-sm text-text-dim">ゴミ箱は空です</p>
                ) : (
                    <div className="flex flex-col gap-1.5">
                        {tasks.map((task) => (
                            <TrashRow key={task.id} task={task} />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};
