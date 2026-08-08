import type { ReactNode } from "react";
import { signOutAction } from "@/features/auth/actions/sign-out";

/**
 * ログアウトボタン (StatusLine 右端に小さく配置する, docs/frontend-design.md §7.1)
 *
 * form action から signOutAction (features/auth/actions/sign-out.ts) を呼ぶ Server Action 形式で実装する
 */
export const LogoutButton = (): ReactNode => {
    return (
        <form action={signOutAction}>
            <button type="submit" className="flex-shrink-0 text-text-dim hover:text-accent hover:underline">
                ログアウト
            </button>
        </form>
    );
};
