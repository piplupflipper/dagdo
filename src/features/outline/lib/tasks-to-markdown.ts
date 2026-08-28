import { buildOutlineTree } from "@/features/outline/lib/build-tree";
import type { AppTask } from "@/types/task";

/** Markdown 箇条書き 1 段あたりのインデント (Issue #80) */
const MARKDOWN_INDENT = "    ";

/**
 * 未削除タスク一覧を、表示と同じ sort_path 順・effective_parent_id 階層の Markdown 箇条書きへ変換する (Issue #80)
 *
 * 折りたたみと検索の絞り込みは見ない。完了状態も表現しない。タイトルはエスケープせずそのまま出す
 */
export const tasksToMarkdown = (tasks: readonly AppTask[]): string => {
    const rows = buildOutlineTree(tasks);
    return rows.map((row) => `${MARKDOWN_INDENT.repeat(row.depth)}- ${row.task.title}`).join("\n");
};
