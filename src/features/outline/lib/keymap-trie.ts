import { parseKeySequence } from "@/features/outline/lib/key-sequence";
import type { KeymapEntry } from "@/features/outline/lib/keymap-table";
import type { OutlineMode } from "@/store/types";

/**
 * keymap テーブルから構築する prefix tree と、その上でのキーシーケンス解決 (docs/frontend-design.md §6.2)
 *
 * 待機 (pending) 状態の遷移も純粋関数として持たせ、DOM やタイマーに依存せず単体テストできるようにしている。
 * 実際の待機状態の保持は呼び出し側 (useOutlineKeymap の useRef) の責務
 */

/** prefix tree のノード */
type KeymapTrieNode = {
    /** このノードで完全一致するエントリ。プレフィックス途中のノードでは null */
    entry: KeymapEntry | null;
    children: ReadonlyMap<string, KeymapTrieNode>;
};

/** 構築途中の可変ノード */
type MutableKeymapTrieNode = {
    entry: KeymapEntry | null;
    children: Map<string, MutableKeymapTrieNode>;
};

/**
 * トークン列を trie に通した結果
 *
 * - `match`: 完全一致した。エントリを実行する
 * - `pending`: いずれかのエントリのプレフィックスに一致した。次のキーを待つ
 * - `unmatched`: どのエントリにも繋がらない。入力を破棄する
 */
type KeymapResolution = { type: "match"; entry: KeymapEntry } | { type: "pending" } | { type: "unmatched" };

/** 待機中のキーシーケンス (プレフィックスまで一致している状態) */
export type PendingSequence = {
    tokens: readonly string[];
    timestampMs: number;
};

const createNode = (): MutableKeymapTrieNode => ({ entry: null, children: new Map() });

/**
 * keymap テーブルからモードごとの trie を構築する
 *
 * @throws キーシーケンスが空、または同一モードで同一シーケンスが重複登録されている場合
 */
export const buildKeymapTries = (entries: readonly KeymapEntry[]): Record<OutlineMode, KeymapTrieNode> => {
    const roots: Record<OutlineMode, MutableKeymapTrieNode> = {
        NORMAL: createNode(),
        VISUAL: createNode(),
        SEARCH: createNode(),
    };

    for (const entry of entries) {
        const tokens = parseKeySequence(entry.keys);
        if (tokens.length === 0) {
            throw new Error(`invalid keymap entry: empty key sequence in mode ${entry.mode}`);
        }
        const leaf = tokens.reduce<MutableKeymapTrieNode>((node, token) => {
            const child = node.children.get(token) ?? createNode();
            node.children.set(token, child);
            return child;
        }, roots[entry.mode]);
        if (leaf.entry !== null) {
            throw new Error(`duplicate keymap entry: "${entry.keys}" in mode ${entry.mode}`);
        }
        leaf.entry = entry;
    }

    return roots;
};

/**
 * トークン列を trie の根から辿って解決する
 *
 * 完全一致するノードが子を持つ場合 (例: `d` と `d d` を両方登録した場合) はタイムアウトを待たず
 * 完全一致を優先する。現行テーブルにその組み合わせは無い
 */
const resolveKeySequence = (root: KeymapTrieNode, tokens: readonly string[]): KeymapResolution => {
    const node = tokens.reduce<KeymapTrieNode | null>((current, token) => current?.children.get(token) ?? null, root);
    if (node === null) {
        return { type: "unmatched" };
    }
    if (node.entry !== null) {
        return { type: "match", entry: node.entry };
    }
    return node.children.size > 0 ? { type: "pending" } : { type: "unmatched" };
};

type AdvanceKeySequenceParams = {
    /** 対象モードの trie の根 */
    root: KeymapTrieNode;
    /** 直前の打鍵で持ち越した待機状態 */
    pending: PendingSequence | null;
    /** 今回の打鍵のトークン */
    token: string;
    /** 今回の打鍵の時刻 (KeyboardEvent.timeStamp) */
    timestampMs: number;
    /** 待機の許容時間 */
    timeoutMs: number;
};

/**
 * 1 打鍵ぶん待機状態を進める
 *
 * 待機がタイムアウトしていれば、その打鍵は先頭トークンとして解決し直す。
 * 待機中プレフィックスの続きに一致しない打鍵は `unmatched` を返しつつ待機を解除する (入力の破棄)
 *
 * @returns 解決結果と、次の打鍵へ引き継ぐ待機状態 (`pending` 以外では常に null)
 */
export const advanceKeySequence = (params: AdvanceKeySequenceParams): { resolution: KeymapResolution; pending: PendingSequence | null } => {
    const { root, pending, token, timestampMs, timeoutMs } = params;
    const isPendingAlive = pending !== null && timestampMs - pending.timestampMs <= timeoutMs;
    const tokens = isPendingAlive ? [...pending.tokens, token] : [token];
    const resolution = resolveKeySequence(root, tokens);
    return { resolution, pending: resolution.type === "pending" ? { tokens, timestampMs } : null };
};
