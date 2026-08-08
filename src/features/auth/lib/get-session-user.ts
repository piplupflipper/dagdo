import { auth } from "@/auth";

/**
 * Server Action / RSC から呼ぶセッション取得 util (docs/frontend-design.md §4)
 *
 * auth() でセッションを検証し、ログイン済みユーザーの user.id
 * (= next_auth.users.id = tasks.user_id) を返す (docs/auth-design.md §7.4)。
 * 未ログインの場合は throw する (呼び出し元の Server Action / RSC はここで処理を継続しない)
 */
export const getSessionUserId = async (): Promise<string> => {
    const session = await auth();

    if (session?.user?.id === undefined) {
        throw new Error("unauthorized: no active session");
    }

    return session.user.id;
};
