import { describe, expect, it } from "vitest";
import { parseKeySequence } from "@/features/outline/lib/key-sequence";
import { dispatchableKeymap, type KeymapEntry } from "@/features/outline/lib/keymap-table";
import { advanceKeySequence, buildKeymapTries, type PendingSequence } from "@/features/outline/lib/keymap-trie";
import type { OutlineMode } from "@/store/types";

/** useOutlineKeymap と同じ待機タイムアウト */
const TIMEOUT_MS = 500;

/**
 * 待機状態を引き継ぎながら 1 打鍵ずつ流し込むドライバを作る
 *
 * useOutlineKeymap が useRef でやっていることをテスト側で再現したもの。
 * 既定のテーブルは dispatcher と同じく dispatchableKeymap (ドキュメント専用エントリを除いたもの) とする
 */
const createPresser = (mode: OutlineMode, entries: readonly KeymapEntry[] = dispatchableKeymap) => {
    const tries = buildKeymapTries(entries);
    const state: { pending: PendingSequence | null } = { pending: null };
    return (token: string, timestampMs = 0) => {
        const { resolution, pending } = advanceKeySequence({ root: tries[mode], pending: state.pending, token, timestampMs, timeoutMs: TIMEOUT_MS });
        state.pending = pending;
        return resolution;
    };
};

const entry = (overrides: Partial<KeymapEntry>): KeymapEntry => ({
    keys: "j",
    mode: "NORMAL",
    category: "移動",
    description: "テスト用",
    ...overrides,
});

describe("buildKeymapTries", () => {
    it("実際の keymap テーブルを例外なく構築できる", () => {
        expect(() => buildKeymapTries(dispatchableKeymap)).not.toThrow();
    });

    it("空のキーシーケンスを拒否する", () => {
        expect(() => buildKeymapTries([entry({ keys: "" })])).toThrow(/empty key sequence/);
        expect(() => buildKeymapTries([entry({ keys: "   " })])).toThrow(/empty key sequence/);
    });

    it("同一モードでのシーケンス重複を拒否する", () => {
        expect(() => buildKeymapTries([entry({ keys: "g g" }), entry({ keys: "g g" })])).toThrow(/duplicate keymap entry/);
    });

    it("モードが違えば同じシーケンスを登録できる", () => {
        expect(() => buildKeymapTries([entry({ keys: "Escape", mode: "VISUAL" }), entry({ keys: "Escape", mode: "SEARCH" })])).not.toThrow();
    });
});

describe("advanceKeySequence", () => {
    it("単打鍵のキーはその場で完全一致する", () => {
        const press = createPresser("NORMAL");
        expect(press("j").type).toBe("match");
        expect(press("G").type).toBe("match");
    });

    it("プレフィックスに一致する打鍵は待機状態にする", () => {
        const press = createPresser("NORMAL");
        expect(press("g", 0).type).toBe("pending");
        expect(press("g", 100).type).toBe("match");
    });

    it("テーブルに無いキーは待機せず未マッチにする", () => {
        const press = createPresser("NORMAL");
        expect(press("q").type).toBe("unmatched");
        expect(press("a").type).toBe("unmatched");
    });

    it("待機中プレフィックスの続きに一致しない打鍵は破棄し、待機も解除する", () => {
        const press = createPresser("NORMAL");
        // `d` 待機中の `x` は完了 (NORMAL の x) にならず破棄される
        expect(press("d", 0).type).toBe("pending");
        expect(press("x", 100).type).toBe("unmatched");
        // 直前の `d` の待機は既に解除されているため、ここで dd が確定してしまうことはない
        expect(press("d", 200).type).toBe("pending");
        expect(press("d", 300).type).toBe("match");
    });

    it("破棄後の打鍵は先頭から解決し直す", () => {
        const press = createPresser("NORMAL");
        expect(press("z", 0).type).toBe("pending");
        expect(press("q", 100).type).toBe("unmatched");
        expect(press("j", 200).type).toBe("match");
    });

    it("タイムアウト境界ちょうどまでは待機を継続する", () => {
        const press = createPresser("NORMAL");
        expect(press("g", 1000).type).toBe("pending");
        expect(press("g", 1000 + TIMEOUT_MS).type).toBe("match");
    });

    it("タイムアウト後の打鍵は先頭から解決し直す", () => {
        const press = createPresser("NORMAL");
        expect(press("g", 1000).type).toBe("pending");
        // 2 打鍵目が時間切れなので gg は確定せず、この `g` 自体が新しい待機になる
        expect(press("g", 1000 + TIMEOUT_MS + 1).type).toBe("pending");
        expect(press("g", 1000 + TIMEOUT_MS + 2).type).toBe("match");
    });

    it("修飾キー付きのシーケンスを解決できる", () => {
        const press = createPresser("NORMAL", [entry({ keys: "C-d" }), entry({ keys: "C-w j" })]);
        expect(press("C-d").type).toBe("match");
        expect(press("C-w", 0).type).toBe("pending");
        expect(press("j", 100).type).toBe("match");
    });

    it("モードごとに独立した trie を引く", () => {
        expect(createPresser("VISUAL")("V").type).toBe("unmatched");
        expect(createPresser("VISUAL")("Escape").type).toBe("match");
        expect(createPresser("SEARCH")("j").type).toBe("unmatched");
        expect(createPresser("SEARCH")("Escape").type).toBe("match");
    });
});

describe("keymap テーブルと dispatcher の整合性", () => {
    it("dispatcher が解決する全エントリが自身のキーシーケンスで到達できる", () => {
        for (const target of dispatchableKeymap) {
            const press = createPresser(target.mode);
            const tokens = parseKeySequence(target.keys);
            const resolutions = tokens.map((token, index) => press(token, index * 10));
            const last = resolutions[resolutions.length - 1];
            const label = `${target.mode} ${target.keys}`;

            const prefixTypes = resolutions.slice(0, -1).map((resolution) => resolution.type);
            expect(prefixTypes, label).toEqual(tokens.slice(0, -1).map(() => "pending"));
            expect(last?.type, label).toBe("match");
            expect(last?.type === "match" ? last.entry : null, label).toBe(target);
        }
    });

    // Issue #47 で足したドキュメント専用エントリが trie に載っていないことを打鍵で確かめる
    it("ドキュメント専用エントリのキーは dispatcher が解決しない", () => {
        expect(createPresser("SEARCH")("Enter").type).toBe("unmatched");
        expect(createPresser("SEARCH")("{char}").type).toBe("unmatched");
        // 行内編集の Enter / Esc と同じ扱いだが、NORMAL の Enter は詳細ペインへ移る側が run を持つため match する
        expect(createPresser("NORMAL")("Enter").type).toBe("match");
    });

    it("テーブルに無いキーはどのモードでも処理されない", () => {
        const modes: readonly OutlineMode[] = ["NORMAL", "VISUAL", "SEARCH"];
        const registered = new Set(dispatchableKeymap.map((target) => `${target.mode} ${parseKeySequence(target.keys)[0]}`));
        for (const mode of modes) {
            for (const token of ["q", "w", "e", "r", "t", "y", "u", "i", "p", "Tab", "Backspace", "C-r"]) {
                if (registered.has(`${mode} ${token}`)) {
                    continue;
                }
                expect(createPresser(mode)(token).type, `${mode} ${token}`).toBe("unmatched");
            }
        }
    });
});
