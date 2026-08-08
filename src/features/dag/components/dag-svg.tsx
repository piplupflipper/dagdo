import type { JSX, KeyboardEvent } from "react";
import type { LocalSubgraphEdge, LocalSubgraphNode } from "@/features/dag/lib/compute-local-subgraph";
import type { AppTask } from "@/types/task";

/** DagSvg の props */
type DagSvgProps = {
    nodes: readonly LocalSubgraphNode[];
    edges: readonly LocalSubgraphEdge[];
    tasksById: ReadonlyMap<string, AppTask>;
    centerTaskId: string;
    flashTaskId: string | null;
    /** ノードクリック時のコールバック (呼び出し元が store.setCursor を呼ぶ想定) */
    onNodeClick: (taskId: string) => void;
};

type NodeStatus = "done" | "blocked" | "ready";

const NODE_WIDTH = 108;
const NODE_HEIGHT = 32;
const COLUMN_GAP = 56;
const ROW_GAP = 42;
const PADDING_X = 16;
const PADDING_Y = 16;
const TITLE_MAX_LENGTH = 9;

const NODE_FILL_CLASS: Record<NodeStatus, string> = {
    done: "fill-done/25",
    blocked: "fill-blocked/15",
    ready: "fill-accent/10",
};

const NODE_STROKE_CLASS: Record<NodeStatus, string> = {
    done: "stroke-done",
    blocked: "stroke-blocked",
    ready: "stroke-accent",
};

const NODE_TEXT_CLASS: Record<NodeStatus, string> = {
    done: "fill-text-dim",
    blocked: "fill-blocked",
    ready: "fill-accent",
};

const resolveNodeStatus = (task: AppTask | undefined): NodeStatus => {
    if (task === undefined) {
        return "ready";
    }
    if (task.completed_at !== null) {
        return "done";
    }
    return task.is_blocked ? "blocked" : "ready";
};

const truncateTitle = (title: string, max: number): string => (title.length > max ? `${title.slice(0, max - 1)}…` : title);

/**
 * ローカル DAG の SVG 描画 (docs/frontend-design.md §7.1, §7.2)
 *
 * 上流 (hop < 0) を左、下流 (hop > 0) を右に配置する横型レイアウト。矢印は blocker → dependent の向きに引く
 * ノードは状態色 (semantic トークン) で塗り分け、中心ノードは強調枠、flashTaskId のノードは点滅させる (prefers-reduced-motion では無効化)
 */
export const DagSvg = ({ nodes, edges, tasksById, centerTaskId, flashTaskId, onNodeClick }: DagSvgProps): JSX.Element => {
    const columns = new Map<number, LocalSubgraphNode[]>();
    for (const node of nodes) {
        const bucket = columns.get(node.hop);
        if (bucket === undefined) {
            columns.set(node.hop, [node]);
        } else {
            bucket.push(node);
        }
    }

    const sortedHops = Array.from(columns.keys()).sort((a, b) => a - b);
    const maxRows = Math.max(...Array.from(columns.values()).map((bucket) => bucket.length), 1);
    const columnContentHeight = maxRows * (NODE_HEIGHT + ROW_GAP) - ROW_GAP;

    const positions = new Map<string, { x: number; y: number }>();
    sortedHops.forEach((hop, columnIndex) => {
        const bucket = columns.get(hop) ?? [];
        const x = PADDING_X + columnIndex * (NODE_WIDTH + COLUMN_GAP);
        const bucketContentHeight = bucket.length * (NODE_HEIGHT + ROW_GAP) - ROW_GAP;
        const offsetY = (columnContentHeight - bucketContentHeight) / 2;
        bucket.forEach((node, rowIndex) => {
            const y = PADDING_Y + offsetY + rowIndex * (NODE_HEIGHT + ROW_GAP);
            positions.set(node.taskId, { x, y });
        });
    });

    const width = PADDING_X * 2 + sortedHops.length * NODE_WIDTH + Math.max(sortedHops.length - 1, 0) * COLUMN_GAP;
    const height = PADDING_Y * 2 + columnContentHeight;

    if (nodes.length <= 1) {
        return (
            <svg viewBox={`0 0 ${Math.max(width, 220)} ${Math.max(height, 80)}`} className="h-full min-w-[220px]" role="img" aria-label="依存グラフ">
                <text x="50%" y="50%" textAnchor="middle" dominantBaseline="middle" className="fill-text-dim text-[12px]">
                    依存関係なし (独立したタスク)
                </text>
            </svg>
        );
    }

    return (
        <svg viewBox={`0 0 ${width} ${height}`} className="h-full" style={{ minWidth: `${width}px` }} role="img" aria-label="依存グラフ">
            <defs>
                <marker id="dag-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                    <path d="M0,0L10,5L0,10z" className="fill-text-dim" />
                </marker>
                <style>
                    {`
                    @keyframes dag-node-blink {
                        0%, 100% { stroke-width: 2; }
                        50% { stroke: var(--color-overdue); stroke-width: 5; }
                    }
                    .dag-node-blink {
                        animation: dag-node-blink 0.35s ease-in-out 3;
                    }
                    @media (prefers-reduced-motion: reduce) {
                        .dag-node-blink { animation: none; }
                    }
                    `}
                </style>
            </defs>

            {edges.map((edge) => {
                const blockerPosition = positions.get(edge.blockerTaskId);
                const dependentPosition = positions.get(edge.dependentTaskId);
                if (blockerPosition === undefined || dependentPosition === undefined) {
                    return null;
                }
                const x1 = blockerPosition.x + NODE_WIDTH;
                const y1 = blockerPosition.y + NODE_HEIGHT / 2;
                const x2 = dependentPosition.x;
                const y2 = dependentPosition.y + NODE_HEIGHT / 2;
                return <line key={`${edge.blockerTaskId}->${edge.dependentTaskId}`} x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth={1.5} className="stroke-text-dim" markerEnd="url(#dag-arrow)" />;
            })}

            {nodes.map((node) => {
                const position = positions.get(node.taskId);
                if (position === undefined) {
                    return null;
                }
                const task = tasksById.get(node.taskId);
                const status = resolveNodeStatus(task);
                const isCenter = node.taskId === centerTaskId;
                const isFlashing = node.taskId === flashTaskId;
                const title = task?.title ?? node.taskId;
                const statusPrefix = status === "done" ? "✓ " : status === "blocked" ? "🔒 " : "";

                const handleActivate = (): void => onNodeClick(node.taskId);
                const handleKeyDown = (event: KeyboardEvent<SVGGElement>): void => {
                    if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        handleActivate();
                    }
                };

                return (
                    // biome-ignore lint/a11y/useSemanticElements: SVG 要素 (<g>) は <button> に置き換えられないため role="button" + onKeyDown で操作性を担保する
                    <g
                        key={node.taskId}
                        role="button"
                        tabIndex={0}
                        aria-label={`${title} にカーソルを移動`}
                        className={`cursor-pointer outline-none focus-visible:opacity-80 ${isFlashing ? "dag-node-blink" : ""}`}
                        onClick={handleActivate}
                        onKeyDown={handleKeyDown}
                    >
                        <title>{title}</title>
                        <rect
                            x={position.x}
                            y={position.y}
                            width={NODE_WIDTH}
                            height={NODE_HEIGHT}
                            rx={6}
                            strokeWidth={isCenter ? 2.4 : 1.4}
                            strokeDasharray={isCenter ? "3 2" : undefined}
                            className={`${NODE_FILL_CLASS[status]} ${NODE_STROKE_CLASS[status]}`}
                        />
                        <text x={position.x + NODE_WIDTH / 2} y={position.y + NODE_HEIGHT / 2 + 4} textAnchor="middle" className={`text-[11px] ${NODE_TEXT_CLASS[status]}`}>
                            {statusPrefix}
                            {truncateTitle(title, TITLE_MAX_LENGTH)}
                        </text>
                    </g>
                );
            })}
        </svg>
    );
};
