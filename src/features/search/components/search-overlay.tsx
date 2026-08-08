"use client";

import { type ChangeEvent, type JSX, type KeyboardEvent, useEffect, useRef } from "react";
import { useOutlineStore } from "@/store/outline-store";

/**
 * `/` で開く検索オーバーレイ (docs/frontend-design.md §4, §5.1, §7.1)
 *
 * store.mode === "SEARCH" のときのみ表示する、ステータスライン風の下部固定入力
 * 入力は store.setSearchQuery に即時反映し、Enter で confirmSearch、Esc で cancelSearch する
 * キー処理はこのコンポーネント内の input で完結させ、グローバル keymap には委ねない
 * IME 変換確定前の Enter/Esc は isComposing を見て無視する
 */
export const SearchOverlay = (): JSX.Element | null => {
    const mode = useOutlineStore((state) => state.mode);
    const searchQuery = useOutlineStore((state) => state.searchQuery);
    const setSearchQuery = useOutlineStore((state) => state.setSearchQuery);
    const confirmSearch = useOutlineStore((state) => state.confirmSearch);
    const cancelSearch = useOutlineStore((state) => state.cancelSearch);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (mode === "SEARCH") {
            inputRef.current?.focus();
        }
    }, [mode]);

    if (mode !== "SEARCH") {
        return null;
    }

    const handleChange = (event: ChangeEvent<HTMLInputElement>): void => {
        setSearchQuery(event.target.value);
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
        if (event.nativeEvent.isComposing) {
            return;
        }
        if (event.key === "Enter") {
            event.preventDefault();
            confirmSearch();
        } else if (event.key === "Escape") {
            event.preventDefault();
            cancelSearch();
        }
    };

    return (
        <div className="fixed inset-x-0 bottom-0 z-50 flex items-center gap-2 border-t border-border bg-bg px-3 py-2 font-mono text-sm text-text shadow-sm">
            <span className="text-accent" aria-hidden="true">
                /
            </span>
            <input
                ref={inputRef}
                type="text"
                value={searchQuery}
                onChange={handleChange}
                onKeyDown={handleKeyDown}
                placeholder="タイトル・説明で検索…"
                aria-label="タスク検索"
                className="flex-1 bg-transparent text-text outline-none placeholder:text-text-dim"
            />
        </div>
    );
};
