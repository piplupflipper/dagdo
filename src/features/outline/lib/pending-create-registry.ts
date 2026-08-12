/**
 * `createSibling` (outline-shell.tsx) が生成する tempId の、settle 前後をまたいだ状態を持つ純ロジック (バグ修正)
 *
 * `createTask` の楽観 create は tempId (crypto.randomUUID()) の行を即時表示し、Server Action 成功後に
 * 実 id へ切り替える。この「切り替え」の間に起きる 2 つの問題を解くための材料をここへ集約する。
 *
 * 1. settle 時 (`setCursor(tempId → 実id)`) や revalidate 到着 (tempId 行 → 実 id 行) によるカーソル/行の
 *    id 変化を、outline-shell のレンダー時調整 (「カーソルが別の行へ移ったら／編集中の行が表示行から
 *    消えたら行内編集を畳む」) が「別の行への移動」や「行の消失」と誤認し、編集中の下書きを破棄してしまう。
 *    `recordRename` で記録した対応を `isSameLogicalRow` で引き、「実体は同じ行の id 付け替えである」と
 *    判定できるようにする
 * 2. settle 前 (tempId がまだ pending) に Enter/Esc でタイトル編集を確定すると、以前は
 *    `isPendingTaskId` のガードが入力を黙って捨てていた。`queuePendingTitle` で tempId 宛に保留し、
 *    settle 後に `takePendingTitle` で取り出して実 id の通常パイプライン (楽観適用 + updateTask + undo 履歴)
 *    へ流す。create が失敗した場合は `discardPendingTitle` で保留分を破棄する
 */

/** tempId → 実 id の対応表と、settle 前に確定されたタイトルの保留キュー */
export type PendingCreateRegistry = {
    /** settle 済みの create について、tempId から実 id への対応 (「同一論理行」の判定に使う) */
    renamedIds: Map<string, string>;
    /** settle 前に Enter/Esc で確定されたタイトル (tempId ごとに最新の 1 件だけを保持) */
    pendingTitles: Map<string, string>;
};

/** 空のレジストリを作る (outline-shell.tsx で `useRef` の初期値として使う) */
export const createPendingCreateRegistry = (): PendingCreateRegistry => ({
    renamedIds: new Map(),
    pendingTitles: new Map(),
});

/** create の settle。tempId → 実 id の対応を記録する */
export const recordRename = (registry: PendingCreateRegistry, tempId: string, realId: string): void => {
    registry.renamedIds.set(tempId, realId);
};

/**
 * `previousId → nextId` の変化が、`recordRename` で記録済みの「同一論理行の id 付け替え」かどうか
 *
 * outline-shell のレンダー時調整 (カーソル移動検知、DetailPane の `lastTaskId` 検知) が、
 * この付け替えを「別の行への移動」として編集状態を畳んでしまわないためのガードに使う。
 * `renamedIds` だけを引数に取るのは、`DetailPane` (`detail-pane.tsx`) のように `PendingCreateRegistry`
 * 全体ではなく `renamedIds` の読み取り専用ビューだけを props で受け取る呼び出し元とも共有できるようにするため
 */
export const isSameLogicalRow = (renamedIds: ReadonlyMap<string, string>, previousId: string | null, nextId: string | null): boolean =>
    previousId !== null && nextId !== null && renamedIds.get(previousId) === nextId;

/** settle 前の Enter/Esc 確定を、tempId 宛の保留タイトルとしてキューに置く (同一 tempId は最新の 1 件で上書き) */
export const queuePendingTitle = (registry: PendingCreateRegistry, tempId: string, title: string): void => {
    registry.pendingTitles.set(tempId, title);
};

/** 保留タイトルを取り出して消費する (無ければ `undefined`)。create 失敗時の破棄にも使う */
export const takePendingTitle = (registry: PendingCreateRegistry, tempId: string): string | undefined => {
    const title = registry.pendingTitles.get(tempId);
    registry.pendingTitles.delete(tempId);
    return title;
};

/**
 * 実 id の行が `tasksById` (楽観 tasks) に現れたことを確認できた対応を、対応表から取り除く
 *
 * `renamedIds` を settle 時のまま放置すると、二度と剪定されずに増え続けるうえ、はるか後になって
 * 同じ実 id の行が (再編集中に) 正当に削除された場合でも `isAwaitingRenamedRow` 相当の判定が
 * 「まだ revalidate 待ち」と誤認し続けてしまう。行の実在を確認できた対応はもう不要なので、
 * 呼び出し元 (`outline-shell.tsx`) がレンダーごとにここを呼んで剪定する
 */
export const pruneConfirmedRenames = (registry: PendingCreateRegistry, isRowPresent: (realId: string) => boolean): void => {
    for (const [tempId, realId] of registry.renamedIds) {
        if (isRowPresent(realId)) {
            registry.renamedIds.delete(tempId);
        }
    }
};

/**
 * `id` で `byId` を引き、見つからなければ `renamedIds` を逆にたどって settle 前の tempId で引き直す
 *
 * `createSibling` の settle で cursor / inlineTitleEdit の id を tempId → 実id へ切り替えた直後、
 * revalidate 到着前の一瞬だけ `optimisticTasks` (`byId` の変換元) がまだ実id の行を持たず、
 * tempId の行しか持たない場合がある (診断 2)。この間だけ tempId 側の値へフォールバックし、
 * 呼び出し元 (`OutlineShell` の `cursorTask` 解決) に「行が消えた」と見せない。
 * `reidentify` は見つかった値の id 相当のフィールドを要求された `id` (実id) へ書き替える
 * (呼び出し元がフォールバック値の `id` を tempId のまま使って Server Action を呼んでしまわないようにするため)
 */
export const resolveRenamedLookup = <T>(byId: ReadonlyMap<string, T>, renamedIds: ReadonlyMap<string, string>, id: string, reidentify: (value: T, id: string) => T): T | undefined => {
    const direct = byId.get(id);
    if (direct !== undefined) {
        return direct;
    }
    for (const [tempId, realId] of renamedIds) {
        if (realId === id) {
            const fallback = byId.get(tempId);
            return fallback === undefined ? undefined : reidentify(fallback, id);
        }
    }
    return undefined;
};
