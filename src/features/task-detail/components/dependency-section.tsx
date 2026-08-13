import { type JSX, type KeyboardEvent, useState } from "react";
import { addDependency } from "@/features/task/actions/add-dependency";
import { removeDependency } from "@/features/task/actions/remove-dependency";
import { dependsOnTasksOf } from "@/features/task/lib/depends-on-tasks";
import { formatDependencyError } from "@/features/task-detail/lib/dependency-error";
import type { AppTask, TaskDependency } from "@/types/task";

type DependencySectionProps = {
    task: AppTask;
    allTasks: AppTask[];
    dependencies: TaskDependency[];
    /**
     * 親が「別のタスクへ切り替わった」と判定するたびに増える値 (detail-pane.tsx 参照)
     *
     * タイトル・期日・説明の 3 欄は親が `key` を張り替えて作り直すが、この節だけは
     * 進行中の Server Action のフラグ (`removingDependencyId` / `isAddingDependency`) を持っており、
     * それらはタスク切替では初期化しない (通信の決着で自分から false へ戻る) ため、作り直さずに
     * 初期化対象の 2 つだけをレンダー中の state 調整で戻す
     */
    resetToken: number;
    /** `Esc` で選択を破棄したあと、一覧へフォーカスを戻す共通ヘルパー */
    onEscapeToOutline: () => void;
};

/**
 * 詳細ペインの依存先の節 (一覧・削除・候補セレクトからの追加)
 *
 * 依存関係は Op リデューサの対象外であり、追加・削除の 2 操作は直接 Server Action を呼んで結果を待つ
 * (タイトル・説明・期日のような楽観適用は行わない)。
 * 依存先が 0 件でも追加 UI を出す必要があるため、一覧の有無に関わらず節自体は常に描画する
 */
export const DependencySection = ({ task, allTasks, dependencies, resetToken, onEscapeToOutline }: DependencySectionProps): JSX.Element => {
    const [dependencyError, setDependencyError] = useState<string | null>(null);
    const [removingDependencyId, setRemovingDependencyId] = useState<string | null>(null);
    const [selectedDependsOnTaskId, setSelectedDependsOnTaskId] = useState("");
    const [isAddingDependency, setIsAddingDependency] = useState(false);
    const [lastResetToken, setLastResetToken] = useState(resetToken);

    if (resetToken !== lastResetToken) {
        setLastResetToken(resetToken);
        setSelectedDependsOnTaskId("");
        setDependencyError(null);
    }

    /** このタスクが依存する依存先タスク一覧 (完了済みも取り消し線付きで並べるため、完了では絞り込まない) */
    const dependsOnTasks = dependsOnTasksOf(allTasks, dependencies, task.id, { onlyIncomplete: false });

    /**
     * 依存先として追加できるタスク
     *
     * 自分自身は依存先にできず、既存の依存先を再度追加すると DEPENDENCY_ALREADY_EXISTS になるため、どちらも候補から除外する。
     * 循環 (TASK_DEPENDENCY_CYCLE) の判定は DB Trigger に委譲し、候補の絞り込みでは行わない
     */
    const dependsOnTaskIds = new Set(dependsOnTasks.map((dependsOnTask) => dependsOnTask.id));
    const dependencyCandidates = allTasks.filter((candidate) => candidate.id !== task.id && !dependsOnTaskIds.has(candidate.id));

    const handleRemoveDependency = async (dependsOnTaskId: string): Promise<void> => {
        setRemovingDependencyId(dependsOnTaskId);
        setDependencyError(null);
        const result = await removeDependency({ taskId: task.id, dependsOnTaskId });
        setRemovingDependencyId(null);
        if (!result.ok) {
            setDependencyError(formatDependencyError(result.code));
        }
    };

    const handleAddDependency = async (): Promise<void> => {
        if (selectedDependsOnTaskId === "") {
            return;
        }
        setIsAddingDependency(true);
        setDependencyError(null);
        const result = await addDependency({ taskId: task.id, dependsOnTaskId: selectedDependsOnTaskId });
        setIsAddingDependency(false);
        if (result.ok) {
            setSelectedDependsOnTaskId("");
            return;
        }
        setDependencyError(formatDependencyError(result.code));
    };

    /**
     * 依存先追加の候補 `select` 中の `Esc` (全体方針「Esc = 確定」からの意図的な例外)
     *
     * この `select` はタイトル・説明・期日のような「下書きを確定する」編集ではなく、
     * 依存先の候補を選ぶだけの一時的な選択であり、選択自体はまだ何も書き込んでいない
     * (確定＝追加には別途「追加」ボタン押下 → `addDependency` の Server Action 呼び出しが要る)。
     * 「入力中の値」という概念が薄く、`Esc` で確定したことにしても実際には何も追加されないまま
     * 編集領域だけ畳まれ、「確定したのに反映されない」という誤解を招くだけなので、
     * ここだけ従来通りキャンセル（未確定の選択を破棄して未選択へ戻す）を維持する
     */
    const handleDependencySelectKeyDown = (event: KeyboardEvent<HTMLSelectElement>): void => {
        if (event.nativeEvent.isComposing) {
            return;
        }
        if (event.key === "Escape") {
            event.preventDefault();
            setSelectedDependsOnTaskId("");
            setDependencyError(null);
            onEscapeToOutline();
        }
    };

    return (
        <div className="mt-3">
            <div className="mb-1.5 text-xs text-text-dim">依存先</div>
            {dependsOnTasks.length > 0 ? (
                <ul className="flex flex-col gap-1">
                    {dependsOnTasks.map((dependsOnTask) => (
                        <li key={dependsOnTask.id} className="flex items-center justify-between gap-2 rounded-base border border-border bg-bg-alt px-2.5 py-1 text-xs">
                            <span className={`truncate ${dependsOnTask.completed_at !== null ? "text-text-dim line-through" : "text-text"}`}>{dependsOnTask.title}</span>
                            <button
                                type="button"
                                onClick={() => {
                                    void handleRemoveDependency(dependsOnTask.id);
                                }}
                                disabled={removingDependencyId === dependsOnTask.id}
                                aria-label={`${dependsOnTask.title} への依存を削除`}
                                className="flex-shrink-0 px-1 text-text-dim hover:text-overdue disabled:opacity-60"
                            >
                                ×
                            </button>
                        </li>
                    ))}
                </ul>
            ) : (
                <p className="text-xs text-text-dim">依存先はありません</p>
            )}

            {dependencyCandidates.length > 0 ? (
                <div className="mt-1.5 flex items-center gap-2">
                    <select
                        value={selectedDependsOnTaskId}
                        onChange={(event) => setSelectedDependsOnTaskId(event.target.value)}
                        onKeyDown={handleDependencySelectKeyDown}
                        disabled={isAddingDependency}
                        aria-label="追加する依存先タスク"
                        className="min-w-0 flex-1 rounded-base border border-border bg-bg px-2 py-1 text-xs text-text disabled:opacity-60"
                    >
                        <option value="">依存先タスクを選択…</option>
                        {dependencyCandidates.map((candidate) => (
                            <option key={candidate.id} value={candidate.id}>
                                {candidate.title}
                            </option>
                        ))}
                    </select>
                    <button
                        type="button"
                        onClick={() => {
                            void handleAddDependency();
                        }}
                        disabled={isAddingDependency || selectedDependsOnTaskId === ""}
                        className="flex-shrink-0 rounded-base border border-border px-2.5 py-1 text-xs text-accent hover:bg-accent/10 disabled:opacity-60"
                    >
                        {isAddingDependency ? "追加中…" : "追加"}
                    </button>
                </div>
            ) : (
                <p className="mt-1.5 text-xs text-text-dim">追加できる依存先タスクがありません</p>
            )}

            {dependencyError !== null ? <p className="mt-1 text-xs text-overdue">{dependencyError}</p> : null}
        </div>
    );
};
