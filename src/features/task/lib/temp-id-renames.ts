/**
 * 楽観 create の tempId → 実 id 付け替えのうち、`outline` と `task-detail` の双方が使う判定
 *
 * 対応表を作って settle 前後にまたがって保つのは `outline` の create パイプライン
 * (`features/outline/lib/pending-create-registry.ts`) の役目であり、ここに置くのは
 * 「その対応表に載っている変化かどうか」を読むだけの述語である。
 * `DetailPane` は対応表の読み取り専用ビューだけを props で受け取るため、この述語を共有すれば足りる
 * (`task-detail` から `outline` を import せずに済ませるため、中立な `task` feature へ置く)
 */

/**
 * `previousId → nextId` の変化が、`renamedIds` に記録済みの「同一論理行の id 付け替え」かどうか
 *
 * カーソル移動の検知 (`outline-shell.tsx`) や `DetailPane` の `lastTaskId` の検知が、この付け替えを
 * 「別の行への移動」と誤認して編集中の下書きを畳んでしまわないためのガードに使う
 */
export const isSameLogicalRow = (renamedIds: ReadonlyMap<string, string>, previousId: string | null, nextId: string | null): boolean =>
    previousId !== null && nextId !== null && renamedIds.get(previousId) === nextId;
