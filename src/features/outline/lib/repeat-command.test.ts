import { describe, expect, it, vi } from "vitest";
import { dispatchRepeatCommand, type RepeatableCommand, type RepeatCommandHandlers } from "@/features/outline/lib/repeat-command";

const createHandlerSpies = (): RepeatCommandHandlers => ({
    completeCursor: vi.fn(),
    softDeleteCursor: vi.fn(),
    moveCursorSibling: vi.fn(),
    indentCursor: vi.fn(),
    outdentCursor: vi.fn(),
});

describe("dispatchRepeatCommand", () => {
    const cases: readonly { command: RepeatableCommand; handler: keyof RepeatCommandHandlers; args: readonly unknown[] }[] = [
        { command: { kind: "complete" }, handler: "completeCursor", args: [] },
        { command: { kind: "softDelete" }, handler: "softDeleteCursor", args: [] },
        { command: { kind: "reorder", direction: "down" }, handler: "moveCursorSibling", args: ["down"] },
        { command: { kind: "reorder", direction: "up" }, handler: "moveCursorSibling", args: ["up"] },
        { command: { kind: "indent" }, handler: "indentCursor", args: [] },
        { command: { kind: "outdent" }, handler: "outdentCursor", args: [] },
    ];

    it.each(cases)("$command.kind ($command.direction) は $handler だけを呼ぶ", ({ command, handler, args }) => {
        const handlers = createHandlerSpies();
        dispatchRepeatCommand(command, handlers);
        for (const [name, spy] of Object.entries(handlers)) {
            expect(spy, name).toHaveBeenCalledTimes(name === handler ? 1 : 0);
        }
        expect(handlers[handler]).toHaveBeenCalledWith(...args);
    });
});
