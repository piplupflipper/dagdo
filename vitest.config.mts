import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * 単体テストの設定 (docs/frontend-design.md §11)
 *
 * 対象の大半は DOM に依存しない純粋なロジックだが、行内編集 (Issue #17) のように
 * フォーカス遷移そのものが仕様である箇所は @testing-library/react で描画して確かめるため、
 * environment は jsdom とする。純粋なロジックのテストも同じ environment で問題なく動く
 */
export default defineConfig({
    resolve: {
        alias: {
            "@": fileURLToPath(new URL("./src", import.meta.url)),
        },
    },
    test: {
        include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
        environment: "jsdom",
    },
});
