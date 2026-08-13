import type { AppTask } from "@/types/task";

/**
 * title / description の部分一致 (大文字小文字を無視) でタスクを絞り込む純関数 (docs/frontend-design.md §4)
 *
 * 呼び出し元 (OutlineShell) は空クエリ (前後の空白のみを含む場合も) では絞り込み自体を行わないため、
 * ここには非空のクエリしか渡らない
 */
export const filterTasks = ({ tasks, query }: { tasks: readonly AppTask[]; query: string }): AppTask[] => {
    const normalizedQuery = query.trim().toLowerCase();
    return tasks.filter((task) => task.title.toLowerCase().includes(normalizedQuery) || task.description.toLowerCase().includes(normalizedQuery));
};
