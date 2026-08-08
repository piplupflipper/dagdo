import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getSessionUserId } from "@/features/auth/lib/get-session-user";
import { getTrashTasks } from "@/features/task/lib/queries";
import { TrashView } from "@/features/trash/components/trash-view";

/**
 * ゴミ箱専用ルート (docs/frontend-design.md §4, §7.1)
 *
 * deleted_at IS NOT NULL のタスク取得と TrashView の描画を行う。
 * 未ログインの場合は getSessionUserId が throw するため /login へ redirect する (app/page.tsx と同じ方式)
 */
const TrashPage = async (): Promise<ReactNode> => {
    let userId: string;
    try {
        userId = await getSessionUserId();
    } catch {
        redirect("/login");
    }

    const tasks = await getTrashTasks({ userId });

    return <TrashView tasks={tasks} />;
};

export default TrashPage;
