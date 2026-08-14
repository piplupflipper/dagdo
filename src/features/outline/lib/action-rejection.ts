import type { ActionResult } from "@/features/task/lib/action-result";

/**
 * Server Action の呼び出しが reject したときの失敗形 (Issue #66、docs/frontend-design.md §8.4)
 *
 * DB エラー契約 (req.md §66) の `TaskErrorCode` は「リクエストがサーバーへ届き、DB が弾いた」失敗だけを表し、
 * migration が定める SQLSTATE `ET001`〜`ET007` と 1 対 1 に対応する。
 * 一方、Server Action の Promise が reject するのは、リクエストが届かなかったか、応答を `ActionResult` として
 * 受け取れなかった場合であり、この対応の外側にある。
 * 混ぜると `TaskErrorCode` が SQLSTATE と 1 対 1 でなくなるため、reject 由来の失敗はサーバー側の契約へ足さず、
 * クライアント層のこの型で表す。`code` を持たないのはそのためである
 */
export type ActionRejection = { ok: false; rejected: true; message: string };

/** Server Action を await した結果。値として返った `ActionResult` か、reject を捕まえた `ActionRejection` のいずれか */
export type ActionOutcome<T = void> = ActionResult<T> | ActionRejection;

/** 失敗した `ActionOutcome`。DB エラー契約の失敗と reject 由来の失敗の 2 つからなる */
export type ActionFailure = Extract<ActionResult, { ok: false }> | ActionRejection;

/** ステータス行に出す文言 (版ずれ)。再読み込みで新しい版のクライアントを取り直せば直るため、その導線だけを伝える */
const STALE_DEPLOYMENT_MESSAGE = "新しいバージョンが公開されています。ページを再読み込みしてください";

/** ステータス行に出す文言 (版ずれ以外)。原因を切り分けられないため、再試行だけを促す */
const TRANSPORT_FAILURE_MESSAGE = "サーバーとの通信に失敗しました。しばらくしてから再試行してください";

/**
 * 版ずれ (デプロイで Server Action ID が変わり、古いクライアントの ID がサーバーに無い) と判別する材料
 *
 * Next.js 16.3.0 では、この状況で観測されうる Error が経路ごとに異なる。
 *
 * - fetch action: サーバーが 404 + `x-nextjs-action-not-found: 1` を返し、クライアントのルーターが
 *   `UnrecognizedActionError`（message は `Server Action "<id>" was not found on the server.` + 文書 URL）を throw する
 *   (`node_modules/next/dist/server/app-render/action-handler.js` の `handleUnrecognizedFetchAction`、
 *   `node_modules/next/dist/client/components/router-reducer/reducers/server-action-reducer.js`)
 * - MPA action: サーバー側で `Failed to find Server Action. This request might be from an older or newer deployment.`
 *   を throw する (`node_modules/next/dist/server/app-render/action-handler.js`)
 *
 * どちらの message も文書 URL `.../messages/failed-to-find-server-action` を含むが、ハイフン区切りのため
 * 語間空白の文言とは別のマーカーとして両方を見る。
 * `name` での判別は `next/navigation` の `unstable_isUnrecognizedActionError`
 * (`node_modules/next/dist/client/components/unrecognized-action-error.d.ts`) と同じ判定を、
 * import なしで行うためのものである。`lib/` は React にもフレームワークにも依存しない純関数だけを置く
 * (docs/frontend-design.md §4)
 */
const STALE_DEPLOYMENT_ERROR_NAME = "UnrecognizedActionError";
const STALE_DEPLOYMENT_MESSAGE_MARKERS = ["Failed to find Server Action", "failed-to-find-server-action"] as const;

/**
 * throw された値から `name` / `message` を取り出す
 *
 * throw されるのは Error とは限らない (文字列を throw する経路や、Error でない値が reject 理由になる経路がある) ため、
 * Error でも文字列でもない値は判別材料なしとして扱い、版ずれ以外へ倒す
 */
const readReason = (reason: unknown): { name: string; message: string } => {
    if (reason instanceof Error) {
        return { name: reason.name, message: reason.message };
    }
    if (typeof reason === "string") {
        return { name: "", message: reason };
    }
    return { name: "", message: "" };
};

/** reject 理由を「版ずれ」と「それ以外」の 2 つへ分ける純関数 */
export const toActionRejection = (reason: unknown): ActionRejection => {
    const { name, message } = readReason(reason);
    const isStaleDeployment = name === STALE_DEPLOYMENT_ERROR_NAME || STALE_DEPLOYMENT_MESSAGE_MARKERS.some((marker) => message.includes(marker));
    return { ok: false, rejected: true, message: isStaleDeployment ? STALE_DEPLOYMENT_MESSAGE : TRANSPORT_FAILURE_MESSAGE };
};

/** 失敗した `ActionOutcome` が reject 由来かどうか (`code` を持たない側かどうか) を読む述語 */
export const isActionRejection = (failure: ActionFailure): failure is ActionRejection => "rejected" in failure;

/**
 * Server Action の await を失敗形へ落として返す (Issue #66)
 *
 * `startTransition(async () => { await <Server Action> })` の中で Promise が reject すると、
 * その例外は transition の外へ抜けて最寄りの error boundary へ届き、画面全体がエラー表示へ切り替わる
 * (`node_modules/next/dist/docs/01-app/01-getting-started/10-error-handling.md` の
 * 「unhandled errors inside `startTransition` from `useTransition` will bubble up to the nearest error boundary」)。
 * ここで値へ変換することで、reject は `ok: false` と同じ「1 操作の失敗」としてステータス行へ流れ、
 * transition も通常どおり完了する (= `useOptimistic` の巻き戻しと後始末が `ok: false` のときと同じ経路を通る)。
 *
 * 表示文言は原因を 2 つに分けるだけで、理由そのものは失われるため、切り分けの手掛かりとして console へ残す
 */
export const runServerAction = async <T>(call: () => Promise<ActionResult<T>>): Promise<ActionOutcome<T>> => {
    try {
        return await call();
    } catch (reason) {
        console.error("[outline] server action rejected:", reason);
        return toActionRejection(reason);
    }
};
