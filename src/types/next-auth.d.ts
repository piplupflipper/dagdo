import type { DefaultSession } from "next-auth";

/**
 * next-auth v5 の Session 型拡張 (docs/auth-design.md §3.4, §3.6)
 *
 * session strategy = database では session コールバックが next_auth.users.id を
 * session.user.id に設定する (src/auth.ts)。呼び出し側 (auth()) の型にも
 * user.id を反映させるためのモジュール拡張
 */
declare module "next-auth" {
    interface Session {
        user: {
            id: string;
        } & DefaultSession["user"];
    }
}
