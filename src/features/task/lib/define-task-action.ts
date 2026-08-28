import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { getSessionUserId } from "@/features/auth/lib/get-session-user";
import type { ActionResult } from "@/features/task/lib/action-result";
import { mapDbErrorOrThrow } from "@/features/task/lib/map-db-error";
import { createAppClient } from "@/lib/supabase/app-client";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Server Action 本体へ渡す実行文脈
 *
 * client は使い回さずリクエスト毎に生成する (docs/frontend-design.md §4)。
 * userId は RLS 越しの絞り込み条件 (.eq("user_id", userId)) にも使うため本体へ渡す
 */
type TaskActionContext = {
    client: SupabaseClient<Database>;
    userId: string;
};

/**
 * Server Action の固有部分。Supabase 呼び出し 1 文で完結するものを対象とする
 *
 * 判定に使う error だけを要求するため、query builder / rpc の戻り値をそのまま返せる
 */
type TaskActionBody<A> = (ctx: TaskActionContext, args: A) => Promise<{ error: PostgrestError | null }>;

/**
 * Server Action の定型を 1 箇所へ集約する高階関数 (req.md §71)
 *
 * req.md §71 が Server Action の責務として挙げる session 確認・DB/RPC 呼び出し・
 * DB エラー変換のうち、呼び出し 1 文以外をここが担う。
 *
 * write-behind 化 (Issue #70) により、Op キューを通る Action は `revalidatePath` を呼ばない
 * (鮮度はクライアント側の reconcile トリガ = `router.refresh()` が担保する)。
 * キュー対象外の依存編集 (addDependency / removeDependency) だけが現行どおり revalidate を要るため、
 * 対象パスは省略可能な第 2 引数 `revalidateTargets` として残す。
 *
 * 契約外のエラーは mapDbErrorOrThrow が re-throw する。ここでは捕捉せず上位へ伝播させる
 * (req.md §66, docs/frontend-design.md §8.3)。
 *
 * "use server" モジュールから本関数の戻り値を `export const` する形が Server Action として
 * 登録されることは Next.js 16.3.0 で実測により確認している。同梱の
 * node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-server.md は
 * `export async function` 形しか例示していないため、この点は文書ではなく実測に拠る
 */
export const defineTaskAction = <A>(body: TaskActionBody<A>, revalidateTargets: readonly string[] = []) => {
    return async (args: A): Promise<ActionResult> => {
        const userId = await getSessionUserId();
        const client = await createAppClient({ userId });

        const { error } = await body({ client, userId }, args);

        if (error !== null) {
            const mapped = mapDbErrorOrThrow(error);
            return { ok: false, ...mapped };
        }

        for (const target of revalidateTargets) {
            revalidatePath(target);
        }

        return { ok: true, data: undefined };
    };
};
