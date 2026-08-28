import { useRouter } from "next/navigation";
import { type JSX, useState } from "react";
import { permanentlyDeleteTask } from "@/features/task/actions/permanently-delete-task";
import { restoreTask } from "@/features/task/actions/restore-task";
import { runServerAction } from "@/features/task/lib/run-server-action";
import { formatDateTime } from "@/lib/date/timezone";
import type { TrashTask } from "@/types/task";

type TrashRowProps = {
    task: TrashTask;
};

/**
 * ゴミ箱 1 行 (docs/frontend-design.md §4, §7.1)
 *
 * タイトル・削除日時・復元/完全削除ボタンを表示する。
 * 完全削除は不可逆のため window.confirm で確認してから permanentlyDeleteTask を呼ぶ。
 * write-behind 化 (Issue #70) で restoreTask / permanentlyDeleteTask は revalidatePath を呼ばなくなったため、
 * 成功時はここで `router.refresh()` を打ち、親の RSC から流れ直す props で一覧を更新する
 * (応答を await する構造は現行のまま、SPEC §7)。
 *
 * 2 つの Server Action はいずれも `runServerAction` (task/lib/run-server-action.ts) を通す。
 * 素の await では reject が進行中フラグを戻す行を飛び越え、「復元中…」の disabled 表示のまま
 * 二度と操作できなくなる (Issue #66、docs/frontend-design.md §8.4)。
 * 失敗の表示はこの行が元から持つ `error` に合流させる。`ActionResult` の `message` は英語のログ用文言
 * (docs/frontend-design.md §8.3) だが、reject 由来の `message` は利用者向けの日本語文言であり、
 * どちらも同じ場所へ出す既存の作りに合わせる
 */
export const TrashRow = ({ task }: TrashRowProps): JSX.Element => {
    const [isRestoring, setIsRestoring] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const router = useRouter();

    const isBusy = isRestoring || isDeleting;

    const handleRestore = async (): Promise<void> => {
        setIsRestoring(true);
        setError(null);
        const result = await runServerAction(() => restoreTask({ taskId: task.id }));
        setIsRestoring(false);
        if (!result.ok) {
            setError(result.message);
            return;
        }
        router.refresh();
    };

    const handlePermanentlyDelete = async (): Promise<void> => {
        if (!window.confirm(`「${task.title}」を完全に削除します。この操作は取り消せません。よろしいですか？`)) {
            return;
        }
        setIsDeleting(true);
        setError(null);
        const result = await runServerAction(() => permanentlyDeleteTask({ taskId: task.id }));
        setIsDeleting(false);
        if (!result.ok) {
            setError(result.message);
            return;
        }
        router.refresh();
    };

    return (
        <div className="flex items-center gap-3 rounded-base border border-border bg-bg px-3 py-2 text-sm backdrop-blur-sm">
            <div className="min-w-0 flex-1">
                <p className="truncate text-text">{task.title}</p>
                <p className="text-[11px] text-text-dim">削除日時: {task.deleted_at !== null ? formatDateTime(task.deleted_at) : "-"}</p>
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
