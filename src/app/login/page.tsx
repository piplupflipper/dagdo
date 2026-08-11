import type { ReactNode } from "react";
import { LoginButton } from "@/features/auth/components/login-button";

/**
 * ログイン画面 (req.md §30、docs/auth-design.md §3.5)
 *
 * pages.signIn (src/auth.ts) の遷移先。GitHub OAuth ログインボタンのみを表示する
 */
const LoginPage = (): ReactNode => {
    return (
        <div className="flex min-h-screen items-center justify-center p-4 text-text">
            <div className="flex w-full max-w-sm flex-col items-center gap-6 rounded-base border border-border bg-bg-alt px-8 py-10 shadow-xl backdrop-blur-xl">
                <h1 className="text-xl font-semibold tracking-tight">dagdo</h1>
                <p className="text-center text-sm text-text-dim">タスクの構造と依存関係を、ひとつのアウトラインで管理します</p>
                <LoginButton />
            </div>
        </div>
    );
};

export default LoginPage;
