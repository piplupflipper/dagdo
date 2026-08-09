import { describe, expect, it } from "vitest";
import { buildKeymapHelpSections, formatKeyToken, HELP_CLOSE_KEYS } from "@/features/outline/lib/keymap-help";
import { dispatchableKeymap, type KeymapEntry, outlineKeymap } from "@/features/outline/lib/keymap-table";

/**
 * グルーピングの検証用テーブル
 *
 * 同一カテゴリが離れて並ぶケース (NORMAL の 移動 が 編集 を挟んで再登場) と、
 * `run` を持たないエントリを含める
 */
const entries: readonly KeymapEntry[] = [
    { keys: "j", mode: "NORMAL", category: "移動", description: "次の行へ", run: () => {} },
    { keys: "x", mode: "NORMAL", category: "編集", description: "完了", run: () => {} },
    { keys: "g g", mode: "NORMAL", category: "移動", description: "先頭行へ", run: () => {} },
    { keys: "Escape", mode: "NORMAL", category: "編集", description: "編集を中断" },
    { keys: "Escape", mode: "VISUAL", category: "モード", description: "NORMAL へ戻る", run: () => {} },
];

describe("buildKeymapHelpSections", () => {
    it("mode ごとにテーブルの初出順でセクションを作る", () => {
        expect(buildKeymapHelpSections(entries).map((section) => section.mode)).toEqual(["NORMAL", "VISUAL"]);
    });

    it("同一 mode 内の同一 category は離れて並んでいても 1 グループへまとめる", () => {
        const [normal] = buildKeymapHelpSections(entries);
        expect(normal?.groups.map((group) => group.category)).toEqual(["移動", "編集"]);
        expect(normal?.groups[0]?.items.map((item) => item.description)).toEqual(["次の行へ", "先頭行へ"]);
    });

    it("run を持たないエントリも除外しない", () => {
        const descriptions = buildKeymapHelpSections(entries).flatMap((section) => section.groups.flatMap((group) => group.items.map((item) => item.description)));
        expect(descriptions).toContain("編集を中断");
    });

    it("keys をトークンへ分解する (1 トークン = 1 つの kbd)", () => {
        const [normal] = buildKeymapHelpSections(entries);
        expect(normal?.groups[0]?.items.map((item) => item.tokens.map((token) => token.label))).toEqual([["j"], ["g", "g"]]);
    });

    it("トークンの id は重複しない (React の key に使う)", () => {
        const ids = buildKeymapHelpSections(outlineKeymap).flatMap((section) => section.groups.flatMap((group) => group.items.flatMap((item) => [item.id, ...item.tokens.map((token) => token.id)])));
        expect(new Set(ids).size).toBe(ids.length);
    });

    it("実テーブルの全エントリがちょうど 1 度ずつ現れる", () => {
        const items = buildKeymapHelpSections(outlineKeymap).flatMap((section) => section.groups.flatMap((group) => group.items));
        expect(items.length).toBe(outlineKeymap.length);
    });
});

describe("formatKeyToken", () => {
    it("Escape は Esc として表示する", () => {
        expect(formatKeyToken("Escape")).toBe("Esc");
    });

    it("読み替えの無いトークンはそのまま表示する", () => {
        expect(formatKeyToken("g")).toBe("g");
        expect(formatKeyToken("?")).toBe("?");
    });
});

describe("HELP_CLOSE_KEYS", () => {
    it("q と Esc でヘルプを閉じる", () => {
        expect([...HELP_CLOSE_KEYS]).toEqual(["q", "Escape"]);
    });

    // 行内編集中の Esc はドキュメント専用エントリとして NORMAL に登録されているため、
    // 判定の対象は dispatcher が実際に解決するエントリ (dispatchableKeymap) に限る
    it("閉じるキーは dispatcher の解決対象に登録しない (ガードが処理するため)", () => {
        const normalKeys = dispatchableKeymap.filter((entry) => entry.mode === "NORMAL").map((entry) => entry.keys);
        for (const key of HELP_CLOSE_KEYS) {
            expect(normalKeys, key).not.toContain(key);
        }
    });

    it("ヘルプを開く ? が NORMAL に登録されている", () => {
        expect(outlineKeymap.some((entry) => entry.mode === "NORMAL" && entry.keys === "?")).toBe(true);
    });
});
