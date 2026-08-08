import { createAppClient } from "@/lib/supabase/app-client";
import type { AppTask, TaskDependency, TrashTask } from "@/types/task";

/**
 * メイン画面の初回ロードで RSC が呼ぶ読み取り関数 (docs/frontend-design.md §8.1)
 *
 * app_tasks と task_dependencies を並列取得する (req.md §69)。
 * app_tasks は View であるため生成型は全カラム nullable だが、View 定義
 * (supabase/migrations/20260808000003_app_tasks_view.sql) 上、
 * id / user_id / title / description / position / sort_path / is_blocked /
 * created_at / updated_at は基底テーブル (public.tasks の NOT NULL 制約) または
 * View の算出式 (coalesce を要しない集計) から NULL になり得ないため、
 * AppTask への narrowing (cast) は妥当である
 */
export const getOutlineData = async ({ userId }: { userId: string }): Promise<{ tasks: AppTask[]; dependencies: TaskDependency[] }> => {
    const client = await createAppClient({ userId });

    const [tasksResult, dependenciesResult] = await Promise.all([client.from("app_tasks").select("*"), client.from("task_dependencies").select("*")]);

    if (tasksResult.error !== null) {
        throw tasksResult.error;
    }
    if (dependenciesResult.error !== null) {
        throw dependenciesResult.error;
    }

    return {
        tasks: tasksResult.data as AppTask[],
        dependencies: dependenciesResult.data,
    };
};

/**
 * ゴミ箱画面用の読み取り関数 (deleted_at IS NOT NULL のタスク一覧)
 *
 * app_tasks View は deleted_at IS NOT NULL の行を除外する設計であるため (req.md §44)、
 * ゴミ箱表示には基底の public.tasks テーブルを直接参照する
 */
export const getTrashTasks = async ({ userId }: { userId: string }): Promise<TrashTask[]> => {
    const client = await createAppClient({ userId });

    const { data, error } = await client.from("tasks").select("*").not("deleted_at", "is", null);

    if (error !== null) {
        throw error;
    }

    return data;
};
