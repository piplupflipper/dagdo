import { describe, expect, it } from "vitest";
import { keyEventToToken, parseKeySequence } from "@/features/outline/lib/key-sequence";

/** keyEventToToken へ渡す KeyboardEvent 相当の最小オブジェクトを作る */
const keyEvent = (key: string, modifiers: { ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean } = {}) => ({
    key,
    ctrlKey: modifiers.ctrlKey ?? false,
    altKey: modifiers.altKey ?? false,
    metaKey: modifiers.metaKey ?? false,
});

describe("parseKeySequence", () => {
    it("スペース区切りのトークン列へ分解する", () => {
        expect(parseKeySequence("j")).toEqual(["j"]);
        expect(parseKeySequence("g g")).toEqual(["g", "g"]);
        expect(parseKeySequence("z a")).toEqual(["z", "a"]);
    });

    it("単体でキーになっている記号をエスケープなしで書ける", () => {
        expect(parseKeySequence("<")).toEqual(["<"]);
        expect(parseKeySequence(">")).toEqual([">"]);
        expect(parseKeySequence("/")).toEqual(["/"]);
    });

    it("名前付きキーと修飾キー付きキーを 1 トークンとして扱う", () => {
        expect(parseKeySequence("Enter")).toEqual(["Enter"]);
        expect(parseKeySequence("C-d")).toEqual(["C-d"]);
        expect(parseKeySequence("C-w j")).toEqual(["C-w", "j"]);
    });

    it("余分なスペースを無視する", () => {
        expect(parseKeySequence("  g   g  ")).toEqual(["g", "g"]);
    });
});

describe("keyEventToToken", () => {
    it("修飾なしのキーは event.key をそのままトークンにする", () => {
        expect(keyEventToToken(keyEvent("j"))).toBe("j");
        expect(keyEventToToken(keyEvent("Enter"))).toBe("Enter");
        expect(keyEventToToken(keyEvent("Escape"))).toBe("Escape");
    });

    it("Shift 修飾は接頭辞にせず event.key の反映結果を使う", () => {
        expect(keyEventToToken(keyEvent("J"))).toBe("J");
        expect(keyEventToToken(keyEvent("<"))).toBe("<");
    });

    it("Control / Alt / Meta を固定順の接頭辞にする", () => {
        expect(keyEventToToken(keyEvent("d", { ctrlKey: true }))).toBe("C-d");
        expect(keyEventToToken(keyEvent("d", { altKey: true }))).toBe("A-d");
        expect(keyEventToToken(keyEvent("d", { metaKey: true }))).toBe("M-d");
        expect(keyEventToToken(keyEvent("d", { metaKey: true, ctrlKey: true }))).toBe("C-M-d");
    });

    it("スペースキーを区切り文字と衝突しない名前へ読み替える", () => {
        expect(keyEventToToken(keyEvent(" "))).toBe("Space");
    });

    it("修飾キー単独の打鍵はトークンにしない", () => {
        expect(keyEventToToken(keyEvent("Control", { ctrlKey: true }))).toBeNull();
        expect(keyEventToToken(keyEvent("Shift"))).toBeNull();
        expect(keyEventToToken(keyEvent("Meta", { metaKey: true }))).toBeNull();
    });
});
