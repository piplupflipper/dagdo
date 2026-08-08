import type { TaskDependency } from "@/types/task";

/** ローカル DAG の 1 ノード */
export type LocalSubgraphNode = {
    taskId: string;
    /** centerTaskId からのホップ数。負が上流 (依存先/blocker 側)、正が下流 (依存元側)、0 が center 自身 */
    hop: number;
};

/** ローカル DAG の 1 エッジ。dependentTaskId が blockerTaskId に依存することを表す */
export type LocalSubgraphEdge = {
    dependentTaskId: string;
    blockerTaskId: string;
};

/** compute-local-subgraph.ts の出力 */
export type LocalSubgraph = {
    nodes: LocalSubgraphNode[];
    edges: LocalSubgraphEdge[];
};

const DEFAULT_MAX_HOPS = 2;

/**
 * centerTaskId を中心に、依存グラフを上流・下流それぞれ maxHops ホップまで抽出する純関数 (docs/frontend-design.md §7.2)
 *
 * 上流 (負のホップ) は centerTaskId が (間接的に) 依存しているタスク、
 * 下流 (正のホップ) は centerTaskId に (間接的に) 依存しているタスクを表す
 * hopOf による訪問済み管理で同一タスクを再訪しないため、循環データが混入しても無限ループにならない
 * エッジは隣接ホップ間のもの (|dependentHop - blockerHop| === 1) のみを返し、複数ホップ離れた迂回エッジは含めない
 */
export const computeLocalSubgraph = ({
    centerTaskId,
    dependencies,
    maxHops = DEFAULT_MAX_HOPS,
}: {
    centerTaskId: string;
    dependencies: readonly TaskDependency[];
    maxHops?: number;
}): LocalSubgraph => {
    const hopOf = new Map<string, number>([[centerTaskId, 0]]);

    let upstreamFrontier: string[] = [centerTaskId];
    for (let hop = 1; hop <= maxHops; hop += 1) {
        const next: string[] = [];
        for (const taskId of upstreamFrontier) {
            for (const dependency of dependencies) {
                if (dependency.task_id === taskId && !hopOf.has(dependency.depends_on_task_id)) {
                    hopOf.set(dependency.depends_on_task_id, -hop);
                    next.push(dependency.depends_on_task_id);
                }
            }
        }
        upstreamFrontier = next;
    }

    let downstreamFrontier: string[] = [centerTaskId];
    for (let hop = 1; hop <= maxHops; hop += 1) {
        const next: string[] = [];
        for (const taskId of downstreamFrontier) {
            for (const dependency of dependencies) {
                if (dependency.depends_on_task_id === taskId && !hopOf.has(dependency.task_id)) {
                    hopOf.set(dependency.task_id, hop);
                    next.push(dependency.task_id);
                }
            }
        }
        downstreamFrontier = next;
    }

    const nodes: LocalSubgraphNode[] = Array.from(hopOf.entries()).map(([taskId, hop]) => ({ taskId, hop }));

    const edges: LocalSubgraphEdge[] = [];
    for (const dependency of dependencies) {
        const dependentHop = hopOf.get(dependency.task_id);
        const blockerHop = hopOf.get(dependency.depends_on_task_id);
        if (dependentHop === undefined || blockerHop === undefined) {
            continue;
        }
        if (dependentHop - blockerHop === 1) {
            edges.push({ dependentTaskId: dependency.task_id, blockerTaskId: dependency.depends_on_task_id });
        }
    }

    return { nodes, edges };
};
