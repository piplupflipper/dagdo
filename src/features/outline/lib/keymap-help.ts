import { parseKeySequence } from "@/features/outline/lib/key-sequence";
import type { KeymapCategory, KeymapEntry } from "@/features/outline/lib/keymap-table";
import type { OutlineMode } from "@/store/types";

/**
 * keymap テーブルからヘルプオーバーレイの表示内容を組み立てる層 (docs/frontend-design.md §6.2)
 *
 * ヘルプ側にキー一覧を直書きすると二重管理になるため、表示するキー・説明・並び順はすべて
 * `outlineKeymap` から導出する。DOM に依存しない純粋関数として切り出して単体テストする
 */

/** `kbd` 1 つ分の表示単位 */
type KeymapHelpToken = {
    /** React の key に使う識別子。テーブル内で一意 */
    id: string;
    /** 表示ラベル (`Escape` のような長い名前は読み替える) */
    label: string;
};

/** ヘルプの 1 行。テーブルの 1 エントリに対応する */
type KeymapHelpItem = {
    /**
     * React の key に使う識別子
     *
     * `mode` + `keys` だけでは一意にならない。同じキーが文脈違いで 2 度現れることがあるためで、
     * 例えば NORMAL の `Enter` は `編集` (詳細ペインへ移る) と `行内編集` (編集を確定) の両方に登録されている。
     * 文脈は `category` が表すため (keymap-table.ts の KeymapCategory)、識別子にも含める
     */
    id: string;
    tokens: KeymapHelpToken[];
    description: string;
};

/** カテゴリ単位のまとまり */
type KeymapHelpGroup = {
    category: KeymapCategory;
    items: KeymapHelpItem[];
};

/** モード単位のまとまり */
type KeymapHelpSection = {
    mode: OutlineMode;
    groups: KeymapHelpGroup[];
};

/**
 * ヘルプオーバーレイを閉じるキーのトークン
 *
 * これらは keymap テーブルではなく dispatcher 先頭のガード (use-outline-keymap.ts) が処理する。
 * 「ヘルプ表示中にだけ効く」という文脈は、モードを増やさない制約 (Issue #16) のもとでは
 * テーブルの `mode` 軸で表現できないため。ヘルプの表示側もこの定数を読むので直書きにはならない
 */
export const HELP_CLOSE_KEYS: readonly string[] = ["q", "Escape"];

/** `event.key` 由来の長い名前を `kbd` に収まる表記へ読み替える */
const TOKEN_LABELS: Readonly<Record<string, string | undefined>> = { Escape: "Esc" };

/** キートークンを `kbd` の表示ラベルへ変換する */
export const formatKeyToken = (token: string): string => TOKEN_LABELS[token] ?? token;

/**
 * keymap テーブルをヘルプ表示用に mode → category でグルーピングする
 *
 * `run` を持たないエントリ (コンポーネント側のローカルハンドラが処理するキー) も除外しない。
 * mode・category の並びはテーブルでの初出順を保つため、テーブルを並べ替えるとそのまま表示順が変わる
 */
export const buildKeymapHelpSections = (entries: readonly KeymapEntry[]): KeymapHelpSection[] => {
    const sections: KeymapHelpSection[] = [];

    for (const entry of entries) {
        const existingSection = sections.find((section) => section.mode === entry.mode);
        const section = existingSection ?? { mode: entry.mode, groups: [] };
        if (existingSection === undefined) {
            sections.push(section);
        }

        const existingGroup = section.groups.find((group) => group.category === entry.category);
        const group = existingGroup ?? { category: entry.category, items: [] };
        if (existingGroup === undefined) {
            section.groups.push(group);
        }

        const id = `${entry.mode} ${entry.category} ${entry.keys}`;
        group.items.push({
            id,
            tokens: parseKeySequence(entry.keys).map((token, index) => ({ id: `${id} ${index}`, label: formatKeyToken(token) })),
            description: entry.description,
        });
    }

    return sections;
};
