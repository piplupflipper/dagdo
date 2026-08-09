import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * 単体テストの設定 (docs/frontend-design.md §11)
 *
 * 現時点の対象は DOM に依存しない純粋なロジックのみのため environment は node のままとする。
 * コンポーネントのテストを追加する際に jsdom + @testing-library/react を足す
 */
export default defineConfig({
    resolve: {
        alias: {
            "@": fileURLToPath(new URL("./src", import.meta.url)),
        },
    },
    test: {
        include: ["src/**/*.test.ts"],
        environment: "node",
    },
});
