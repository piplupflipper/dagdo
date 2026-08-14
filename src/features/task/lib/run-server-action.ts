import { unstable_isUnrecognizedActionError } from "next/navigation";
import { type ActionOutcome, toActionRejection } from "@/features/task/lib/action-rejection";
import type { ActionResult } from "@/features/task/lib/action-result";

/**
 * Server Action の await を失敗形へ落として返す唯一の窓口 (Issue #66、docs/frontend-design.md §8.4)
 *
 * `startTransition(async () => { await <Server Action> })` の中で Promise が reject すると、
 * その例外は transition の外へ抜けて最寄りの error boundary へ届き、画面全体がエラー表示へ切り替わる
 * (`node_modules/next/dist/docs/01-app/01-getting-started/10-error-handling.md` の
 * 「unhandled errors inside `startTransition` from `useTransition` will bubble up to the nearest error boundary」)。
 * transition の外 (ゴミ箱・詳細ペインのイベントハンドラ) でも、reject が素通しになると
 * 「復元中…」のような進行中フラグを戻す後始末が飛ぶ。
 * ここで値へ変換することで、reject は `ok: false` と同じ「1 操作の失敗」として扱えるようになり、
 * transition も通常どおり完了する (= `useOptimistic` の巻き戻しと後始末が `ok: false` のときと同じ経路を通る)。
 *
 * 版ずれの判別には Next.js が公式に用意する述語 `unstable_isUnrecognizedActionError` を注入する。
 * 判別を `action-rejection.ts` のメッセージ一致だけに頼ると、Next.js 内部の文言が変わったときに
 * 静かに判別できなくなるためである。
 * `action-rejection.ts` 側の文字列一致は取りやめず併用する。公式の述語が判別するのは fetch action の
 * `UnrecognizedActionError` だけであり、MPA action の版ずれ (素の `Error`) は判別しないためである
 * (`node_modules/next/dist/client/components/unrecognized-action-error.d.ts`、
 * `node_modules/next/dist/server/app-render/action-handler.js`)。
 *
 * この 1 モジュールだけ `lib/` に置きながらフレームワーク (`next/navigation`) を import する。
 * 述語の注入口を持つ `action-rejection.ts` を純関数のまま保つための分割であり、
 * 呼び出し側が注入を毎回書かずに済むよう、注入済みのこちらを使う (docs/frontend-design.md §4、§8.4)。
 *
 * 表示文言は原因を 2 つに分けるだけで、理由そのものは失われるため、切り分けの手掛かりとして console へ残す
 */
export const runServerAction = async <T>(call: () => Promise<ActionResult<T>>): Promise<ActionOutcome<T>> => {
    try {
        return await call();
    } catch (reason) {
        console.error("[task] server action rejected:", reason);
        return toActionRejection(reason, unstable_isUnrecognizedActionError);
    }
};
