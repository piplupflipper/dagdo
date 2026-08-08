import type { Database } from "@/lib/supabase/database.types";

/** app_tasks View の生成型 (View 由来のため全カラム nullable) */
type AppTaskRow = Database["public"]["Views"]["app_tasks"]["Row"];

/**
 * アプリケーションが扱うタスク (app_tasks View の 1 行)
 *
 * View 定義上 NULL になり得ないカラムを non-null に narrowing した domain 型。
 * DB 型の正は database.types.ts (supabase gen types 生成物) であり、
 * ここでは nullability の補正のみを行う (手書きで独自のカラムを増やさない)
 */
export type AppTask = Omit<AppTaskRow, "id" | "user_id" | "title" | "description" | "position" | "sort_path" | "is_blocked" | "created_at" | "updated_at"> & {
    id: string;
    user_id: string;
    title: string;
    description: string;
    position: number;
    sort_path: number[];
    is_blocked: boolean;
    created_at: string;
    updated_at: string;
};

/** task_dependencies テーブルの 1 行 */
export type TaskDependency = Database["public"]["Tables"]["task_dependencies"]["Row"];

/** ゴミ箱表示用のタスク (tasks テーブルの生の行。deleted_at IS NOT NULL のもの) */
export type TrashTask = Database["public"]["Tables"]["tasks"]["Row"];
