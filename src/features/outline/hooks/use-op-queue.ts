import { useEffect, useSyncExternalStore } from "react";
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

/** `useSyncExternalStore` へ渡す購読値。参照の同一性で変化を判定するため、更新のたびに作り直す */
type OpQueueSnapshot = {
    pendingCount: number;
    isStopped: boolean;
};

const INITIAL_SNAPSHOT: OpQueueSnapshot = { pendingCount: 0, isStopped: false };

/**
 * キューの実体 (モジュールスコープのシングルトン)
 *
 * `OutlineShell` は /trash などへのクライアント遷移で unmount され得るが、送信中・未送信の Op は
 * ブラウザセッションの間は生き続けなければならない。実体をフックの useRef に置くと、unmount 後も
 * closure で回り続ける旧 flusher と、再マウントで生まれる空キューの 2 代目が並走して FIFO の
 * 順序保証が崩れるため、状態と flusher をモジュールスコープへ置き、フックは購読と配線だけを担う
 */
let queue: OpQueue = EMPTY_OP_QUEUE;
let inFlight: OpQueueEntry | null = null;
let isStopped = false;
let isFlushing = false;
/** マウント中のフックが引き渡す最新のコールバック。unmount 中の発火は捨てる (setState は no-op で害がない) */
let callbacks: UseOpQueueArgs | null = null;
let snapshot: OpQueueSnapshot = INITIAL_SNAPSHOT;
const listeners = new Set<() => void>();

const subscribeToOpQueue = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
};

const getOpQueueSnapshot = (): OpQueueSnapshot => snapshot;

/** SSR 中の購読値。モジュール初期化直後のクライアントと同じ値なので hydration 不一致は起きない */
const getOpQueueServerSnapshot = (): OpQueueSnapshot => INITIAL_SNAPSHOT;

/** 購読値を作り直してリスナへ知らせる。キュー・in-flight・停止フラグを動かしたら必ず呼ぶ */
const notifyListeners = (): void => {
    snapshot = { pendingCount: queue.length + (inFlight === null ? 0 : 1), isStopped };
    for (const listener of listeners) {
        listener();
    }
};

/**
 * flusher 本体。多重起動は isFlushing で防ぎ、キューが空になるか停止・破棄するまで回り続ける
 *
 * 1 エントリの送信は内側のリトライループが完了 (ack / 破棄 / 停止) まで抱え、
 * その間に enqueue された Op は外側の while が次の周回で拾う
 */
const flush = async (): Promise<void> => {
    if (isFlushing) {
        return;
    }
    isFlushing = true;
    try {
        while (!isStopped) {
            const head = queue[0];
            if (head === undefined) {
                break;
            }
            queue = queue.slice(1);
            inFlight = head;

            let retryDelayMs = INITIAL_RETRY_DELAY_MS;
            let isSettled = false;
            while (!isSettled) {
                const result = await runServerAction(() => callServerForOp(head.op, head.tasksSnapshot));
                if (result.ok) {
                    inFlight = null;
                    notifyListeners();
                    if (queue.length === 0) {
                        callbacks?.onDrained?.();
                    }
                    isSettled = true;
                    continue;
                }
                if (isActionRejection(result)) {
                    if (result.isVersionSkew) {
                        // 停止。in-flight のエントリも残キューも捨てない (pendingCount に出続ける)
                        isStopped = true;
                        notifyListeners();
                        callbacks?.onVersionSkew(result.message);
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
                queue = EMPTY_OP_QUEUE;
                inFlight = null;
                notifyListeners();
                callbacks?.onDiscard(result);
                return;
            }
        }
    } finally {
        isFlushing = false;
    }
};

/** Op を末尾へ追加して flusher を起こす (シングルトンの入口)。coalesce (enqueueOp) は未送信配列にだけ効く */
const enqueueToOpQueue = (op: OutlineOp, tasksSnapshot: AppTask[]): void => {
    queue = enqueueOp(queue, { op, tasksSnapshot });
    notifyListeners();
    if (!isStopped) {
        void flush();
    }
};

/**
 * シングルトンを初期状態へ戻すテスト専用の口
 *
 * テストはモジュールを共有するため、前のケースが残した停止フラグや未送信 Op を beforeEach で消す。
 * 本番コードから呼んではならない (セッション中のキュー破棄は防波堤ヒットの 1 経路だけ)
 */
export const resetOpQueueForTesting = (): void => {
    queue = EMPTY_OP_QUEUE;
    inFlight = null;
    isStopped = false;
    isFlushing = false;
    callbacks = null;
    snapshot = INITIAL_SNAPSHOT;
};

/**
 * 直列 Op キューのフック層 (write-behind の送信側、Issue #70)
 *
 * キューの実体 (未送信 FIFO 列・in-flight・停止フラグ・flusher ループ) は上のモジュールスコープの
 * シングルトンにあり、クライアント遷移で `OutlineShell` が unmount / 再マウントされても引き継がれる。
 * このフックが担うのは次の 3 つだけである:
 * - `useSyncExternalStore` で pendingCount / isStopped を購読する
 * - 通知コールバックの最新版をシングルトンへ引き渡す (unmount 中の発火は捨てられる)
 * - `pendingCount > 0` の間だけ beforeunload ハンドラを登録する (SPEC §2)
 *
 * 結果ハンドリング (SPEC §2、flusher 側):
 * - `ok: true` → エントリを除去して次へ
 * - 版ずれ rejection → flusher を停止 (キューは保持、再読み込みで復旧)
 * - それ以外の rejection (通信断など) → 同じエントリを 1s → 2s → 4s … 上限 30s の backoff でリトライ
 * - `ok: false` (TaskErrorCode) → 残キューを全破棄して通知 (クライアント状態はサーバー正への reconcile で収束させる)
 */
export const useOpQueue = ({ onVersionSkew, onDiscard, onDrained }: UseOpQueueArgs): OpQueueHandle => {
    const { pendingCount, isStopped: isStoppedSnapshot } = useSyncExternalStore(subscribeToOpQueue, getOpQueueSnapshot, getOpQueueServerSnapshot);

    // 通知コールバックはレンダーごとに作り直されるため、コミットのたびに最新をシングルトンへ引き渡す
    useEffect(() => {
        callbacks = { onVersionSkew, onDiscard, onDrained };
    });

    // 未同期の Op がある間だけ beforeunload ハンドラを登録し、離脱確認を出す (SPEC §2)。
    // preventDefault が現行の標準 (MDN)。returnValue への代入はレガシーブラウザ (Chrome 119 以前など) 向けの併用
    useEffect(() => {
        if (pendingCount === 0) {
            return;
        }
        const handleBeforeUnload = (event: BeforeUnloadEvent): void => {
            event.preventDefault();
            event.returnValue = "";
        };
        window.addEventListener("beforeunload", handleBeforeUnload);
        return () => {
            window.removeEventListener("beforeunload", handleBeforeUnload);
        };
    }, [pendingCount]);

    return { pendingCount, isStopped: isStoppedSnapshot, enqueue: enqueueToOpQueue };
};
