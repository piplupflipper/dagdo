import type { ReactNode } from "react";

/**
 * ゴミ箱専用ルート (仮実装)
 * 実装フェーズで deleted_at IS NOT NULL のタスク取得と TrashView の描画に置き換える (docs/frontend-design.md §4, §7.1)
 */
const TrashPage = (): ReactNode => {
    return <div>entodo</div>;
};

export default TrashPage;
