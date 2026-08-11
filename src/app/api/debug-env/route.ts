import { createHash } from "node:crypto";
import { getSessionUserId } from "@/features/auth/lib/get-session-user";
import { createCustomJwt } from "@/lib/supabase/custom-jwt";

export const dynamic = "force-dynamic";

/**
 * 一時的な診断エンドポイント (デプロイ検証後に削除する)
 *
 * ログイン済みユーザーに対してのみ、Supabase 関連環境変数の存在・形状 (値そのものは返さない) と、
 * Custom JWT + publishable key での REST 疎通結果を返す
 */
export const GET = async (): Promise<Response> => {
    let userId: string;
    try {
        userId = await getSessionUserId();
    } catch {
        return Response.json({ error: "unauthenticated" }, { status: 401 });
    }

    const url = process.env.SUPABASE_URL;
    const pub = process.env.SUPABASE_PUBLISHABLE_KEY;
    const secret = process.env.SUPABASE_JWT_SECRET;

    let rest: { status: number; body: string } | { thrown: string };
    try {
        const jwt = await createCustomJwt({ userId });
        const res = await fetch(`${url}/rest/v1/app_tasks?select=id&limit=1`, {
            headers: { apikey: pub ?? "", Authorization: `Bearer ${jwt}` },
            cache: "no-store",
        });
        rest = { status: res.status, body: (await res.text()).slice(0, 300) };
    } catch (e) {
        rest = { thrown: String(e).slice(0, 300) };
    }

    return Response.json({
        supabaseUrl: url ?? null,
        pubKey: { present: pub !== undefined, len: pub?.length ?? 0, prefix: pub?.slice(0, 15) ?? null },
        jwtSecret: { present: secret !== undefined, len: secret?.length ?? 0, sha256_8: secret === undefined ? null : createHash("sha256").update(secret).digest("hex").slice(0, 8) },
        rest,
    });
};
