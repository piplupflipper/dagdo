"use client";

import type { JSX } from "react";
import { computeLocalSubgraph } from "@/features/dag/lib/compute-local-subgraph";
import { useOutlineStore } from "@/store/outline-store";
import type { AppTask, TaskDependency } from "@/types/task";
import { DagSvg } from "./dag-svg";

/** DagPanel の props (OutlineShell が参照する公開契約。シグネチャ変更禁止) */
type DagPanelProps = {
    centerTaskId: string | null;
    tasks: AppTask[];
    dependencies: TaskDependency[];
    flashTaskId: string | null;
};

/**
 * 右ペイン下部の常設ローカル DAG パネル。高さ 220px 固定 (docs/frontend-design.md §4, §7.1, §7.2)
 *
 * centerTaskId から compute-local-subgraph で ±2 ホップの部分グラフを抽出して DagSvg に渡す
 * ノードが多い場合に備え、SVG は実ピクセル幅で描画し横スクロールを許容する
 * ノードクリックで store.setCursor を呼びカーソル位置を移動する
 */
export const DagPanel = ({ centerTaskId, tasks, dependencies, flashTaskId }: DagPanelProps): JSX.Element => {
    const setCursor = useOutlineStore((state) => state.setCursor);
    const tasksById = new Map(tasks.map((task) => [task.id, task]));
    const subgraph = centerTaskId !== null ? computeLocalSubgraph({ centerTaskId, dependencies }) : null;

    return (
        <div className="flex h-[220px] shrink-0 flex-col border-t border-border bg-bg-sunken">
            <div className="shrink-0 px-3.5 pt-2 pb-0.5 text-[11.5px] text-text-dim">
                依存グラフ <span className="opacity-65">(選択タスク中心 ±2 ホップ)</span>
            </div>
            <div className="min-h-0 flex-1 overflow-x-auto px-2 pb-2">
                {subgraph === null || centerTaskId === null ? (
                    <div className="flex h-full items-center justify-center text-xs text-text-dim">タスクを選択してください</div>
                ) : (
                    <DagSvg nodes={subgraph.nodes} edges={subgraph.edges} tasksById={tasksById} centerTaskId={centerTaskId} flashTaskId={flashTaskId} onNodeClick={setCursor} />
                )}
            </div>
        </div>
    );
};
