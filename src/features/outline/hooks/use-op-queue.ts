import { useRef, useState } from "react";
import { callServerForOp } from "@/features/outline/lib/dispatch-op";
import { EMPTY_OP_QUEUE, enqueueOp, type OpQueue, type OpQueueEntry } from "@/features/outline/lib/op-queue";
import type { OutlineOp } from "@/features/outline/lib/outline-ops";
import { isActionRejection } from "@/features/task/lib/action-rejection";
import type { ActionResult } from "@/features/task/lib/action-result";
import { runServerAction } from "@/features/task/lib/run-server-action";
import type { AppTask } from "@/types/task";

/** ネットワーク reject の backoff リトライの初回待ち時間 (ms)。以後 2 倍ずつ延ばす */
const INITIAL_RETRY_DELAY_MS = 1000;

/** backoff の上限 (ms)。これ以上は延ばさず同じ間隔でリトライし続ける */
const MAX_RETRY_DELAY_MS = 30000;

type UseOpQueueArgs = {
    /**
     * 版ずれ rejection で flusher を停止したときの通知
     *
     * message は run-server-action.ts 経由の既存の版ずれ文言 (「新しいバージョンが公開されています…」)。
     * キューは保持したまま再開しない (再読み込みで復旧する、SPEC §2)
     */
    onVersionSkew: (message: string) => void;
    /**
     * サーバー防波堤 (`ok: false` = TaskErrorCode を持つ失敗) に当たり、残キューを全破棄したときの通知
     *
     * 破棄後はキューが空になるため、reconcile ゲート (outline-shell.tsx) が開きサーバー正へ収束できる
     */
    onDiscard: (failure: Extract<ActionResult, { ok: false }>) => void;
    /** キューが空になった瞬間 (flusher が最後のエントリを ack したとき) の通知。reconcile トリガに使う */
    onDrained?: () => void;
};

type OpQueueHandle = {
    /** 未同期件数 (送信中の 1 件を含む)。0 のときだけ reconcile ゲートが props を採用する */
    pendingCount: number;
    /** 版ずれで flusher を停止しているか。停止後は enqueue しても送信されない (再読み込みで復旧) */
    isStopped: boolean;
    /** Op を末尾へ追加して flusher を起こす。tasksSnapshot は apply 前の一覧 (reorder の再構成用) */
    enqueue: (op: OutlineOp, tasksSnapshot: AppTask[]) => void;
};

/**
 * 直列 Op キューのフック層 (write-behind の送信側、Issue #70)
 *
 * 純関数層 (lib/op-queue.ts) が持つ未送信 FIFO 列に対し、単一の flusher ループで先頭から順に
 * Server Action へ送る。送信中のエントリは配列から取り出して別スロット (in-flight) で保持し、
 * 並行送信は絶対にしない (常に in-flight は最大 1)。coalesce (enqueueOp) が見るのは未送信配列だけなので、
 * 送信中のエントリが後から置き換わることも無い。
 *
 * 結果ハンドリング (SPEC §2):
 * - `ok: true` → エントリを除去して次へ
 * - 版ずれ rejection → flusher を停止 (キューは保持、再読み込みで復旧)
 * - それ以外の rejection (通信断など) → 同じエントリを 1s → 2s → 4s … 上限 30s の backoff でリトライ
 * - `ok: false` (TaskErrorCode) → 残キューを全破棄して通知 (クライアント状態はサーバー正への reconcile で収束させる)
 */
export const useOpQueue = ({ onVersionSkew, onDiscard, onDrained }: UseOpQueueArgs): OpQueueHandle => {
    const [pendingCount, setPendingCount] = useState(0);
    const [isStopped, setIsStopped] = useState(false);

    const queueRef = useRef<OpQueue>(EMPTY_OP_QUEUE);
    const inFlightRef = useRef<OpQueueEntry | null>(null);
    const isStoppedRef = useRef(false);
    const isFlushingRef = useRef(false);
    // 通知コールバックはレンダーごとに作り直されるため、長生きする flusher ループからは ref 越しに常に最新を呼ぶ
    const callbacksRef = useRef<UseOpQueueArgs>({ onVersionSkew, onDiscard, onDrained });
    callbacksRef.current = { onVersionSkew, onDiscard, onDrained };

    const syncPendingCount = (): void => {
        setPendingCount(queueRef.current.length + (inFlightRef.current === null ? 0 : 1));
    };

    /**
     * flusher 本体。多重起動は isFlushingRef で防ぎ、キューが空になるか停止・破棄するまで回り続ける
     *
     * 1 エントリの送信は内側のリトライループが完了 (ack / 破棄 / 停止) まで抱え、
     * その間に enqueue された Op は外側の while が次の周回で拾う
     */
    const flush = async (): Promise<void> => {
        if (isFlushingRef.current) {
            return;
        }
        isFlushingRef.current = true;
        try {
            while (!isStoppedRef.current) {
                const head = queueRef.current[0];
                if (head === undefined) {
                    break;
                }
                queueRef.current = queueRef.current.slice(1);
                inFlightRef.current = head;

                let retryDelayMs = INITIAL_RETRY_DELAY_MS;
                let isSettled = false;
                while (!isSettled) {
                    const result = await runServerAction(() => callServerForOp(head.op, head.tasksSnapshot));
                    if (result.ok) {
                        inFlightRef.current = null;
                        syncPendingCount();
                        if (queueRef.current.length === 0) {
                            callbacksRef.current.onDrained?.();
                        }
                        isSettled = true;
                        continue;
                    }
                    if (isActionRejection(result)) {
                        if (result.isVersionSkew) {
                            // 停止。in-flight のエントリも残キューも捨てない (pendingCount に出続ける)
                            isStoppedRef.current = true;
                            setIsStopped(true);
                            callbacksRef.current.onVersionSkew(result.message);
                            return;
                        }
                        // 通信断など。同じエントリを先頭に留めたまま backoff で再送する
                        console.error(`[outline] op ${head.op.type} rejected, retrying in ${retryDelayMs}ms: ${result.message}`);
                        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
                        retryDelayMs = Math.min(retryDelayMs * 2, MAX_RETRY_DELAY_MS);
                        continue;
                    }
                    // サーバー防波堤 (DB エラー契約)。ここから先の Op は前提が崩れているため全破棄する
                    console.error(`[outline] op ${head.op.type} hit server guard, discarding queue: ${result.code} ${result.message}`);
                    queueRef.current = EMPTY_OP_QUEUE;
                    inFlightRef.current = null;
                    syncPendingCount();
                    callbacksRef.current.onDiscard(result);
                    return;
                }
            }
        } finally {
            isFlushingRef.current = false;
        }
    };

    const enqueue = (op: OutlineOp, tasksSnapshot: AppTask[]): void => {
        queueRef.current = enqueueOp(queueRef.current, { op, tasksSnapshot });
        syncPendingCount();
        if (!isStoppedRef.current) {
            void flush();
        }
    };

    return { pendingCount, isStopped, enqueue };
};
