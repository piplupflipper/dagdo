import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

/**
 * service-client (docs/auth-design.md §3.2, req.md §36)
 *
 * next_auth schema (Auth.js の認証情報) へは `@auth/supabase-adapter` の `SupabaseAdapter()` が
 * 内部で専用の Supabase client を生成してアクセスするため (node_modules/@auth/supabase-adapter)、
 * src/auth.ts から本ファイルの client を直接使うことは現状ない
 *
 * それでもアプリケーションコード側から secret key で next_auth schema や public schema へ
 * サーバー権限でアクセスする必要が将来生じた場合 (例: 管理用スクリプト、Adapter が提供しない
 * 操作) に備え、最小限の factory として用意しておく
 *
 * knip ignore 対象 (意図的未使用) (docs/auth-design.md §5.4 の将来用 factory)。
 * knip.json の ignore にも本ファイルを登録している
 */
export const createServiceClient = (): SupabaseClient<Database> => {
    return createClient<Database>(process.env.SUPABASE_URL as string, process.env.SUPABASE_SECRET_KEY as string);
};
