/** 詳細ペインのバッジに出す表示用の状態 (DB のカラムではなく completed_at / is_blocked から導く派生値) */
export type TaskStatus = "done" | "blocked" | "ready";

/** completed_at / is_blocked から表示用の状態を導出する */
export const resolveStatus = ({ completedAt, isBlocked }: { completedAt: string | null; isBlocked: boolean }): TaskStatus => {
    if (completedAt !== null) {
        return "done";
    }
    return isBlocked ? "blocked" : "ready";
};
