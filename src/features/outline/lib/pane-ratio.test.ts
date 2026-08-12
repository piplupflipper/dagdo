import { describe, expect, it } from "vitest";
import { clampPaneRatio, computePaneRatioFromPointer, MAX_LEFT_PANE_RATIO, MIN_LEFT_PANE_RATIO, parseStoredPaneRatio } from "@/features/outline/lib/pane-ratio";

describe("clampPaneRatio", () => {
    it("可動域内の値はそのまま返す", () => {
        expect(clampPaneRatio(50)).toBe(50);
    });

    it("下限未満は下限へ収める", () => {
        expect(clampPaneRatio(10)).toBe(MIN_LEFT_PANE_RATIO);
    });

    it("上限超過は上限へ収める", () => {
        expect(clampPaneRatio(90)).toBe(MAX_LEFT_PANE_RATIO);
    });
});

describe("computePaneRatioFromPointer", () => {
    it("コンテナ幅に対するポインタ位置の比率 (%) を返す", () => {
        expect(computePaneRatioFromPointer({ clientX: 500, containerLeft: 0, containerWidth: 1000 })).toBe(50);
    });

    it("containerLeft の分だけ相対位置を補正する", () => {
        expect(computePaneRatioFromPointer({ clientX: 600, containerLeft: 100, containerWidth: 1000 })).toBe(50);
    });

    it("算出結果が可動域外なら収める", () => {
        expect(computePaneRatioFromPointer({ clientX: 10, containerLeft: 0, containerWidth: 1000 })).toBe(MIN_LEFT_PANE_RATIO);
        expect(computePaneRatioFromPointer({ clientX: 990, containerLeft: 0, containerWidth: 1000 })).toBe(MAX_LEFT_PANE_RATIO);
    });

    it("コンテナ幅が 0 以下のときは null を返す", () => {
        expect(computePaneRatioFromPointer({ clientX: 500, containerLeft: 0, containerWidth: 0 })).toBeNull();
        expect(computePaneRatioFromPointer({ clientX: 500, containerLeft: 0, containerWidth: -10 })).toBeNull();
    });
});

describe("parseStoredPaneRatio", () => {
    it("null はそのまま null を返す (未保存)", () => {
        expect(parseStoredPaneRatio(null)).toBeNull();
    });

    it("数値として解釈できない文字列は null を返す", () => {
        expect(parseStoredPaneRatio("not-a-number")).toBeNull();
        expect(parseStoredPaneRatio("")).toBeNull();
    });

    it("可動域内の保存値はそのまま返す", () => {
        expect(parseStoredPaneRatio("55")).toBe(55);
    });

    it("可動域外の保存値は収めて返す", () => {
        expect(parseStoredPaneRatio("5")).toBe(MIN_LEFT_PANE_RATIO);
        expect(parseStoredPaneRatio("95")).toBe(MAX_LEFT_PANE_RATIO);
    });
});
