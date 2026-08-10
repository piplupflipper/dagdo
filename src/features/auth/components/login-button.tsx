import type { ReactNode } from "react";
import { signIn } from "@/auth";

/**
 * GitHub OAuth ログインボタン (docs/auth-design.md §2.2, req.md §30)
 *
 * form action から signIn("github") を呼ぶ Server Action 形式で実装する
 * (クライアント JS を必要としない)
 */
export const LoginButton = (): ReactNode => {
    const handleLogin = async (): Promise<void> => {
        "use server";
        await signIn("github");
    };

    return (
        <form action={handleLogin}>
            <button type="submit" className="rounded-base border border-border bg-accent px-4 py-2 text-sm font-medium text-accent-ink transition-colors hover:bg-accent-strong">
                GitHub でログイン
            </button>
        </form>
    );
};
