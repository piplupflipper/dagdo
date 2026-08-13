import type { JSX } from "react";
import { useOutlineStore } from "@/store/outline-store";

type OutlineHeaderProps = {
    /** ヘルプオーバーレイが開いている間 true。ヘッダも背面として不活性にする (理由は outline-shell.tsx のコメント) */
    isInert: boolean;
    /** `+ 新規タスク`。キーボードの `o` と同じ経路 (カーソル行の下へ兄弟を作る) を通す */
    onCreateTask: () => void;
};

/**
 * 一覧上部のヘッダ (検索欄を開くボタン・VISUAL の切り替え・新規タスク・キーヒント)
 *
 * モードの参照と遷移はいずれも Zustand の selector 経由で行い、`useOutlineStore.getState()` の
 * 直接呼び出しは使わない (購読を伴わない読み出しはボタンの表示とモードがずれる余地を残すため)
 */
export const OutlineHeader = ({ isInert, onCreateTask }: OutlineHeaderProps): JSX.Element => {
    const mode = useOutlineStore((state) => state.mode);
    const enterSearch = useOutlineStore((state) => state.enterSearch);
    const enterVisual = useOutlineStore((state) => state.enterVisual);
    const exitVisual = useOutlineStore((state) => state.exitVisual);

    return (
        <div className="flex flex-shrink-0 items-center gap-2 border-b border-border bg-bg-alt px-3.5 py-2 backdrop-blur-xl" inert={isInert}>
            <button
                type="button"
                onClick={() => enterSearch()}
                className="flex min-w-0 flex-1 items-center gap-1.5 rounded-base border border-border bg-bg px-2.5 py-1.5 text-left text-xs text-text-dim md:min-w-[200px] md:flex-initial"
            >
                <span aria-hidden="true">⌕</span>
                <span className="truncate">/ で検索欄を開く</span>
            </button>
            <button
                type="button"
                onClick={() => (mode === "VISUAL" ? exitVisual() : enterVisual())}
                className="flex-shrink-0 rounded-base border border-border px-2.5 py-1.5 text-xs text-accent hover:bg-accent/10"
            >
                V ビジュアル
            </button>
            <button type="button" onClick={onCreateTask} className="flex-shrink-0 rounded-base border border-border px-2.5 py-1.5 text-xs text-accent hover:bg-accent/10">
                + 新規タスク
            </button>
            {/* キーボード操作のヒントはモバイル幅では意味がなく、横幅も圧迫するため md 以上でのみ表示する */}
            <span className="ml-auto hidden text-[11px] text-text-dim md:inline">j k 移動・x 完了・V 範囲選択・/ 検索・? ヘルプ</span>
        </div>
    );
};
