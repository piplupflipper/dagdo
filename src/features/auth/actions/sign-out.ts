"use server";

import { signOut } from "@/auth";

/**
 * ログアウト用 Server Action (features/auth/components/logout-button.tsx から呼ぶ)
 *
 * LogoutButton は StatusLine (OutlineShell のクライアント境界配下) から描画されるため、
 * "@/auth" を直接 import すると Adapter の secret 設定ごとクライアントバンドルへ
 * 含まれてしまう。"use server" を持つ本ファイルを介することで、クライアント側からは
 * Server Action の参照のみが渡り、実処理は常にサーバー側で実行される
 */
export const signOutAction = async (): Promise<void> => {
    await signOut();
};
