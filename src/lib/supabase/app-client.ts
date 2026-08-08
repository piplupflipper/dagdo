import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createCustomJwt } from "@/lib/supabase/custom-jwt";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Todo データアクセス用 Supabase client を生成する (docs/auth-design.md §5.4, req.md §36)
 *
 * publishable key + Custom JWT (Authorization ヘッダ) で Supabase Data API へアクセスする。
 * Server Action 内でリクエスト毎に生成し、生成した client を使い回さない
 * (docs/frontend-design.md §4「app-client.ts は Server Action 内で毎リクエスト生成する」)
 */
export const createAppClient = async ({ userId }: { userId: string }): Promise<SupabaseClient<Database>> => {
    const token = await createCustomJwt({ userId });

    return createClient<Database>(process.env.SUPABASE_URL as string, process.env.SUPABASE_PUBLISHABLE_KEY as string, {
        global: {
            headers: {
                Authorization: `Bearer ${token}`,
            },
        },
    });
};
