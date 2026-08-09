import { beforeEach, describe, expect, it, vi } from "vitest";
import { dispatchableKeymap, type KeymapEntry, type OutlineKeymapHandlers, outlineKeymap } from "@/features/outline/lib/keymap-table";
import { useOutlineStore } from "@/store/outline-store";
import type { OutlineMode } from "@/store/types";

/**
 * docs/frontend-design.md §6.1 の keymap 一覧。テーブルがここから増減していないことを固定する
 *
 * 同じ mode + keys が文脈違いで 2 度現れるため (NORMAL の Enter)、category も含めて表す
 */
const EXPECTED_KEYS: readonly string[] = [
    "NORMAL 移動 j",
    "NORMAL 移動 k",
    "NORMAL 移動 g g",
    "NORMAL 移動 G",
    "NORMAL 編集 x",
    "NORMAL 編集 o",
    "NORMAL 編集 O",
    "NORMAL 編集 Enter",
    "NORMAL 編集 d d",
    "NORMAL 行内編集 i",
    "NORMAL 行内編集 A",
    "NORMAL 行内編集 Enter",
    "NORMAL 行内編集 Escape",
    "NORMAL 構造変更 J",
    "NORMAL 構造変更 K",
    "NORMAL 構造変更 <",
    "NORMAL 構造変更 >",
    "NORMAL 折りたたみ z a",
    "NORMAL モード V",
    "NORMAL モード /",
    "NORMAL ヘルプ ?",
    "VISUAL 移動 j",
    "VISUAL 移動 k",
    "VISUAL 編集 x",
    "VISUAL モード Escape",
    "SEARCH モード Escape",
];

/** ドキュメント専用エントリ (run なし)。実処理はコンポーネント側のローカルハンドラが行う */
const DOCUMENTATION_ONLY_KEYS: readonly string[] = ["NORMAL 行内編集 Enter", "NORMAL 行内編集 Escape"];

const labelOf = (entry: KeymapEntry): string => `${entry.mode} ${entry.category} ${entry.keys}`;

const createHandlerSpies = (): OutlineKeymapHandlers => ({
    completeCursor: vi.fn(),
    completeSelection: vi.fn(),
    createSibling: vi.fn(),
    startInlineTitleEdit: vi.fn(),
    focusDetailEditor: vi.fn(),
    moveCursorSibling: vi.fn(),
    indentCursor: vi.fn(),
    outdentCursor: vi.fn(),
    softDeleteCursor: vi.fn(),
    openHelp: vi.fn(),
    closeHelp: vi.fn(),
});

const findEntry = (mode: OutlineMode, keys: string): KeymapEntry => {
    const found = dispatchableKeymap.find((target) => target.mode === mode && target.keys === keys);
    if (found === undefined) {
        throw new Error(`keymap entry not found: ${mode} ${keys}`);
    }
    return found;
};

/** エントリの run を現在のストア状態に対して実行する */
const runEntry = (mode: OutlineMode, keys: string, handlers: OutlineKeymapHandlers = createHandlerSpies()): void => {
    findEntry(mode, keys).run?.({ handlers, store: useOutlineStore.getState() });
};

describe("outlineKeymap", () => {
    it("docs §6.1 のキーが過不足なく登録されている", () => {
        expect(outlineKeymap.map(labelOf).toSorted()).toEqual([...EXPECTED_KEYS].toSorted());
    });

    it("mode + category + keys は一意 (ヘルプの React key に使う)", () => {
        const labels = outlineKeymap.map(labelOf);
        expect(new Set(labels).size).toBe(labels.length);
    });

    it("全エントリがヘルプ表示用の説明を持つ", () => {
        for (const target of outlineKeymap) {
            expect(target.description.length, labelOf(target)).toBeGreaterThan(0);
        }
    });
});

describe("dispatchableKeymap", () => {
    it("ドキュメント専用エントリだけを除いたものになる", () => {
        expect(dispatchableKeymap.map(labelOf).toSorted()).toEqual(EXPECTED_KEYS.filter((key) => !DOCUMENTATION_ONLY_KEYS.includes(key)).toSorted());
    });

    it("行内編集中の Enter / Esc はドキュメント専用として登録されている (実処理は InlineTitleEditor が行う)", () => {
        for (const label of DOCUMENTATION_ONLY_KEYS) {
            const entry = outlineKeymap.find((target) => labelOf(target) === label);
            expect(entry?.run, label).toBeUndefined();
        }
    });

    it("dispatcher が解決するエントリの mode + keys は一意 (trie が重複を弾く)", () => {
        const labels = dispatchableKeymap.map((entry) => `${entry.mode} ${entry.keys}`);
        expect(new Set(labels).size).toBe(labels.length);
    });
});

describe("handlers を呼ぶエントリ", () => {
    const cases: readonly { mode: OutlineMode; keys: string; handler: keyof OutlineKeymapHandlers; args: readonly unknown[] }[] = [
        { mode: "NORMAL", keys: "x", handler: "completeCursor", args: [] },
        { mode: "NORMAL", keys: "o", handler: "createSibling", args: ["below"] },
        { mode: "NORMAL", keys: "O", handler: "createSibling", args: ["above"] },
        { mode: "NORMAL", keys: "i", handler: "startInlineTitleEdit", args: ["start"] },
        { mode: "NORMAL", keys: "A", handler: "startInlineTitleEdit", args: ["end"] },
        { mode: "NORMAL", keys: "Enter", handler: "focusDetailEditor", args: [] },
        { mode: "NORMAL", keys: "d d", handler: "softDeleteCursor", args: [] },
        { mode: "NORMAL", keys: "J", handler: "moveCursorSibling", args: ["down"] },
        { mode: "NORMAL", keys: "K", handler: "moveCursorSibling", args: ["up"] },
        { mode: "NORMAL", keys: "<", handler: "outdentCursor", args: [] },
        { mode: "NORMAL", keys: ">", handler: "indentCursor", args: [] },
        { mode: "VISUAL", keys: "x", handler: "completeSelection", args: [] },
        { mode: "NORMAL", keys: "?", handler: "openHelp", args: [] },
    ];

    it.each(cases)("$mode の $keys は $handler だけを呼ぶ", ({ mode, keys, handler, args }) => {
        const handlers = createHandlerSpies();
        runEntry(mode, keys, handlers);
        for (const [name, spy] of Object.entries(handlers)) {
            expect(spy, name).toHaveBeenCalledTimes(name === handler ? 1 : 0);
        }
        expect(handlers[handler]).toHaveBeenCalledWith(...args);
    });
});

describe("ストアを直接操作するエントリ", () => {
    beforeEach(() => {
        useOutlineStore.setState({
            mode: "NORMAL",
            cursorTaskId: "b",
            collapsedTaskIds: new Set<string>(),
            visualAnchorTaskId: null,
            visualSelectedTaskIds: new Set<string>(),
            searchQuery: "",
            flashTaskId: null,
            visibleTaskIds: ["a", "b", "c"],
        });
    });

    it("NORMAL の j / k がカーソルを移動する", () => {
        runEntry("NORMAL", "j");
        expect(useOutlineStore.getState().cursorTaskId).toBe("c");
        runEntry("NORMAL", "k");
        expect(useOutlineStore.getState().cursorTaskId).toBe("b");
    });

    it("NORMAL の gg / G が先頭行 / 末尾行へジャンプする", () => {
        runEntry("NORMAL", "g g");
        expect(useOutlineStore.getState().cursorTaskId).toBe("a");
        runEntry("NORMAL", "G");
        expect(useOutlineStore.getState().cursorTaskId).toBe("c");
    });

    it("NORMAL の za がカーソル行の折りたたみを切り替える", () => {
        runEntry("NORMAL", "z a");
        expect(useOutlineStore.getState().collapsedTaskIds.has("b")).toBe(true);
        runEntry("NORMAL", "z a");
        expect(useOutlineStore.getState().collapsedTaskIds.has("b")).toBe(false);
    });

    it("NORMAL の za はカーソル未選択なら何もしない", () => {
        useOutlineStore.setState({ cursorTaskId: null });
        runEntry("NORMAL", "z a");
        expect(useOutlineStore.getState().collapsedTaskIds.size).toBe(0);
    });

    it("NORMAL の V / スラッシュがモードを遷移させる", () => {
        runEntry("NORMAL", "V");
        expect(useOutlineStore.getState().mode).toBe("VISUAL");

        useOutlineStore.setState({ mode: "NORMAL" });
        runEntry("NORMAL", "/");
        expect(useOutlineStore.getState().mode).toBe("SEARCH");
    });

    it("VISUAL の j / k が選択範囲を拡張する", () => {
        runEntry("NORMAL", "V");
        runEntry("VISUAL", "j");
        expect([...useOutlineStore.getState().visualSelectedTaskIds]).toEqual(["b", "c"]);
        runEntry("VISUAL", "k");
        expect([...useOutlineStore.getState().visualSelectedTaskIds]).toEqual(["b"]);
    });

    it("VISUAL の Esc が選択を解除して NORMAL へ戻る", () => {
        runEntry("NORMAL", "V");
        runEntry("VISUAL", "Escape");
        expect(useOutlineStore.getState().mode).toBe("NORMAL");
        expect(useOutlineStore.getState().visualSelectedTaskIds.size).toBe(0);
    });

    it("SEARCH の Esc がクエリを破棄して NORMAL へ戻る", () => {
        useOutlineStore.setState({ mode: "SEARCH", searchQuery: "foo" });
        runEntry("SEARCH", "Escape");
        expect(useOutlineStore.getState().mode).toBe("NORMAL");
        expect(useOutlineStore.getState().searchQuery).toBe("");
    });
});
