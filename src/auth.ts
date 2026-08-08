import { SupabaseAdapter } from "@auth/supabase-adapter";
import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";

/**
 * Auth.js 設定本体 (docs/auth-design.md §3.6)
 *
 * - Provider: GitHub OAuth (§3.1)
 * - Adapter: @auth/supabase-adapter で next_auth schema へ永続化する (§3.2, 第4章)
 * - session strategy: database (§3.3)
 * - pages.signIn: /login (§3.5)
 * - session コールバックで next_auth.users.id を session.user.id へ載せる (§3.4)
 *
 * SUPABASE_URL / SUPABASE_SECRET_KEY が未設定の場合、Adapter は実際に呼ばれたタイミングで
 * 失敗する (fail-fast をここでは行わない。next build 時の静的解析実行に耐えるための設計判断)
 *
 * src/types/next-auth.d.ts の Session 型拡張 (user.id) は ambient な module
 * augmentation であり、tsconfig の include (`**\/*.ts`) に含まれていれば
 * 明示的な import なしで TypeScript に自動反映される (next-env.d.ts と同様の仕組み)
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
    adapter: SupabaseAdapter({
        url: process.env.SUPABASE_URL as string,
        secret: process.env.SUPABASE_SECRET_KEY as string,
    }),
    providers: [
        GitHub({
            clientId: process.env.AUTH_GITHUB_ID,
            clientSecret: process.env.AUTH_GITHUB_SECRET,
        }),
    ],
    session: {
        strategy: "database",
    },
    pages: {
        signIn: "/login",
    },
    callbacks: {
        session: ({ session, user }) => {
            session.user.id = user.id;
            return session;
        },
    },
});
