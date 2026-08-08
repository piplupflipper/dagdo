import { SignJWT } from "jose";

/**
 * Custom JWT の有効期限 (秒) (docs/auth-design.md §5.1, 2026-08-08 ユーザー確定)
 *
 * Server Action 呼び出し毎に発行し、キャッシュ・使い回しは行わない (§5.2)
 */
const JWT_TTL_SECONDS = 300;

/**
 * Custom JWT のクレーム (docs/auth-design.md §5.1)
 *
 * GitHub access token 等の GitHub 由来の情報は含めない (req.md §33)
 */
type CustomJwtClaims = {
    sub: string;
    role: "authenticated";
};

/**
 * Supabase Data API 向けの Custom JWT を発行する (docs/auth-design.md §5.3, §5.4)
 *
 * sub には Auth.js user UUID (session.user.id) を渡す。next_auth.uid() がこの sub から
 * ユーザーを解決し、RLS Policy の `user_id = next_auth.uid()` 判定に使われる (req.md §35)
 */
export const createCustomJwt = async ({ userId }: { userId: string }): Promise<string> => {
    const secret = new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET as string);
    const claims: CustomJwtClaims = { sub: userId, role: "authenticated" };

    return await new SignJWT(claims).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime(`${JWT_TTL_SECONDS}s`).sign(secret);
};
