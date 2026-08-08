import type { ReactNode } from "react";
import { LoginButton } from "@/features/auth/components/login-button";

/**
 * ログイン画面 (req.md §30、docs/auth-design.md §3.5)
 *
 * pages.signIn (src/auth.ts) の遷移先。GitHub OAuth ログインボタンのみを表示する
 */
const LoginPage = (): ReactNode => {
    return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-[var(--color-bg)] text-[var(--color-text)]">
            <h1 className="text-xl font-semibold">entodo</h1>
            <LoginButton />
        </div>
    );
};

export default LoginPage;
