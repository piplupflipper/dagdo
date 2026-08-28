/**
 * 削除される行の後継としてカーソルを移す先の taskId を求める (Issue #76)
 *
 * vim の `dd` に合わせ、1 つ下の可視行を優先し、最終行なら 1 つ上の可視行を返す。
 * 他に行が無い・対象が可視行に無い場合は null (カーソルなし)。
 * 削除行の直下が削除行の子でも、論理削除は祖先を透明化するだけで子は可視に残るため (req.md §22)、後継として有効である
 */
export const findDeletionSuccessor = (visibleTaskIds: readonly string[], taskId: string): string | null => {
    const index = visibleTaskIds.indexOf(taskId);
    if (index === -1) {
        return null;
    }
    return visibleTaskIds[index + 1] ?? visibleTaskIds[index - 1] ?? null;
};
