import type { AppTask, TaskDependency } from "@/types/task";

/**
 * オフラインモード (/offline、Issue #81) の localStorage 保存に関するロジック
 *
 * 検証・シリアライズは純関数として切り出し、localStorage への読み書きだけを薄い IO として持つ。
 * §4 の「lib は DOM 非依存」の例外であり、IO は下 2 つの load / save に閉じ込める
 */

/** オフラインデータの localStorage 保存キー */
export const OFFLINE_STORE_KEY = "dagdo-offline-v1";

/** localStorage へ丸ごと保存するオフラインデータ一式 */
export type OfflineSnapshot = {
    tasks: AppTask[];
    dependencies: TaskDependency[];
};

/** 未保存・パース失敗・スキーマ不一致のフォールバック先になる空データ */
const createEmptySnapshot = (): OfflineSnapshot => ({ tasks: [], dependencies: [] });

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const isStringOrNull = (value: unknown): boolean => value === null || typeof value === "string";

/** AppTask (src/types/task.ts) の型ガード。normalize (applyOutlineOp) が読むカラムを全数検査する */
const isAppTask = (value: unknown): value is AppTask => {
    if (!isRecord(value)) {
        return false;
    }
    return (
        typeof value.id === "string" &&
        typeof value.user_id === "string" &&
        typeof value.title === "string" &&
        typeof value.description === "string" &&
        isStringOrNull(value.parent_id) &&
        isStringOrNull(value.effective_parent_id) &&
        typeof value.position === "number" &&
        Array.isArray(value.sort_path) &&
        value.sort_path.every((element) => typeof element === "number") &&
        isStringOrNull(value.due_date) &&
        typeof value.is_blocked === "boolean" &&
        isStringOrNull(value.completed_at) &&
        typeof value.created_at === "string" &&
        typeof value.updated_at === "string"
    );
};

/** TaskDependency (task_dependencies の 1 行) の型ガード */
const isTaskDependency = (value: unknown): value is TaskDependency => {
    if (!isRecord(value)) {
        return false;
    }
    return typeof value.user_id === "string" && typeof value.task_id === "string" && typeof value.depends_on_task_id === "string" && typeof value.created_at === "string";
};

const isAppTaskArray = (value: unknown): value is AppTask[] => Array.isArray(value) && value.every(isAppTask);

const isTaskDependencyArray = (value: unknown): value is TaskDependency[] => Array.isArray(value) && value.every(isTaskDependency);

/** 保存用のシリアライズ。`parseOfflineSnapshot` と対になる */
export const serializeOfflineSnapshot = (snapshot: OfflineSnapshot): string => JSON.stringify(snapshot);

/**
 * localStorage から読んだ文字列をオフラインデータとして検証する
 *
 * 未保存 (null)・壊れた JSON・スキーマ不一致 (手動書き換えや将来の型変更) はいずれも空データへ
 * フォールバックし、呼び出し側で画面が死なないことを保証する
 */
export const parseOfflineSnapshot = (raw: string | null): OfflineSnapshot => {
    if (raw === null) {
        return createEmptySnapshot();
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return createEmptySnapshot();
    }
    if (!isRecord(parsed) || !isAppTaskArray(parsed.tasks) || !isTaskDependencyArray(parsed.dependencies)) {
        return createEmptySnapshot();
    }
    return { tasks: parsed.tasks, dependencies: parsed.dependencies };
};

/**
 * localStorage からオフラインデータを読み込む薄い IO
 *
 * SSR とのハイドレーション不整合を避けるため、mount 後の `useEffect` から呼ぶ
 * (pane-ratio の復元と同じ考え方、docs/frontend-design.md §7.1)。
 * storage 自体へアクセスできない環境でも throw せず空データへフォールバックする
 */
export const loadOfflineSnapshot = (): OfflineSnapshot => {
    try {
        return parseOfflineSnapshot(window.localStorage.getItem(OFFLINE_STORE_KEY));
    } catch (error) {
        console.error(`[offline] failed to load snapshot: ${String(error)}`);
        return createEmptySnapshot();
    }
};

/**
 * オフラインデータを localStorage へ丸ごと書き込む薄い IO
 *
 * Op の適用のたびに適用後の全量を同期で書く (個人 Todo 規模なので debounce も beforeunload も要らない)。
 * 容量超過など書き込みの失敗は throw させず、操作自体 (クライアント正 state への適用) は成立させる
 */
export const saveOfflineSnapshot = (snapshot: OfflineSnapshot): void => {
    try {
        window.localStorage.setItem(OFFLINE_STORE_KEY, serializeOfflineSnapshot(snapshot));
    } catch (error) {
        console.error(`[offline] failed to save snapshot: ${String(error)}`);
    }
};
