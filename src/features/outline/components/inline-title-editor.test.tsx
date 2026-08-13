import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InlineTitleEditor, type InlineTitleEditorProps } from "@/features/outline/components/inline-title-editor";

/**
 * 行内編集のフォーカス遷移そのものが仕様であるためのコンポーネントテスト (Issue #17)
 *
 * 網羅は狙わず、フォーカスが input に入ること・終了時に行へ戻ること・確定/取り消しの結果だけを確かめる
 */

/** 行 (outline-row.tsx の tabIndex={-1} を持つ要素) に相当するフォーカス戻し先 */
const createRowElement = (): HTMLDivElement => {
    const row = document.createElement("div");
    row.tabIndex = -1;
    document.body.appendChild(row);
    return row;
};

/**
 * `value` は本番では `OutlineShell` の `inlineTitleEdit.draft` が保持する controlled value であるため、
 * テストも同じ形 (呼び出し元が state を持ち `onDraftChange` で更新する) で包む
 */
const ControlledEditor = ({ initialValue, ...props }: Omit<InlineTitleEditorProps, "value" | "onDraftChange"> & { initialValue: string }) => {
    const [value, setValue] = useState(initialValue);
    return <InlineTitleEditor {...props} value={value} onDraftChange={setValue} />;
};

const renderEditor = (overrides: Partial<InlineTitleEditorProps & { initialValue: string }> = {}) => {
    const row = createRowElement();
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    const { initialValue = "元のタイトル", ...rest } = overrides;
    render(<ControlledEditor initialValue={initialValue} caret="start" onCommit={onCommit} onCancel={onCancel} focusRow={() => row.focus()} {...rest} />);
    const input = screen.getByRole("textbox", { name: "タイトルを行内編集" });
    if (!(input instanceof HTMLInputElement)) {
        throw new Error("inline title editor input not found");
    }
    return { input, row, onCommit, onCancel };
};

afterEach(() => {
    cleanup();
    document.body.replaceChildren();
});

describe("編集開始", () => {
    it("マウント時に input へフォーカスする", () => {
        const { input } = renderEditor();
        expect(document.activeElement).toBe(input);
    });

    it("`i` (start) はキャレットを先頭に置く", () => {
        const { input } = renderEditor({ caret: "start" });
        expect([input.selectionStart, input.selectionEnd]).toEqual([0, 0]);
    });

    it("`A` (end) はキャレットを末尾に置く", () => {
        const { input } = renderEditor({ caret: "end" });
        expect([input.selectionStart, input.selectionEnd]).toEqual(["元のタイトル".length, "元のタイトル".length]);
    });

    it("再レンダーではキャレット位置を適用し直さない (入力のたびに巻き戻るのを防ぐ)", () => {
        const setSelectionRange = vi.spyOn(HTMLInputElement.prototype, "setSelectionRange");
        const { input } = renderEditor({ caret: "end" });
        expect(setSelectionRange).toHaveBeenCalledTimes(1);
        fireEvent.change(input, { target: { value: "元のタイトルX" } });
        fireEvent.change(input, { target: { value: "元のタイトルXY" } });
        expect(setSelectionRange).toHaveBeenCalledTimes(1);
        setSelectionRange.mockRestore();
    });
});

describe("確定と取り消し", () => {
    it("Enter は変更後のタイトルで確定し、フォーカスを行へ戻す", () => {
        const { input, row, onCommit, onCancel } = renderEditor();
        fireEvent.change(input, { target: { value: "新しいタイトル" } });
        fireEvent.keyDown(input, { key: "Enter" });
        expect(onCommit).toHaveBeenCalledWith("新しいタイトル");
        expect(onCancel).not.toHaveBeenCalled();
        expect(document.activeElement).toBe(row);
    });

    it("Enter はタイトルをトリムしてから渡す", () => {
        const { input, onCommit } = renderEditor();
        fireEvent.change(input, { target: { value: "  余白つき  " } });
        fireEvent.keyDown(input, { key: "Enter" });
        expect(onCommit).toHaveBeenCalledWith("余白つき");
    });

    it("Esc は変更後のタイトルで確定し、フォーカスを行へ戻す (以前は取り消しだった)", () => {
        const { input, row, onCommit, onCancel } = renderEditor();
        fireEvent.change(input, { target: { value: "Esc で確定される" } });
        fireEvent.keyDown(input, { key: "Escape" });
        expect(onCommit).toHaveBeenCalledWith("Esc で確定される");
        expect(onCancel).not.toHaveBeenCalled();
        expect(document.activeElement).toBe(row);
    });

    it("blur は確定として扱う。既に別の要素へフォーカスが移っているため行へは戻さない", () => {
        const { input, row, onCommit } = renderEditor();
        fireEvent.change(input, { target: { value: "blur で確定" } });
        fireEvent.blur(input);
        expect(onCommit).toHaveBeenCalledWith("blur で確定");
        expect(document.activeElement).not.toBe(row);
    });

    it("確定後の blur を二重に確定しない (フォーカスを行へ戻す際に起きる)", () => {
        const { input, onCommit, onCancel } = renderEditor();
        fireEvent.keyDown(input, { key: "Enter" });
        fireEvent.blur(input);
        expect(onCommit).toHaveBeenCalledTimes(1);
        expect(onCancel).not.toHaveBeenCalled();
    });

    it("IME 変換確定の Enter / Esc は編集の確定・取り消しにしない", () => {
        const { input, onCommit, onCancel } = renderEditor();
        fireEvent.keyDown(input, { key: "Enter", isComposing: true });
        fireEvent.keyDown(input, { key: "Escape", isComposing: true });
        expect(onCommit).not.toHaveBeenCalled();
        expect(onCancel).not.toHaveBeenCalled();
    });
});

describe("空タイトル", () => {
    it("Enter では保存せず、インラインにエラーを出して編集を続ける", () => {
        const { input, onCommit } = renderEditor();
        fireEvent.change(input, { target: { value: "   " } });
        fireEvent.keyDown(input, { key: "Enter" });
        expect(onCommit).not.toHaveBeenCalled();
        expect(screen.getByRole("alert").textContent).toBe("タイトルは空にできません");
        expect(document.activeElement).toBe(input);
    });

    it("Esc で空文字のまま確定しようとした場合も、Enter と同じくインラインエラーを出して編集を続ける", () => {
        const { input, row, onCommit, onCancel } = renderEditor();
        fireEvent.change(input, { target: { value: "   " } });
        fireEvent.keyDown(input, { key: "Escape" });
        expect(onCommit).not.toHaveBeenCalled();
        expect(onCancel).not.toHaveBeenCalled();
        expect(screen.getByRole("alert").textContent).toBe("タイトルは空にできません");
        expect(document.activeElement).not.toBe(row);
    });

    it("入力を再開するとエラー表示を消す", () => {
        const { input } = renderEditor();
        fireEvent.change(input, { target: { value: "" } });
        fireEvent.keyDown(input, { key: "Enter" });
        fireEvent.change(input, { target: { value: "戻した" } });
        expect(screen.queryByRole("alert")).toBeNull();
    });

    it("空のまま blur したら保存せず取り消す (元のタイトルへ戻す)", () => {
        const { input, onCommit, onCancel } = renderEditor();
        fireEvent.change(input, { target: { value: "" } });
        fireEvent.blur(input);
        expect(onCommit).not.toHaveBeenCalled();
        expect(onCancel).toHaveBeenCalledTimes(1);
    });
});

describe("祖先へのキーイベント伝播", () => {
    it("編集中のキー入力を祖先へ伝えない (入力は input の中で完結させる)", () => {
        const onAncestorKeyDown = vi.fn();
        document.body.addEventListener("keydown", onAncestorKeyDown);
        const { input } = renderEditor();
        fireEvent.keyDown(input, { key: " " });
        fireEvent.keyDown(input, { key: "a" });
        expect(onAncestorKeyDown).not.toHaveBeenCalled();
        document.body.removeEventListener("keydown", onAncestorKeyDown);
    });
});
