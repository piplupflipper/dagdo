import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getSessionUserId } from "@/features/auth/lib/get-session-user";
import { OutlineShell } from "@/features/outline/components/outline-shell";
import { getOutlineData } from "@/features/task/lib/queries";

/**
 * メイン画面 (docs/frontend-design.md §4, §7.1, §8.1)
 *
 * app_tasks / task_dependencies を並列取得し、OutlineShell へ props として渡す。
 * 未ログインの場合は getSessionUserId が throw するため /login へ redirect する
 */
const Home = async (): Promise<ReactNode> => {
    let userId: string;
    try {
        userId = await getSessionUserId();
    } catch {
        redirect("/login");
    }

    const { tasks, dependencies } = await getOutlineData({ userId });

    return <OutlineShell userId={userId} initialTasks={tasks} initialDependencies={dependencies} />;
};

export default Home;
