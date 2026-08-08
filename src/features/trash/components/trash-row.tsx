import { type JSX, useState } from "react";
import { permanentlyDeleteTask } from "@/features/task/actions/permanently-delete-task";
import { restoreTask } from "@/features/task/actions/restore-task";
import type { TrashTask } from "@/types/task";

export type TrashRowProps = {
    task: TrashTask;
};

/** deleted_at (ISO 文字列) を Asia/Tokyo の日時表示へ整形する */
const formatDeletedAt = (iso: string): string =>
    new Intl.DateTimeFormat("ja-JP", {
        timeZone: "Asia/Tokyo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    }).format(new Date(iso));

/**
 * ゴミ箱 1 行 (docs/frontend-design.md §4, §7.1)
 *
 * タイトル・削除日時 (Asia/Tokyo) ・復元/完全削除ボタンを表示する。
 * 完全削除は不可逆のため window.confirm で確認してから permanentlyDeleteTask を呼ぶ。
 * 成功時は revalidatePath (各 Server Action 内) により親の RSC から流れ直す props で一覧が更新される
 */
export const TrashRow = ({ task }: TrashRowProps): JSX.Element => {
    const [isRestoring, setIsRestoring] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const isBusy = isRestoring || isDeleting;

    const handleRestore = async (): Promise<void> => {
        setIsRestoring(true);
        setError(null);
        const result = await restoreTask({ taskId: task.id });
        setIsRestoring(false);
        if (!result.ok) {
            setError(result.message);
        }
    };

    const handlePermanentlyDelete = async (): Promise<void> => {
        if (!window.confirm(`「${task.title}」を完全に削除します。この操作は取り消せません。よろしいですか？`)) {
            return;
        }
        setIsDeleting(true);
        setError(null);
        const result = await permanentlyDeleteTask({ taskId: task.id });
        setIsDeleting(false);
        if (!result.ok) {
            setError(result.message);
        }
    };

    return (
        <div className="flex items-center gap-3 rounded-base border border-border bg-bg px-3 py-2 text-sm">
            <div className="min-w-0 flex-1">
                <p className="truncate text-text">{task.title}</p>
                <p className="text-[11px] text-text-dim">削除日時: {task.deleted_at !== null ? formatDeletedAt(task.deleted_at) : "-"}</p>
                {error !== null ? <p className="mt-1 text-[11px] text-overdue">{error}</p> : null}
            </div>
            <button
                type="button"
                onClick={() => {
                    void handleRestore();
                }}
                disabled={isBusy}
                className="flex-shrink-0 rounded-base border border-border px-2.5 py-1 text-xs text-accent hover:bg-accent/10 disabled:opacity-60"
            >
                {isRestoring ? "復元中…" : "復元"}
            </button>
            <button
                type="button"
                onClick={() => {
                    void handlePermanentlyDelete();
                }}
                disabled={isBusy}
                className="flex-shrink-0 rounded-base border border-overdue px-2.5 py-1 text-xs text-overdue hover:bg-overdue/10 disabled:opacity-60"
            >
                {isDeleting ? "削除中…" : "完全に削除"}
            </button>
        </div>
    );
};
