import type { AnchorHTMLAttributes, JSX } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** MarkdownPreview の props */
type MarkdownPreviewProps = {
    /** 表示する Markdown 本文。空文字なら空状態を表示する */
    source: string;
};

/** Markdown 内のリンクを新規タブ・rel="noopener noreferrer" で開く */
const MarkdownLink = (props: AnchorHTMLAttributes<HTMLAnchorElement>): JSX.Element => {
    return <a {...props} target="_blank" rel="noopener noreferrer" className="break-all text-accent underline" />;
};

/**
 * description の Markdown プレビュー (react-markdown + remark-gfm) (docs/frontend-design.md §2, §7.1)
 */
export const MarkdownPreview = ({ source }: MarkdownPreviewProps): JSX.Element => {
    if (source.trim().length === 0) {
        return <p className="text-sm italic text-text-dim">説明は未入力です。</p>;
    }

    return (
        <div className="space-y-1.5 text-sm leading-relaxed text-text [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: MarkdownLink }}>
                {source}
            </ReactMarkdown>
        </div>
    );
};
