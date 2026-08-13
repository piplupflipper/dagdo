import { type Dispatch, type SetStateAction, useState } from "react";
import type { InlineTitleEdit } from "@/features/outline/lib/inline-title-edit";
import { type PendingCreateRegistry, pruneConfirmedRenames } from "@/features/outline/lib/pending-create-registry";
import { isSameLogicalRow } from "@/features/task/lib/temp-id-renames";
import type { AppTask } from "@/types/task";

type UsePendingCreateArgs = {
    /** tempId → 実id の対応表。差し込み (`mergeSettledRows`) がツリー構築より前に要るため `OutlineShell` が持つ */
    registry: PendingCreateRegistry;
    cursorTaskId: string | null;
    /** つなぎの行を差し込んだ後の一覧を id で引ける形にしたもの */
    tasksById: ReadonlyMap<string, AppTask>;
    /**
     * 差し込む前 (楽観適用まで) の一覧の id 集合
     *
     * 剪定の判定にはこちらを使う。差し込んだ後の集合で判定すると、自分が差し込んだつなぎの行を見て
     * 即座に剪定してしまう (pending-create-registry.ts の `pruneConfirmedRenames` 参照)
     */
    optimisticTaskIds: ReadonlySet<string>;
    /** 折りたたみ・検索の絞り込み後に実際に描かれる行の id 列 */
    visibleTaskIdList: readonly string[];
    inlineTitleEdit: InlineTitleEdit | null;
    setInlineTitleEdit: Dispatch<SetStateAction<InlineTitleEdit | null>>;
};

/**
 * 楽観 create の tempId → 実id 付け替えにまつわる、レンダー中の調整をまとめたフック
 *
 * `createTask` の settle で tempId が実id へ切り替わる瞬間、素朴に見ると「別の行へカーソルが移った」
 * 「編集中の行が消えた」ように見えてしまい、行内タイトル編集が勝手に畳まれる。
 * 対応表 (pending-create-registry.ts) を見て「同一論理行の付け替え」を除外する判定を、
 * 対応表の剪定と合わせてここへ集約する。
 * `DetailPane` 側の同種の調整 (`lastTaskId`) には、`registry.renamedIds` を渡して同じ判定をさせる。
 *
 * 対応表そのものは `OutlineShell` が `useRef` で持つ。settle 済みで revalidate 未到着の行を一覧へ
 * 差し込む処理 (`mergeSettledRows`、Issue #60) がツリー構築より前に走る必要があり、
 * 本フックの呼び出し (ツリー構築の後) では間に合わないためである。
 *
 * 呼び出し側は `tasksById` と `visibleTaskIdList` を先に組み立ててから呼ぶ。
 * 対応表への操作 (カーソル移動の判定 → 剪定 → 表示行消失の判定) はこの順序に意味があり、
 * 剪定が先に走ると直前の付け替えを見落とすため、3 つを 1 か所に閉じて順序を固定している
 */
export const usePendingCreate = ({ registry, cursorTaskId, tasksById, optimisticTaskIds, visibleTaskIdList, inlineTitleEdit, setInlineTitleEdit }: UsePendingCreateArgs): AppTask | null => {
    // カーソルが別の行へ移ったら行内編集を畳む (行のクリックなど、input の外で起きた移動を拾う)。
    // useEffect による同期ではなくレンダー中の state 調整で行う (detail-pane.tsx の lastTaskId と同じパターン)。
    // ただし、この変化が createSibling の settle による tempId → 実id の付け替え (同一論理行) であれば、
    // 「別の行へ移った」わけではないので畳まない
    const [lastCursorTaskId, setLastCursorTaskId] = useState<string | null>(cursorTaskId);
    if (cursorTaskId !== lastCursorTaskId) {
        const isSameRowRename = isSameLogicalRow(registry.renamedIds, lastCursorTaskId, cursorTaskId);
        setLastCursorTaskId(cursorTaskId);
        if (inlineTitleEdit !== null && !isSameRowRename) {
            setInlineTitleEdit(null);
        }
    }

    // 実 id の行が一覧に現れたのを確認できた tempId 対応は、対応表から剪定する。
    // 放置すると対応表が増え続けるうえ、はるか後になって同じ実id の行が (再編集中に) 正当に削除された場合でも
    // 下の isAwaitingRenamedRow が「まだ revalidate 待ち」と誤認し続けてしまう (pending-create-registry.ts 参照)。
    // 判定に使うのは差し込み前の id 集合である (差し込んだつなぎの行を「現れた」と見ないため)
    pruneConfirmedRenames(registry, (realId) => optimisticTaskIds.has(realId));

    // 編集中の行が表示行の集合から消えた場合も行内編集を畳む (`zM` / `zc` による折りたたみ、検索の絞り込み、他経路での削除)。
    // 上のカーソル移動による解除と同じくレンダー中の state 調整で行う。
    // キー経由でここに来ることはない (編集中はフォーカスが input にあり dispatcher が isEditableTarget で素通しする) が、
    // 行の折りたたみボタンのクリックのようにキーボード以外の経路で表示行が変わったとき、
    // input が unmount されたまま inlineTitleEdit だけが残るのを防ぐ。
    // ただし、createSibling の settle で tempId → 実id へ付け替えた直後、revalidate 到着前の一瞬だけ
    // 実id の行がまだ一覧に存在しない場合があるため、その付け替え先の id である間は
    // 「消えた」と誤認せず待つ (revalidate 到着後、行が現れれば通常判定に戻る)
    const isAwaitingRenamedRow = inlineTitleEdit !== null && !tasksById.has(inlineTitleEdit.taskId) && Array.from(registry.renamedIds.values()).includes(inlineTitleEdit.taskId);
    if (inlineTitleEdit !== null && !visibleTaskIdList.includes(inlineTitleEdit.taskId) && !isAwaitingRenamedRow) {
        setInlineTitleEdit(null);
    }

    // カーソル行のタスク (DetailPane / MobileDetailSheet へそのまま渡る)。
    // settle で cursorTaskId が実 id へ付け替わった後も、一覧は mergeSettledRows で実 id 名義に揃えてあるため
    // そのまま引ける (以前は tempId の行を実 id 名義で拾い直す経路をここに持っていたが、
    // 揃える場所を一覧側の 1 か所にまとめたので不要になった)
    return cursorTaskId === null ? null : (tasksById.get(cursorTaskId) ?? null);
};
