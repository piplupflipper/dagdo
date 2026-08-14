"use client";

import { type JSX, useEffect } from "react";

type ErrorBoundaryProps = {
    /** 境界が捕まえたエラー。本番では message が伏せられ、`digest` だけがサーバーログとの突き合わせ材料になる */
    error: Error & { digest?: string };
    /**
     * 子の再フェッチと再レンダーを試みる
     *
     * Next.js 16.3.0 で stable になった prop であり、同梱ドキュメントは `reset` ではなくこちらを既定として案内している
     * (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md` の `#### retry` と Version History)
     */
    retry: () => void;
};

/**
 * `app/` 配下のページを包むエラー境界 (Issue #66、docs/frontend-design.md §8.4)
 *
 * これが無いと Next.js 組み込みの全画面エラーページ (英語の「This page couldn't load / A server error occurred.」) に落ちる。
 * 個々の操作の失敗はステータス行 (`StatusLine`) で伝える設計であり (docs/frontend-design.md §8.2)、
 * ここへ到達するのは描画そのものが失敗した場合に限られる。
 * 同じ段の `layout.tsx` は包まないため、夜空背景とレイアウトは残ったままこの内容だけが差し替わる
 */
const ErrorBoundary = ({ error, retry }: ErrorBoundaryProps): JSX.Element => {
    useEffect(() => {
        console.error("[app] render error:", error);
    }, [error]);

    return (
        <div className="flex min-h-dvh items-center justify-center p-4 text-text">
            <div className="flex w-full max-w-sm flex-col items-center gap-5 rounded-base border border-border bg-bg-alt px-8 py-10 shadow-xl backdrop-blur-xl">
                <h1 className="text-base font-semibold tracking-tight">画面の表示に失敗しました</h1>
                <p className="text-center text-sm text-text-dim">一時的な不調の可能性があります。再試行しても直らない場合は、ページを再読み込みしてください</p>
                {error.digest !== undefined ? <p className="font-mono text-[11px] text-text-dim">エラー ID: {error.digest}</p> : null}
                <button type="button" onClick={() => retry()} className="rounded-base border border-border px-4 py-1.5 text-sm text-accent hover:bg-accent/10">
                    再試行
                </button>
            </div>
        </div>
    );
};

export default ErrorBoundary;
