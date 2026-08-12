import { type JSX, type PointerEvent as ReactPointerEvent, type RefObject, useRef, useState } from "react";
import { clampPaneRatio, computePaneRatioFromPointer, MAX_LEFT_PANE_RATIO, MIN_LEFT_PANE_RATIO } from "@/features/outline/lib/pane-ratio";

/** PaneDivider の props */
export type PaneDividerProps = {
    /** 2 ペインを並べる行コンテナへの参照。ポインタ位置を比率へ変換する基準の幅・左端をここから測る */
    containerRef: RefObject<HTMLDivElement | null>;
    /** 現在の左ペイン比率 (%)。ドラッグ中は都度これを更新した値が渡ってくる */
    ratio: number;
    /** ドラッグ中、ポインタ移動ごとに呼ぶ。楽観的に左ペイン幅を更新するだけで永続化はしない */
    onRatioChange: (ratio: number) => void;
    /** ドラッグ終了時に確定した比率で呼ぶ。呼び出し側 (OutlineShell) が localStorage への保存を行う */
    onDragEnd: (ratio: number) => void;
};

/**
 * PC 2 ペインの境界のドラッグハンドル (docs/frontend-design.md §7.1)
 *
 * `pointerdown` + `setPointerCapture` + `pointermove` で左ペインの比率を更新する。
 * dnd-kit の `DndContext`（行の並べ替え、`outline-pane.tsx`）の外に置き、行の dnd 操作と競合しない。
 * ドラッグ中は `body` に `user-select: none` を当ててテキスト選択を防ぎ、ドラッグ終了で必ず外す。
 * モバイル幅では 2 ペイン自体を表示しないため、このハンドルも `md` 以上でのみ表示する
 */
export const PaneDivider = ({ containerRef, ratio, onRatioChange, onDragEnd }: PaneDividerProps): JSX.Element => {
    const [isDragging, setIsDragging] = useState(false);
    /** ドラッグ終了時に直前の比率を確定させるための最新値。state 更新を待たずに読めるよう ref で持つ */
    const latestRatioRef = useRef(ratio);
    latestRatioRef.current = ratio;

    const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
        // テキスト選択やドラッグ画像生成などのブラウザ既定動作を止める
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        setIsDragging(true);
        document.body.style.userSelect = "none";
    };

    const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
        if (!isDragging) {
            return;
        }
        const container = containerRef.current;
        if (container === null) {
            return;
        }
        const rect = container.getBoundingClientRect();
        const nextRatio = computePaneRatioFromPointer({ clientX: event.clientX, containerLeft: rect.left, containerWidth: rect.width });
        if (nextRatio !== null) {
            onRatioChange(nextRatio);
        }
    };

    const endDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
        if (!isDragging) {
            return;
        }
        setIsDragging(false);
        document.body.style.userSelect = "";
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
        onDragEnd(clampPaneRatio(latestRatioRef.current));
    };

    return (
        // <hr> は role="separator" を暗黙に持つ (biome lint/a11y/useSemanticElements)。
        // aria-orientation 等は暗黙の role では決まらない縦横・値の情報のため、明示的に付けたままにする
        <hr
            aria-orientation="vertical"
            aria-valuenow={Math.round(ratio)}
            aria-valuemin={MIN_LEFT_PANE_RATIO}
            aria-valuemax={MAX_LEFT_PANE_RATIO}
            aria-label="左右ペインの幅"
            tabIndex={-1}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            // Tailwind preflight が hr へ既定で当てる border-top-width: 1px を打ち消す (border-y-0)。
            // 縦のバーとして border-x だけを使うため、上端に意図しない横線が出るのを防ぐ
            className={`hidden h-auto w-1.5 flex-shrink-0 touch-none cursor-col-resize border-x border-y-0 border-border transition-colors md:block ${isDragging ? "bg-accent/60" : "bg-transparent hover:bg-accent/30"}`}
        />
    );
};
