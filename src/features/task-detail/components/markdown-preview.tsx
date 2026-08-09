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
 * Markdown が生成する各要素へ当てるスタイル (任意バリアント)
 * react-markdown は素の HTML 要素を返すだけで、Tailwind preflight が table のボーダー等をリセットするため、ここで明示的に指定する
 * 色は必ずセマンティック層トークン (docs/frontend-design.md §10) 経由で参照する
 */
const markdownElementStyles = [
    // リスト
    "[&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5",
    // GFM テーブル: セルの罫線で列・行の境界を示し、ヘッダー行は背景色で区別する
    "[&_table]:w-full [&_table]:border-collapse",
    "[&_th]:border [&_th]:border-border [&_th]:bg-bg-alt [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-medium",
    "[&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1",
    // 引用
    "[&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-text-dim",
    // コードブロックとインラインコード (pre 直下の code は背景が二重にならないよう除外する)
    "[&_pre]:overflow-x-auto [&_pre]:rounded-base [&_pre]:bg-bg-alt [&_pre]:p-2.5 [&_pre]:font-mono [&_pre]:text-xs",
    "[&_:not(pre)>code]:rounded-base [&_:not(pre)>code]:bg-bg-alt [&_:not(pre)>code]:px-1 [&_:not(pre)>code]:py-0.5 [&_:not(pre)>code]:font-mono [&_:not(pre)>code]:text-xs",
    // 区切り線
    "[&_hr]:border-t [&_hr]:border-border",
].join(" ");

/**
 * description の Markdown プレビュー (react-markdown + remark-gfm) (docs/frontend-design.md §2, §7.1)
 */
export const MarkdownPreview = ({ source }: MarkdownPreviewProps): JSX.Element => {
    if (source.trim().length === 0) {
        return <p className="text-sm italic text-text-dim">説明は未入力です。</p>;
    }

    return (
        <div className={`space-y-1.5 text-sm leading-relaxed text-text ${markdownElementStyles}`}>
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: MarkdownLink }}>
                {source}
            </ReactMarkdown>
        </div>
    );
};
