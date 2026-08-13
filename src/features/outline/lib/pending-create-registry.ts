/**
 * `createSibling` (outline-shell.tsx) が生成する tempId の、settle 前後をまたいだ状態を持つ純ロジック (バグ修正)
 *
 * `createTask` の楽観 create は tempId (crypto.randomUUID()) の行を即時表示し、Server Action 成功後に
 * 実 id へ切り替える。この「切り替え」の間に起きる次の問題を解くための材料をここへ集約する。
 *
 * 1. settle 時 (`setCursor(tempId → 実id)`) や revalidate 到着 (tempId 行 → 実 id 行) によるカーソル/行の
 *    id 変化を、outline-shell のレンダー時調整 (「カーソルが別の行へ移ったら／編集中の行が表示行から
 *    消えたら行内編集を畳む」) が「別の行への移動」や「行の消失」と誤認し、編集中の下書きを破棄してしまう。
 *    `recordRename` で記録した対応を `isSameLogicalRow`
 *    (`features/task/lib/temp-id-renames.ts`。`DetailPane` も使うため中立な場所に置いてある) で引き、
 *    「実体は同じ行の id 付け替えである」と判定できるようにする
 * 2. settle 前 (tempId がまだ pending) に Enter/Esc でタイトル編集を確定すると、以前は
 *    `isPendingTaskId` のガードが入力を黙って捨てていた。`queuePendingTitle` で tempId 宛に保留し、
 *    settle 後に `takePendingTitle` で取り出して実 id の通常パイプライン (楽観適用 + updateTask + undo 履歴)
 *    へ流す。create が失敗した場合は `takePendingTitle` の戻り値を捨てて保留分を破棄する
 * 3. settle から revalidate 到着までの間、作成した行はどの一覧にも存在しない (Issue #60)。
 *    `useOptimistic` の楽観 op は startTransition の完了で捨てられる一方、サーバー由来の一覧に実 id の行が
 *    現れるのは RSC の再描画が届いてからだからである。この間に行が消えると、ストアの `setVisibleTaskIds` が
 *    「カーソルが可視行に無い」と見てカーソルを先頭行へ寄せ、その移動が行内編集を畳んでフォーカスを落とす。
 *    `recordRename` で実 id 名義のスナップショットを預かり、`mergeSettledRows` で一覧へ差し込んで窓を埋める
 * 4. 付け替えで行の id が変わると、id を React の `key` にしている一覧は行を作り直す (Issue #62)。
 *    行内編集中の `input` まで作り直され、キャレットが `caret` の指定位置へ巻き戻る。
 *    `rowKeys` に「実 id → 最初の tempId」を残し、`resolveRowKey` が返す論理キーを `key` に使うことで、
 *    付け替えをまたいで行の DOM 同一性を保つ
 */

import type { AppTask } from "@/types/task";

/** tempId → 実 id の対応表と、settle 済みで revalidate 未到着の行、行の論理キー、settle 前に確定されたタイトルの保留キュー */
export type PendingCreateRegistry = {
    /** settle 済みの create について、tempId から実 id への対応 (「同一論理行」の判定に使う) */
    renamedIds: Map<string, string>;
    /** settle 済みだが実 id の行がまだ一覧に現れていない create の行 (実 id 名義)。キーは実 id */
    settledRows: Map<string, AppTask>;
    /**
     * 実 id → その行に最初に採番した tempId (行の DOM 同一性を保つための論理キー、Issue #62)
     *
     * `renamedIds` や `settledRows` と違い、**剪定しない**。剪定するとその時点で `key` が実 id へ戻り、
     * まさに避けたい再マウントがそこで起きるためである。保持量はページのセッション中に作成した
     * 行 1 件あたり 1 エントリで、実用上の上限になる
     */
    rowKeys: Map<string, string>;
    /** settle 前に Enter/Esc で確定されたタイトル (tempId ごとに最新の 1 件だけを保持) */
    pendingTitles: Map<string, string>;
};

/** 空のレジストリを作る (outline-shell.tsx で `useRef` の初期値として使う) */
export const createPendingCreateRegistry = (): PendingCreateRegistry => ({
    renamedIds: new Map(),
    settledRows: new Map(),
    rowKeys: new Map(),
    pendingTitles: new Map(),
});

/**
 * create の settle。tempId → 実 id の対応と、revalidate 到着までのつなぎに使う行、行の論理キーを記録する
 *
 * `row` は `createSibling` が undo 履歴のために先読みしている「作成直後の行」(実 id 名義) である。
 * 先読みに失敗した場合 (undefined) はつなぎの行を持てないだけで、対応表の記録は行う
 */
export const recordRename = (registry: PendingCreateRegistry, tempId: string, realId: string, row: AppTask | undefined): void => {
    registry.renamedIds.set(tempId, realId);
    registry.rowKeys.set(realId, tempId);
    if (row !== undefined) {
        registry.settledRows.set(realId, row);
    }
};

/**
 * 行の React key に使う論理キーを引く (Issue #62)
 *
 * settle で行の id は tempId から実 id へ変わるが、React から見て同じ行であり続けてほしい。
 * id をそのまま `key` にすると付け替えの瞬間に行のサブツリーが作り直され、行内編集中の `input` も
 * 作り直されてキャレットが `caret` の指定位置へ巻き戻る。最初の tempId を通し番号として使うことで、
 * 付け替えをまたいで `key` が変わらないようにする。
 * create を経ていない行 (サーバー由来の行) は対応表に載らないので、自分の id がそのまま論理キーになる
 */
export const resolveRowKey = (rowKeys: ReadonlyMap<string, string>, taskId: string): string => rowKeys.get(taskId) ?? taskId;

/**
 * 楽観適用後の一覧を、settle 済みの create が実 id 名義で並ぶ形に整える
 *
 * settle した時点でカーソルや行内編集の id は実 id へ切り替わる (`createSibling`) 一方、一覧の側は
 * しばらく実 id の行を持たない。両者が食い違う間は「カーソル行が可視行に無い」状態になり、
 * ストアの `setVisibleTaskIds` がカーソルを先頭行へ寄せてしまう。そこで次の 2 つを行う。
 *
 * 1. まだ生きている tempId の楽観行は、実 id 名義に読み替える (実 id の行が既に来ていれば重複なので落とす)
 * 2. 楽観行も実 id の行も無くなった分は、settle 時に預かったスナップショットで埋める
 *    (`startTransition` の完了で楽観 op が捨てられてから、`revalidatePath` の再描画が届くまでの窓)
 *
 * 並び順は気にしなくてよい。`sort_path` を持つ行をそのまま渡せば `buildOutlineTree` が並べ替える
 */
export const mergeSettledRows = (tasks: AppTask[], registry: PendingCreateRegistry): AppTask[] => {
    if (registry.renamedIds.size === 0) {
        return tasks;
    }
    const presentIds = new Set(tasks.map((task) => task.id));

    const renamedRows: AppTask[] = [];
    for (const task of tasks) {
        const realId = registry.renamedIds.get(task.id);
        if (realId === undefined) {
            renamedRows.push(task);
            continue;
        }
        if (presentIds.has(realId)) {
            continue;
        }
        renamedRows.push({ ...task, id: realId });
    }

    const missingRows: AppTask[] = [];
    for (const [tempId, realId] of registry.renamedIds) {
        if (presentIds.has(realId) || presentIds.has(tempId)) {
            continue;
        }
        const row = registry.settledRows.get(realId);
        if (row !== undefined) {
            missingRows.push(row);
        }
    }

    return missingRows.length === 0 ? renamedRows : [...renamedRows, ...missingRows];
};

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
 * 実 id の行が楽観適用後の一覧に現れたことを確認できた対応を、対応表から取り除く
 *
 * `renamedIds` を settle 時のまま放置すると、二度と剪定されずに増え続けるうえ、はるか後になって
 * 同じ実 id の行が (再編集中に) 正当に削除された場合でも `isAwaitingRenamedRow` 相当の判定が
 * 「まだ revalidate 待ち」と誤認し続けてしまう。行の実在を確認できた対応はもう不要なので、
 * 呼び出し元 (`use-pending-create.ts`) がレンダーごとにここを呼んで剪定する。
 * つなぎの行 (`settledRows`) も同じ寿命で、実 id の行が現れた時点で用済みになる。
 *
 * `isRowPresent` には `mergeSettledRows` を通す前の一覧で判定させること。
 * 差し込んだ後の一覧で判定すると、自分が差し込んだつなぎの行を見て即座に剪定してしまい、
 * 次のレンダーで行がまた消える (差し込みと剪定が交互に起きる)
 */
export const pruneConfirmedRenames = (registry: PendingCreateRegistry, isRowPresent: (realId: string) => boolean): void => {
    for (const [tempId, realId] of registry.renamedIds) {
        if (isRowPresent(realId)) {
            registry.renamedIds.delete(tempId);
            registry.settledRows.delete(realId);
        }
    }
};
