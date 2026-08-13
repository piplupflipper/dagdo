import { type RefObject, useRef } from "react";

/** taskId → 行の HTMLElement を保持する Map への参照 */
export type RowRefMap = Map<string, HTMLDivElement>;

type UseRowRefsResult = {
    /** 行コンポーネントの ref コールバックを taskId 単位で生成する */
    registerRow: (taskId: string) => (element: HTMLDivElement | null) => void;
    /** DependencyRail 等、位置測定側が読む Map への参照 (再レンダーを発生させない) */
    rowMapRef: RefObject<RowRefMap>;
};

/**
 * 行の DOM 位置測定用の ref Map を管理するフック (docs/frontend-design.md §7.2)
 *
 * OutlineRow がマウント時に自身の HTMLElement を taskId 単位で登録し、
 * DependencyRail (ガターの依存レール) がこの Map から getBoundingClientRect() を用いて
 * 各行の相対 y 座標を算出する。Map の更新自体は再レンダーを発生させない (ref による保持)
 */
export const useRowRefs = (): UseRowRefsResult => {
    const rowMapRef = useRef<RowRefMap>(new Map());

    const registerRow =
        (taskId: string) =>
        (element: HTMLDivElement | null): void => {
            if (element === null) {
                rowMapRef.current.delete(taskId);
                return;
            }
            rowMapRef.current.set(taskId, element);
        };

    return { registerRow, rowMapRef };
};
