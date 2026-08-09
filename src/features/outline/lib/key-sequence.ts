/**
 * キーシーケンスのトークン表現 (docs/frontend-design.md §6.2)
 *
 * keymap テーブルの `keys` は「半角スペース区切りのトークン列」で書く。
 * 例: `j` / `g g` (gg) / `z a` (za) / `Enter` / `Escape` / `C-d` (Ctrl+d)
 *
 * 区切りをスペースにしているのは、`<` `>` のように単体でキーが割り当てられている文字を
 * エスケープなしで書けるようにするため。トークン単位に分解できるので、ヘルプ表示 (Issue #16) 側で
 * 1 トークン = 1 つの `kbd` として描画することもできる
 */

/** keymap のトークン化に必要な KeyboardEvent の部分集合 (DOM に依存せず単体テストできるようにする) */
type KeyEventLike = Pick<KeyboardEvent, "key" | "ctrlKey" | "altKey" | "metaKey">;

/** 修飾キーの接頭辞。`C-d` のように基底キーの前へ `-` 区切りで並べる (順序は Control → Alt → Meta で固定) */
const MODIFIER_PREFIXES = [
    { prefix: "C", isPressed: (event: KeyEventLike): boolean => event.ctrlKey },
    { prefix: "A", isPressed: (event: KeyEventLike): boolean => event.altKey },
    { prefix: "M", isPressed: (event: KeyEventLike): boolean => event.metaKey },
] as const;

/** 単独で押されてもトークンにならないキー (修飾キーそのもの) */
const MODIFIER_KEY_NAMES: ReadonlySet<string> = new Set(["Control", "Alt", "Meta", "Shift", "AltGraph", "CapsLock"]);

/** `event.key` のうちトークン表現と衝突する値を読み替える (スペースは区切り文字と衝突する) */
const normalizeKeyName = (key: string): string => (key === " " ? "Space" : key);

/**
 * keymap テーブルの `keys` をトークン列へ分解する
 *
 * @param keys スペース区切りのキーシーケンス表現 (例: `"g g"`)
 */
export const parseKeySequence = (keys: string): string[] => keys.split(" ").filter((token) => token.length > 0);

/**
 * キーイベントを 1 つのトークンへ正規化する
 *
 * Shift は接頭辞にしない。`J` や `<` のように `event.key` へ既に反映されているため、
 * 接頭辞にすると `S-J` と `J` が別トークンに割れてしまう
 *
 * @returns 修飾キー単独の打鍵など、トークンにならない入力では null
 */
export const keyEventToToken = (event: KeyEventLike): string | null => {
    if (MODIFIER_KEY_NAMES.has(event.key)) {
        return null;
    }
    const prefixes = MODIFIER_PREFIXES.filter((modifier) => modifier.isPressed(event)).map((modifier) => modifier.prefix);
    return [...prefixes, normalizeKeyName(event.key)].join("-");
};
