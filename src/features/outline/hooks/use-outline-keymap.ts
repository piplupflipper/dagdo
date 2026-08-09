import { useEffect, useRef } from "react";
import { keyEventToToken } from "@/features/outline/lib/key-sequence";
import { HELP_CLOSE_KEYS } from "@/features/outline/lib/keymap-help";
import { type OutlineKeymapHandlers, outlineKeymap } from "@/features/outline/lib/keymap-table";
import { advanceKeySequence, buildKeymapTries, type PendingSequence } from "@/features/outline/lib/keymap-trie";
import { useOutlineStore } from "@/store/outline-store";

/** `gg`/`dd`/`za` のような複数打鍵シーケンス確定までの許容時間 (docs/frontend-design.md §6.2) */
const PENDING_KEY_TIMEOUT_MS = 500;

/**
 * モードごとの prefix tree
 *
 * テーブルは静的なのでモジュール読み込み時に 1 度だけ構築する。
 * 空シーケンスや重複エントリがあればここで例外になり、開発時に即座に気付ける
 */
const keymapTries = buildKeymapTries(outlineKeymap);

/** input / textarea / contenteditable にフォーカスがある間はグローバル keymap を無効化する (docs/frontend-design.md §6.2) */
const isEditableTarget = (target: EventTarget | null): boolean => {
    if (!(target instanceof HTMLElement)) {
        return false;
    }
    return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
};

type UseOutlineKeymapParams = {
    /** `OutlineShell` が注入する副作用。テーブルの `run` と、ヘルプ表示中のガードが呼ぶ */
    handlers: OutlineKeymapHandlers;
    /**
     * ヘルプオーバーレイが開いているか
     *
     * モードを増やさない制約 (Issue #16) により `store.mode` からは判別できないため、
     * `OutlineShell` のローカル state をそのまま受け取る
     */
    isHelpOpen: boolean;
};

/**
 * NORMAL / VISUAL / SEARCH のキーボードディスパッチを 1 つの keydown ハンドラへ集約するフック (docs/frontend-design.md §6.2)
 *
 * `OutlineShell` がマウント時に 1 つだけ呼び出す想定。処理できるキーは keymap テーブル
 * (`lib/keymap-table.ts`) が単一の正であり、このフックはテーブル以外の経路でキーを処理しない。
 * 唯一の例外がヘルプ表示中のガードで、これはモードを増やさずに「オーバーレイ表示中」という文脈を扱うための措置である。
 * 待機中のシーケンスは再レンダーを発生させたくないため Zustand ストアではなく本フック内部の useRef で保持する
 */
export const useOutlineKeymap = ({ handlers, isHelpOpen }: UseOutlineKeymapParams): void => {
    const mode = useOutlineStore((state) => state.mode);
    const pendingRef = useRef<PendingSequence | null>(null);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent): void => {
            if (event.isComposing) {
                return;
            }
            if (isEditableTarget(event.target)) {
                return;
            }
            const token = keyEventToToken(event);
            if (token === null) {
                // 修飾キー単独の打鍵。待機状態を壊さずに読み飛ばす
                return;
            }

            if (isHelpOpen) {
                // ヘルプ表示中は裏のカーソルが動かないよう、閉じるキー以外の入力をすべて破棄する。
                // 破棄時に preventDefault しないのは unmatched と同じ理由 (Ctrl+R 等のブラウザ既定動作を奪わない)
                pendingRef.current = null;
                if (!HELP_CLOSE_KEYS.includes(token)) {
                    return;
                }
                handlers.closeHelp();
                event.preventDefault();
                return;
            }

            const { resolution, pending } = advanceKeySequence({
                root: keymapTries[mode],
                pending: pendingRef.current,
                token,
                timestampMs: event.timeStamp,
                timeoutMs: PENDING_KEY_TIMEOUT_MS,
            });
            pendingRef.current = pending;

            if (resolution.type === "pending") {
                event.preventDefault();
                return;
            }
            if (resolution.type === "unmatched") {
                // 待機中プレフィックスの続きに一致しないキーはここで破棄される。
                // preventDefault はしない。keymap に無いキー (Ctrl+R 等) のブラウザ既定動作を奪わないため
                return;
            }
            const { run } = resolution.entry;
            if (run === undefined) {
                // ヘルプ表示専用のエントリ。実処理はコンポーネント側のローカルハンドラが行う
                return;
            }
            run({ handlers, store: useOutlineStore.getState() });
            event.preventDefault();
        };

        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    }, [mode, handlers, isHelpOpen]);
};
