import type { AppTask } from "@/types/task";

/**
 * title / description の部分一致 (大文字小文字を無視) でタスクを絞り込む純関数 (docs/frontend-design.md §4)
 *
 * query が空文字 (前後の空白のみを含む場合も) は全件を返す
 */
export const filterTasks = ({ tasks, query }: { tasks: readonly AppTask[]; query: string }): AppTask[] => {
    const normalizedQuery = query.trim().toLowerCase();
    if (normalizedQuery.length === 0) {
        return [...tasks];
    }
    return tasks.filter((task) => task.title.toLowerCase().includes(normalizedQuery) || task.description.toLowerCase().includes(normalizedQuery));
};
