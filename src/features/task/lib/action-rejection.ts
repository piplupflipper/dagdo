import type { ActionResult } from "@/features/task/lib/action-result";

/**
 * Server Action の呼び出しが reject したときの失敗形 (Issue #66、docs/frontend-design.md §8.4)
 *
 * DB エラー契約 (req.md §66) の `TaskErrorCode` は「リクエストがサーバーへ届き、DB が弾いた」失敗だけを表し、
 * migration が定める SQLSTATE `ET001`〜`ET007` と 1 対 1 に対応する。
 * 一方、Server Action の Promise が reject するのは、リクエストが届かなかったか、応答を `ActionResult` として
 * 受け取れなかった場合であり、この対応の外側にある。
 * 混ぜると `TaskErrorCode` が SQLSTATE と 1 対 1 でなくなるため、reject 由来の失敗はサーバー側の契約へ足さず、
 * クライアント層のこの型で表す。`code` を持たないのはそのためである。
 *
 * `task` feature に置くのは、アウトライン・ゴミ箱・詳細ペインのいずれもがこの失敗形を要るためである
 * (feature 間の import は一方向に保つ、docs/frontend-design.md §4)
 */
export type ActionRejection = { ok: false; rejected: true; message: string };

/** Server Action を await した結果。値として返った `ActionResult` か、reject を捕まえた `ActionRejection` のいずれか */
export type ActionOutcome<T = void> = ActionResult<T> | ActionRejection;

/** 失敗した `ActionOutcome`。DB エラー契約の失敗と reject 由来の失敗の 2 つからなる */
export type ActionFailure = Extract<ActionResult, { ok: false }> | ActionRejection;

/** ステータス行に出す文言 (版ずれ)。再読み込みで新しい版のクライアントを取り直せば直るため、その導線だけを伝える */
const STALE_DEPLOYMENT_MESSAGE = "新しいバージョンが公開されています。ページを再読み込みしてください";

/**
 * ステータス行に出す文言 (版ずれ以外)
 *
 * reject の理由は本番では伏せられるため、通信断とセッション失効を切り分けられない。
 * 失効していた場合は再試行し続けても成功しないが、再読み込みすれば `app/page.tsx` の redirect が `/login` へ送る。
 * そのため再試行だけでなく再読み込みも導線として示す
 */
const TRANSPORT_FAILURE_MESSAGE = "サーバーとの通信に失敗しました。再試行しても直らない場合は、ページを再読み込みしてください";

/**
 * 版ずれ (デプロイで Server Action ID が変わり、古いクライアントの ID がサーバーに無い) を message から判別する材料
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
 * 前者は `run-server-action.ts` が注入する公式の述語 (`unstable_isUnrecognizedActionError`) でも判別できるが、
 * 後者は素の `Error` であり公式の述語では判別できないため、この文字列一致は注入の有無によらず併用する
 */
const STALE_DEPLOYMENT_MESSAGE_MARKERS = ["Failed to find Server Action", "failed-to-find-server-action"] as const;

/**
 * throw された値から `message` を取り出す
 *
 * throw されるのは Error とは限らない (文字列を throw する経路や、Error でない値が reject 理由になる経路がある) ため、
 * Error でも文字列でもない値は判別材料なしとして扱い、版ずれ以外へ倒す
 */
const readReasonMessage = (reason: unknown): string => {
    if (reason instanceof Error) {
        return reason.message;
    }
    if (typeof reason === "string") {
        return reason;
    }
    return "";
};

/**
 * reject 理由を「版ずれ」と「それ以外」の 2 つへ分ける純関数
 *
 * `isKnownStaleDeployment` は版ずれの判別を足すための注入口である。
 * Next.js が `next/navigation` から export する `unstable_isUnrecognizedActionError` を想定しており、
 * 呼び出し元 (`run-server-action.ts`) が渡す。ここで import しないのは、この層をフレームワークに
 * 依存させないためである (docs/frontend-design.md §4)。
 * 注入された述語と上のメッセージ一致は択一ではなく併用する。前者は fetch action の版ずれだけを、
 * 後者は公式の述語が知らない MPA action の版ずれも拾うためで、どちらか一方では取りこぼす
 */
export const toActionRejection = (reason: unknown, isKnownStaleDeployment?: (reason: unknown) => boolean): ActionRejection => {
    const message = readReasonMessage(reason);
    const isStaleDeployment = isKnownStaleDeployment?.(reason) === true || STALE_DEPLOYMENT_MESSAGE_MARKERS.some((marker) => message.includes(marker));
    return { ok: false, rejected: true, message: isStaleDeployment ? STALE_DEPLOYMENT_MESSAGE : TRANSPORT_FAILURE_MESSAGE };
};

/** 失敗した `ActionOutcome` が reject 由来かどうか (`code` を持たない側かどうか) を読む述語 */
export const isActionRejection = (failure: ActionFailure): failure is ActionRejection => "rejected" in failure;
