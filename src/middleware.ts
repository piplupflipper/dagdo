import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

/**
 * セッション cookie 名 (docs/auth-design.md §6.3)
 *
 * ローカル開発 (HTTP) では `authjs.session-token`、HTTPS 環境 (Vercel 本番等) では
 * secure cookie prefix 付きの `__Secure-authjs.session-token` が使われるため両対応する
 */
const SESSION_COOKIE_NAMES = ["authjs.session-token", "__Secure-authjs.session-token"] as const;

/**
 * middleware.ts (docs/auth-design.md §6)
 *
 * Edge Runtime 上でセッション cookie の存在チェックのみを行う楽観的ガード
 * cookie の真正性検証 (署名・next_auth.sessions との突き合わせ) は行わない。
 * 真の認可は RSC/Server Action 層の auth() と DB 層の RLS が担う (§6.4)
 */
export const middleware = (request: NextRequest): NextResponse => {
    const hasSessionCookie = SESSION_COOKIE_NAMES.some((name) => request.cookies.has(name));

    if (!hasSessionCookie) {
        return NextResponse.redirect(new URL("/login", request.url));
    }

    return NextResponse.next();
};

export const config = {
    matcher: ["/((?!login|offline|api/auth|_next/static|_next/image|favicon.ico).*)"],
};
