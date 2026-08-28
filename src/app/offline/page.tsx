"use client";

import { type JSX, useEffect, useState } from "react";
import { OutlineShell } from "@/features/outline/components/outline-shell";
import type { OutlinePersistence } from "@/features/outline/hooks/use-outline-mutations";
import { loadOfflineSnapshot, type OfflineSnapshot, saveOfflineSnapshot } from "@/features/outline/lib/offline-store";
import { applyOutlineOp, type OutlineOp } from "@/features/outline/lib/outline-ops";
import type { AppTask } from "@/types/task";

/**
 * オフラインモードの `create` が挿入する行の user_id (Issue #81)
 *
 * アカウントとは別世界の固定 sentinel であり、後でログインしてもこのデータは取り込まない
 */
const OFFLINE_USER_ID = "offline";

/** localStorage 読み込み前の初期レンダーに使う空データ。参照を固定し、reconcile ゲートの誤発火を避ける */
const EMPTY_SNAPSHOT: OfflineSnapshot = { tasks: [], dependencies: [] };

/**
 * ログイン不要のオフラインモード (Issue #81)
 *
 * アウトライナー本体は既存の `OutlineShell` をそのまま使い、永続化アダプタ (`OutlinePersistence`) だけを
 * localStorage 保存へ差し替える。Supabase・Server Actions へは一切通信しない。
 * RSC のデータ取得が無いためページ自体をクライアント境界にし、認証 (`getSessionUserId`) も要求しない
 * (ログイン済みユーザーが開いても、単に別世界のローカルデータが見えるだけでエラーにはしない)。
 *
 * 読み込みは mount 後の `useEffect` で行い、初期レンダーは空で描く (SSR とのハイドレーション不整合を
 * 避ける。pane-ratio の復元と同じ考え方、docs/frontend-design.md §7.1)。読み込んだデータは props の
 * 参照変化として `OutlineShell` の reconcile ゲートが 1 度だけ採用する (オフラインの未同期件数は常に 0 で
 * ゲートは常に開いているが、props をこの初回以外に変えないため、採用はこの 1 度きりである)。
 *
 * 保存は Op の適用のたびに `persist` が適用後の全量を同期で書く。適用後 state は `OutlineShell` の
 * setState と同じ純関数 `applyOutlineOp` を適用前スナップショットへ適用して求める。
 * 依存関係はオフラインでは編集できない (`DependencySection` を描画しない) ため、読み込んだ値のまま変わらない
 */
const OfflinePage = (): JSX.Element => {
    /** localStorage から読み込んだオフラインデータ。読み込み前 (SSR・初期レンダー) は null */
    const [snapshot, setSnapshot] = useState<OfflineSnapshot | null>(null);

    useEffect(() => {
        setSnapshot(loadOfflineSnapshot());
    }, []);

    const { tasks, dependencies } = snapshot ?? EMPTY_SNAPSHOT;

    /** localStorage スナップショット保存の永続化アダプタ。未同期・版ずれの概念が無いため 0 / false 固定 */
    const persistence: OutlinePersistence = {
        persist: (op: OutlineOp, tasksSnapshot: AppTask[]): void => {
            const nextTasks = applyOutlineOp(tasksSnapshot, dependencies, op, { fallbackUserId: OFFLINE_USER_ID });
            saveOfflineSnapshot({ tasks: nextTasks, dependencies });
        },
        pendingCount: 0,
        isStopped: false,
    };

    return <OutlineShell userId={OFFLINE_USER_ID} initialTasks={tasks} initialDependencies={dependencies} persistence={persistence} />;
};

export default OfflinePage;
