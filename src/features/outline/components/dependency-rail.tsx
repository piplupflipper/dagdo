import { type JSX, type RefObject, useEffect, useRef, useState } from "react";
import type { RowRefMap } from "@/features/outline/hooks/use-row-refs";
import type { AppTask, TaskDependency } from "@/types/task";

export type DependencyRailProps = {
    containerRef: RefObject<HTMLDivElement | null>;
    rowMapRef: RefObject<RowRefMap>;
    visibleTaskIds: readonly string[];
    dependencies: readonly TaskDependency[];
    tasksById: ReadonlyMap<string, AppTask>;
    cursorTaskId: string | null;
};

type RailLine = {
    key: string;
    y1: number;
    y2: number;
    color: string;
    strokeWidth: number;
    opacity: number;
};

type GeometryInputs = {
    visibleTaskIds: readonly string[];
    dependencies: readonly TaskDependency[];
    tasksById: ReadonlyMap<string, AppTask>;
    cursorTaskId: string | null;
};

type GeometryResult = {
    lines: RailLine[];
    height: number;
};

const RAIL_X = 10;
const RESIZE_DEBOUNCE_MS = 100;

/** タスクの状態から依存レールの線色を決める。blocked への線は琥珀、完了区間はグレーにする (docs/frontend-design.md §7.2、実装要点 5) */
const lineColorFor = (fromTask: AppTask | undefined, toTask: AppTask | undefined): string => {
    if (toTask?.is_blocked === true) {
        return "var(--color-blocked)";
    }
    if (fromTask?.completed_at !== null && fromTask?.completed_at !== undefined) {
        return "var(--color-done)";
    }
    return "var(--color-accent)";
};

/**
 * 行の DOM 位置から依存レールの線分ジオメトリを計算する純粋関数 (モジュールレベル)
 *
 * コンポーネント内のクロージャにせず外出しすることで、呼び出し側の useEffect が
 * 「毎レンダー変わる関数」を依存配列に含めずに済むようにする (docs/frontend-design.md §7.2)
 */
const computeGeometry = (container: HTMLDivElement, rowMap: RowRefMap, inputs: GeometryInputs): GeometryResult => {
    const { visibleTaskIds, dependencies, tasksById, cursorTaskId } = inputs;
    const visibleIdSet = new Set(visibleTaskIds);
    const edges = dependencies.filter((dependency) => visibleIdSet.has(dependency.task_id) && visibleIdSet.has(dependency.depends_on_task_id));
    const containerRect = container.getBoundingClientRect();

    const centerYOf = (taskId: string): number | null => {
        const element = rowMap.get(taskId);
        if (element === undefined) {
            return null;
        }
        const rect = element.getBoundingClientRect();
        return rect.top - containerRect.top + container.scrollTop + rect.height / 2;
    };

    const lines: RailLine[] = [];
    for (const edge of edges) {
        const y1 = centerYOf(edge.depends_on_task_id);
        const y2 = centerYOf(edge.task_id);
        if (y1 === null || y2 === null) {
            continue;
        }
        const isRelatedToCursor = edge.task_id === cursorTaskId || edge.depends_on_task_id === cursorTaskId;
        lines.push({
            key: `${edge.depends_on_task_id}->${edge.task_id}`,
            y1,
            y2,
            color: lineColorFor(tasksById.get(edge.depends_on_task_id), tasksById.get(edge.task_id)),
            strokeWidth: isRelatedToCursor ? 2.4 : 1.4,
            opacity: isRelatedToCursor ? 1 : 0.45,
        });
    }

    return { lines, height: Math.max(container.scrollHeight, 1) };
};

/**
 * ガターの依存レール SVG (docs/frontend-design.md §7.2、実装要点 5)
 *
 * use-row-refs が保持する行の DOM 位置から、依存元 (depends_on_task_id) → 依存先 (task_id) の
 * 縦方向エッジを描画する。再計算はマウント時即時 / スクロール時 rAF スロットル /
 * ResizeObserver 時トレーリングデバウンス 100ms の 3 段構成 (docs/frontend-design.md §7.2 確定事項)
 */
export const DependencyRail = ({ containerRef, rowMapRef, visibleTaskIds, dependencies, tasksById, cursorTaskId }: DependencyRailProps): JSX.Element => {
    const [lines, setLines] = useState<RailLine[]>([]);
    const [height, setHeight] = useState(1);
    const rafIdRef = useRef<number | null>(null);
    const debounceIdRef = useRef<number | null>(null);
    // スクロール/ResizeObserver のリスナーはマウント時に 1 度だけ登録したいが、
    // 発火時点での最新の props を参照したいため ref 経由で渡す (再登録によるリスナー着脱を避ける)
    const latestInputsRef = useRef<GeometryInputs>({ visibleTaskIds, dependencies, tasksById, cursorTaskId });
    latestInputsRef.current = { visibleTaskIds, dependencies, tasksById, cursorTaskId };

    // マウント時 (初回描画) と、折りたたみ・revalidate・楽観的更新など構造が変化したタイミングでは
    // 間引かずに即時再計算する。初回描画時もこの effect が最初のレンダー後に実行されるためカバーされる (docs/frontend-design.md §7.2)
    useEffect(() => {
        const container = containerRef.current;
        if (container === null) {
            return;
        }
        const result = computeGeometry(container, rowMapRef.current, { visibleTaskIds, dependencies, tasksById, cursorTaskId });
        setLines(result.lines);
        setHeight(result.height);
    }, [containerRef, rowMapRef, visibleTaskIds, dependencies, tasksById, cursorTaskId]);

    // スクロール: requestAnimationFrame でフレームあたり 1 回に制限する
    useEffect(() => {
        const container = containerRef.current;
        if (container === null) {
            return;
        }
        const handleScroll = (): void => {
            if (rafIdRef.current !== null) {
                return;
            }
            rafIdRef.current = window.requestAnimationFrame(() => {
                rafIdRef.current = null;
                const result = computeGeometry(container, rowMapRef.current, latestInputsRef.current);
                setLines(result.lines);
                setHeight(result.height);
            });
        };
        container.addEventListener("scroll", handleScroll, { passive: true });
        return () => {
            container.removeEventListener("scroll", handleScroll);
            if (rafIdRef.current !== null) {
                window.cancelAnimationFrame(rafIdRef.current);
            }
        };
    }, [containerRef, rowMapRef]);

    // ResizeObserver: トレーリングデバウンス 100ms を入れる
    useEffect(() => {
        const container = containerRef.current;
        if (container === null) {
            return;
        }
        const observer = new ResizeObserver(() => {
            if (debounceIdRef.current !== null) {
                window.clearTimeout(debounceIdRef.current);
            }
            debounceIdRef.current = window.setTimeout(() => {
                debounceIdRef.current = null;
                const result = computeGeometry(container, rowMapRef.current, latestInputsRef.current);
                setLines(result.lines);
                setHeight(result.height);
            }, RESIZE_DEBOUNCE_MS);
        });
        observer.observe(container);
        return () => {
            observer.disconnect();
            if (debounceIdRef.current !== null) {
                window.clearTimeout(debounceIdRef.current);
            }
        };
    }, [containerRef, rowMapRef]);

    return (
        <div className="w-6 flex-shrink-0 border-r border-border bg-bg-alt" aria-hidden="true">
            <svg className="block h-full w-full overflow-visible" viewBox={`0 0 24 ${height}`} preserveAspectRatio="none" role="presentation">
                {lines.map((line) => (
                    <line key={line.key} x1={RAIL_X} y1={line.y1} x2={RAIL_X} y2={line.y2} stroke={line.color} strokeWidth={line.strokeWidth} strokeOpacity={line.opacity} strokeLinecap="round" />
                ))}
            </svg>
        </div>
    );
};
