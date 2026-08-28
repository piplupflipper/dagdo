"use server";

import { revalidatePath } from "next/cache";
import { getSessionUserId } from "@/features/auth/lib/get-session-user";
import type { ActionResult } from "@/features/task/lib/action-result";
import { mapDbErrorOrThrow } from "@/features/task/lib/map-db-error";
import { createAppClient } from "@/lib/supabase/app-client";

/**
 * タスクを作成する (req.md §59, §60)
 *
 * user_id はクライアント入力から受け取らず、auth() で検証済みのセッションから取得する (req.md §60)。
 * id はクライアントが採番した UUID (crypto.randomUUID()) をそのまま実 PK として INSERT する (Issue #70)。
 * クライアント側の楽観行とサーバーの行が最初から同じ id になるため、tempId → 実 id の付け替えを要らない。
 * position を指定しない (null) 場合は同一 actual parent の兄弟グループの末尾に採番する。
 * 指定した場合は末尾へ作成したうえで move_task RPC (req.md §54) でその位置へ移す。
 * 挿入位置を空けるための兄弟の position 更新を自前の複数 UPDATE に分けず、
 * 1 トランザクションで行う RPC に委ねるための 2 段構えである
 *
 * 本 Action だけは defineTaskAction (req.md §71 の定型) を使わず個別に実装する。
 * 同関数は「Supabase 呼び出し 1 文 → 成功時のみ revalidate → data なし」を前提とするが、
 * ここは DB 呼び出しが 3 つあり、位置調整の失敗時は revalidate してから失敗を返し、
 * 成功時は作成した id を返すため、前提のいずれも満たさない
 */
export const createTask = async ({ id, title, parentId, position }: { id: string; title: string; parentId: string | null; position: number | null }): Promise<ActionResult<{ id: string }>> => {
    const userId = await getSessionUserId();
    const client = await createAppClient({ userId });

    const siblingCountQuery = client.from("tasks").select("*", { count: "exact", head: true }).eq("user_id", userId);
    const { count, error: countError } = parentId === null ? await siblingCountQuery.is("parent_id", null) : await siblingCountQuery.eq("parent_id", parentId);

    if (countError !== null) {
        const mapped = mapDbErrorOrThrow(countError);
        return { ok: false, ...mapped };
    }

    const { data, error } = await client
        .from("tasks")
        .insert({ id, title, parent_id: parentId, user_id: userId, position: count ?? 0 })
        .select("id")
        .single();

    if (error !== null) {
        const mapped = mapDbErrorOrThrow(error);
        return { ok: false, ...mapped };
    }

    if (position !== null) {
        // p_new_parent_id は generated types 上 string 型だが、move_task RPC (uuid 引数) は
        // NULL (ルート直下への移動) を受け付ける。move-task.ts と同じ理由で cast する
        const { error: moveError } = await client.rpc("move_task", { p_task_id: data.id, p_new_parent_id: parentId as string, p_new_position: position });
        if (moveError !== null) {
            // 作成自体は成功しているため、一覧へ反映したうえで位置調整の失敗をエラーとして返す
            revalidatePath("/");
            const mapped = mapDbErrorOrThrow(moveError);
            return { ok: false, ...mapped };
        }
    }

    revalidatePath("/");
    return { ok: true, data: { id: data.id } };
};
