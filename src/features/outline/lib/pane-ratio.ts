/**
 * PC 2 ペインの横幅比 (左ペインの %) に関する純粋ロジック (docs/frontend-design.md §7.1)
 *
 * ドラッグ操作の座標 → 比率への変換と、localStorage から読んだ保存値の検証を純関数として切り出し、
 * DOM / localStorage に依存せず単体テストできるようにする（`pane-divider.tsx` から呼ぶ）
 */

/** 左ペイン比率の localStorage 保存キー */
export const PANE_RATIO_STORAGE_KEY = "dagdo.pane-ratio";

/**
 * 左ペインの初期比率 (%)
 *
 * SSR とのハイドレーション不整合を避けるため、初期レンダリングは常にこの値を使い、
 * localStorage からの復元は mount 後の `useEffect` で行う（`outline-shell.tsx`）
 */
export const DEFAULT_LEFT_PANE_RATIO = 60;

/** 左ペイン比率の可動域 (%) の下限 */
export const MIN_LEFT_PANE_RATIO = 25;

/** 左ペイン比率の可動域 (%) の上限 */
export const MAX_LEFT_PANE_RATIO = 75;

/** 比率を可動域 (`MIN_LEFT_PANE_RATIO`〜`MAX_LEFT_PANE_RATIO`) 内へ収める */
export const clampPaneRatio = (ratio: number): number => Math.min(MAX_LEFT_PANE_RATIO, Math.max(MIN_LEFT_PANE_RATIO, ratio));

/**
 * ポインタの X 座標から、コンテナ幅に対する左ペインの比率 (%) を求める
 *
 * @param clientX pointermove イベントの `clientX`
 * @param containerLeft 2 ペインの行コンテナの `getBoundingClientRect().left`
 * @param containerWidth 2 ペインの行コンテナの `getBoundingClientRect().width`
 * @returns 可動域内へ収めた比率 (%)。コンテナ幅が 0 以下（未測定・非表示）のときは算出できないため `null`
 */
export const computePaneRatioFromPointer = ({ clientX, containerLeft, containerWidth }: { clientX: number; containerLeft: number; containerWidth: number }): number | null => {
    if (containerWidth <= 0) {
        return null;
    }
    const rawRatio = ((clientX - containerLeft) / containerWidth) * 100;
    return clampPaneRatio(rawRatio);
};

/**
 * localStorage から読んだ文字列を左ペイン比率として検証する
 *
 * 数値として解釈できない値（未保存・手動書き換え）は `null` を返す。
 * 解釈できた値は、将来の可動域変更や外部からの書き換えで範囲外になっていても可動域内へ収めて返す
 */
export const parseStoredPaneRatio = (raw: string | null): number | null => {
    if (raw === null || raw.trim() === "") {
        // Number("") は 0 になる (JS の仕様上の落とし穴) ため、空文字は先に無効値として弾く
        return null;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
        return null;
    }
    return clampPaneRatio(parsed);
};
