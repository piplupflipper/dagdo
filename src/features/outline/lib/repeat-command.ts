/**
 * ドットリピート (`.`) のレジスタに記録する変更の記述子 (Issue #74)
 *
 * 方式は「コマンド再発行」であり、Op (絶対値) の再生ではない。変更の意図だけを記述子として
 * 直近 1 件レジスタ (use-outline-mutations.ts の state) へ記録し、`.` が現在のカーソルに対して
 * 既存ハンドラを再ディスパッチする。記録対象はこの 5 種のみで、`o`/`O`・タイトル/説明/期日の確定・
 * dnd・VISUAL 一括完了・undo/redo は記録しない
 */
export type RepeatableCommand =
    | { kind: "complete" } // x
    | { kind: "softDelete" } // dd
    | { kind: "reorder"; direction: "up" | "down" } // J / K
    | { kind: "indent" } // >
    | { kind: "outdent" }; // <

/**
 * 記述子の再発行先となるハンドラ群
 *
 * use-outline-mutations.ts が持つカーソル操作ハンドラの部分型。`.` の実行がレジスタを
 * 上書きしないよう、渡すのは「レジスタへ記録しない版」でなければならない
 */
export type RepeatCommandHandlers = {
    /** `x` 相当。カーソル行を完了する */
    completeCursor: () => void;
    /** `dd` 相当。カーソル行をゴミ箱へ移動する */
    softDeleteCursor: () => void;
    /** `J` / `K` 相当。同一階層で 1 つ下 / 上へ移動する */
    moveCursorSibling: (direction: "up" | "down") => void;
    /** `>` 相当。直前行を新しい親にする */
    indentCursor: () => void;
    /** `<` 相当。親を 1 階層上げる */
    outdentCursor: () => void;
};

/**
 * 記述子を対応するハンドラの呼び出しへ変換する (`.` の再発行)
 *
 * React に依存しない純関数であり、記述子とハンドラの対応はここが単一の正である
 */
export const dispatchRepeatCommand = (command: RepeatableCommand, handlers: RepeatCommandHandlers): void => {
    switch (command.kind) {
        case "complete":
            handlers.completeCursor();
            return;
        case "softDelete":
            handlers.softDeleteCursor();
            return;
        case "reorder":
            handlers.moveCursorSibling(command.direction);
            return;
        case "indent":
            handlers.indentCursor();
            return;
        case "outdent":
            handlers.outdentCursor();
            return;
    }
};
