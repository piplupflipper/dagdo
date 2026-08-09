import type { ChangeEvent, JSX, Ref } from "react";

/** MarkdownEditor の props */
type MarkdownEditorProps = {
    value: string;
    onChange: (value: string) => void;
    disabled?: boolean;
    /** textarea 要素への参照。DetailPane が `Enter` キーによるフォーカス移動に使う (React 19 では ref を通常の prop として受け取れる) */
    ref?: Ref<HTMLTextAreaElement>;
};

/**
 * description 編集用 textarea (docs/frontend-design.md §2, §7.1: textarea 編集とプレビュー切替の二画面方式)
 */
export const MarkdownEditor = ({ value, onChange, disabled = false, ref }: MarkdownEditorProps): JSX.Element => {
    const handleChange = (event: ChangeEvent<HTMLTextAreaElement>): void => {
        onChange(event.target.value);
    };

    return (
        <textarea
            ref={ref}
            value={value}
            onChange={handleChange}
            disabled={disabled}
            rows={8}
            aria-label="説明を編集"
            placeholder="Markdown で説明を入力…"
            className="w-full resize-y rounded-md border border-border bg-bg px-3 py-2 font-mono text-sm text-text outline-none focus:border-accent disabled:opacity-60"
        />
    );
};
