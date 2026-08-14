"use client";

import type { JSX } from "react";

type GlobalErrorProps = {
    /** 境界が捕まえたエラー。本番では message が伏せられ、`digest` だけがサーバーログとの突き合わせ材料になる */
    error: Error & { digest?: string };
};

/**
 * ルートレイアウトごと差し替わるエラー境界 (Issue #66、docs/frontend-design.md §8.4)
 *
 * `error.tsx` は同じ段の `layout.tsx` を包まないため、`layout.tsx` 自身や夜空背景の描画が失敗した場合はここへ落ちる。
 * 自前の `<html>` / `<body>` を持つことが要件であり、`globals.css` (したがって Tailwind のクラスと
 * セマンティックトークン、docs/frontend-design.md §10) はこの文書には届かない。
 * そのためスタイルは inline で書き、色は `app/globals.css` のパレット層の値をここへ写している
 * (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md` の
 * 「Global error UI must define its own `<html>` and `<body>` tags, global styles, fonts, or other dependencies」
 * および「`global-error` ... render their own document and do not include your global styles」)。
 *
 * 復帰導線は `retry` ではなくページの再読み込みとする。
 * ルートレイアウトの描画が失敗している状態では、境界の子だけを描き直しても同じ結果になりやすいためである。
 * `metadata` の export は Client Component では使えないため、表題は React の `<title>` で与える (同ドキュメント)
 */
const GlobalError = ({ error }: GlobalErrorProps): JSX.Element => {
    return (
        <html lang="ja">
            <body
                style={{
                    margin: 0,
                    minHeight: "100dvh",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "16px",
                    background: "#090d1b",
                    color: "#eef1fa",
                    fontFamily: "sans-serif",
                }}
            >
                <title>dagdo</title>
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: "20px",
                        maxWidth: "24rem",
                        padding: "40px 32px",
                        border: "1px solid rgba(185, 200, 242, 0.17)",
                        borderRadius: "6px",
                        background: "#151d37",
                    }}
                >
                    <h1 style={{ margin: 0, fontSize: "16px", fontWeight: 600 }}>アプリの読み込みに失敗しました</h1>
                    <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.6, textAlign: "center", color: "#aab3cc" }}>
                        ページを再読み込みしてください。繰り返し失敗する場合は時間をおいて試してください
                    </p>
                    {error.digest !== undefined ? <p style={{ margin: 0, fontSize: "11px", fontFamily: "monospace", color: "#aab3cc" }}>エラー ID: {error.digest}</p> : null}
                    <button
                        type="button"
                        onClick={() => window.location.reload()}
                        style={{
                            padding: "6px 16px",
                            border: "1px solid rgba(185, 200, 242, 0.17)",
                            borderRadius: "6px",
                            background: "transparent",
                            color: "#b9c8f2",
                            fontSize: "14px",
                            cursor: "pointer",
                        }}
                    >
                        再読み込み
                    </button>
                </div>
            </body>
        </html>
    );
};

export default GlobalError;
