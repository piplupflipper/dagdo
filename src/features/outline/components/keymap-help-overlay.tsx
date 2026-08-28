import { type JSX, useEffect, useRef } from "react";
import { buildKeymapHelpSections, formatKeyToken, HELP_CLOSE_KEYS } from "@/features/outline/lib/keymap-help";
import { outlineKeymap } from "@/features/outline/lib/keymap-table";

/**
 * ヘルプの表示内容
 *
 * keymap テーブルは静的なのでモジュール読み込み時に 1 度だけ組み立てる (use-outline-keymap.ts の trie と同じ扱い)
 */
const HELP_SECTIONS = buildKeymapHelpSections(outlineKeymap);

const TITLE_ID = "keymap-help-title";

/**
 * ヘルプを閉じた後のフォーカス戻し先を決める
 *
 * キー入力自体は document の keydown で受けるためフォーカスが body にあっても死なないが、
 * カーソル行の見た目とフォーカス位置がずれたままになるため、開く前の要素かカーソル行へ戻す。
 * カーソル行の目印 (`data-cursor` と `role="option"`) は outline-row.tsx が付けている。
 *
 * 開いた時点で背面が inert になり (outline-shell.tsx)、そこにフォーカスがあれば body へ外れるため、
 * 実際にはカーソル行へのフォールバックを通ることが多い。inert 非対応環境で開く前の要素が
 * 生きている場合にそちらを優先できるよう、両方を扱う
 */
const resolveRestoreTarget = (previous: HTMLElement | null): HTMLElement | null => {
    if (previous !== null && previous !== document.body && previous.isConnected) {
        return previous;
    }
    return document.querySelector<HTMLElement>('[data-cursor="true"] [role="option"]');
};

type KeymapHelpOverlayProps = {
    isOpen: boolean;
    /** キー操作以外の閉じる導線 (閉じるボタン) から呼ぶ */
    onClose: () => void;
};

/**
 * `?` で開くキーバインドのヘルプオーバーレイ (docs/frontend-design.md §6.1, §6.2)
 *
 * 表示するキー一覧は keymap テーブルから生成し、ここには直書きしない。
 * `q` / `Esc` での閉じる操作は dispatcher (use-outline-keymap.ts) のガードが処理するため、
 * このコンポーネントは keydown を持たない。モードは増やさず、開閉状態は `OutlineShell` のローカル state が持つ。
 * 背面を Tab で辿れないようにする inert は `OutlineShell` 側が付ける (このダイアログはその外に置く)
 */
export const KeymapHelpOverlay = ({ isOpen, onClose }: KeymapHelpOverlayProps): JSX.Element | null => {
    const dialogRef = useRef<HTMLDivElement>(null);
    const previousFocusRef = useRef<HTMLElement | null>(null);

    useEffect(() => {
        if (!isOpen) {
            return;
        }
        previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        dialogRef.current?.focus();
        return () => resolveRestoreTarget(previousFocusRef.current)?.focus();
    }, [isOpen]);

    if (!isOpen) {
        return null;
    }

    return (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-overlay p-4 backdrop-blur-sm md:p-8">
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={TITLE_ID}
                tabIndex={-1}
                className="w-full max-w-3xl rounded-base border border-border bg-bg font-mono text-sm text-text shadow-xl backdrop-blur-xl outline-none lg:max-w-5xl"
            >
                <div className="flex items-center gap-2 border-b border-border bg-bg-alt px-3.5 py-2">
                    <h2 id={TITLE_ID} className="text-[13px] font-semibold">
                        キーバインド一覧
                    </h2>
                    <span className="ml-auto flex items-center gap-1 text-[11px] text-text-dim">
                        {HELP_CLOSE_KEYS.map((key) => (
                            <kbd key={key} className="rounded-base border border-border bg-bg px-1.5 py-0.5 text-[11px] text-text">
                                {formatKeyToken(key)}
                            </kbd>
                        ))}
                        で閉じる
                    </span>
                    <button type="button" onClick={onClose} className="flex-shrink-0 rounded-base border border-border px-2.5 py-1 text-[11px] text-accent hover:bg-accent/10">
                        閉じる
                    </button>
                </div>

                {/* NORMAL とそれ以外でエントリ数の差が大きいため、items-start でセクションを引き伸ばさず上端で揃える */}
                <div className="grid items-start gap-x-6 gap-y-4 px-3.5 py-3 md:grid-cols-2 lg:grid-cols-3">
                    {HELP_SECTIONS.map((section) => (
                        <section key={section.mode}>
                            <h3 className="mb-1 border-b border-border pb-1 text-[11px] font-semibold tracking-wide text-accent">{section.mode}</h3>
                            {section.groups.map((group) => (
                                <div key={group.category} className="mt-2">
                                    <h4 className="text-[11px] text-text-dim">{group.category}</h4>
                                    <ul>
                                        {group.items.map((item) => (
                                            <li key={item.id} className="flex items-baseline gap-2 py-0.5 text-[13px]">
                                                <span className="flex flex-shrink-0 gap-1">
                                                    {item.tokens.map((token) => (
                                                        <kbd key={token.id} className="rounded-base border border-border bg-bg-alt px-1.5 py-0.5 text-[11px] text-text">
                                                            {token.label}
                                                        </kbd>
                                                    ))}
                                                </span>
                                                <span className="min-w-0 text-text-dim">{item.description}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            ))}
                        </section>
                    ))}
                </div>
            </div>
        </div>
    );
};
