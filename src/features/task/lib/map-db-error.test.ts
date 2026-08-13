import { PostgrestError } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { mapDbErrorOrThrow } from "@/features/task/lib/map-db-error";

const dbError = ({ code, message }: { code: string; message: string }): PostgrestError => new PostgrestError({ message, details: "", hint: "", code });

describe("mapDbErrorOrThrow", () => {
    it("SQLSTATE (ET001〜ET007) から TaskErrorCode を決める", () => {
        expect(mapDbErrorOrThrow(dbError({ code: "ET001", message: "task not found" }))).toEqual({ code: "TASK_NOT_FOUND", message: "task not found" });
        expect(mapDbErrorOrThrow(dbError({ code: "ET004", message: "blocked" })).code).toBe("TASK_BLOCKED");
        expect(mapDbErrorOrThrow(dbError({ code: "ET007", message: "invalid parent" })).code).toBe("INVALID_PARENT");
    });

    it("SQLSTATE を メッセージ先頭のコード文字列より優先する", () => {
        // SQLSTATE が ET004 (TASK_BLOCKED) で、メッセージ先頭は TASK_NOT_FOUND という食い違う組み合わせ
        expect(mapDbErrorOrThrow(dbError({ code: "ET004", message: "TASK_NOT_FOUND: task 1 not found" })).code).toBe("TASK_BLOCKED");
    });

    it("SQLSTATE が契約外ならメッセージ先頭のコード文字列へフォールバックする", () => {
        // PostgREST がラップし直して SQLSTATE が失われる経路を想定する
        expect(mapDbErrorOrThrow(dbError({ code: "P0001", message: "TASK_DEPENDENCY_CYCLE: cycle detected" })).code).toBe("TASK_DEPENDENCY_CYCLE");
        // 先頭コードの前後に空白があっても判別する (split(":") の後に trim する)
        expect(mapDbErrorOrThrow(dbError({ code: "", message: " INVALID_POSITION : position 9 is out of range" })).code).toBe("INVALID_POSITION");
    });

    it("message はそのまま返す (先頭のコード文字列も削らない)", () => {
        expect(mapDbErrorOrThrow(dbError({ code: "P0001", message: "TASK_BLOCKED: task 1 is blocked" }))).toEqual({ code: "TASK_BLOCKED", message: "TASK_BLOCKED: task 1 is blocked" });
    });

    it("SQLSTATE もメッセージ先頭も契約外なら握りつぶさず re-throw する", () => {
        const unknown = dbError({ code: "42501", message: "permission denied for table tasks" });
        expect(() => mapDbErrorOrThrow(unknown)).toThrow(unknown);
    });

    it("メッセージ先頭が TaskErrorCode に似た別文字列でも re-throw する", () => {
        const unknown = dbError({ code: "23514", message: "tasks_title_not_blank: new row violates check constraint" });
        expect(() => mapDbErrorOrThrow(unknown)).toThrow(unknown);
    });
});
