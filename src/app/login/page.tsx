import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { LoginButton } from "@/features/auth/components/login-button";
import { getSessionUserId } from "@/features/auth/lib/get-session-user";

/**
 * ログイン画面 (req.md §30、docs/auth-design.md §3.5)
 *
 * pages.signIn (src/auth.ts) の遷移先。GitHub OAuth ログインボタンのみを表示する。
 * ログイン済みセッションが既に存在する場合は / へ redirect する
 * (getSessionUserId が throw しなければログイン済みと判定する。src/app/page.tsx と対称)
 */
const LoginPage = async (): Promise<ReactNode> => {
    let isLoggedIn = true;
    try {
        await getSessionUserId();
    } catch {
        isLoggedIn = false;
    }

    if (isLoggedIn) {
        redirect("/");
    }

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
