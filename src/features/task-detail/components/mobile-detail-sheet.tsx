import type { JSX } from "react";
import { DagPanel } from "@/features/dag/components/dag-panel";
import { DetailPane, type DetailPaneProps } from "./detail-pane";

/**
 * MobileDetailSheet の props (OutlineShell が参照する公開契約)
 *
 * `DetailPane` の props はシート自身では一切使わず素通しするだけなので、個別に書き写さず
 * `DetailPaneProps` をそのまま取り込む (各 props の意味は detail-pane.tsx のコメントを参照)。
 * ただしフォーカス移動の ref (`DetailPaneHandle`) を要求するのは PC 幅の `OutlineShell` だけであり、
 * シートは中継しないため `ref` だけは除く
 */
type MobileDetailSheetProps = Omit<DetailPaneProps, "ref"> & {
    flashTaskId: string | null;
    /** 前面のオーバーレイ (ヘルプ) が開いている間 true。開いているシートも背面として不活性にする */
    isInert: boolean;
    /** 背景タップ・閉じるボタンから呼ばれる。OutlineShell 側でカーソルを解除してシートを閉じる */
    onClose: () => void;
};

/**
 * モバイル幅の詳細シート (docs/frontend-design.md §4, §7.1)
 *
 * PC 幅では右ペインに DetailPane / DagPanel を並べるが、モバイル幅では 2 ペインが収まらないため
 * 画面下部から迫り上がるボトムシートに切り替える。
 * 切り替えは window.innerWidth 等の JS 判定ではなく Tailwind のブレークポイントで行い、
 * このコンポーネント自身が md 以上で display:none になる (md:hidden)。
 * 詳細表示・依存グラフのロジックは DetailPane / DagPanel をそのまま再利用し、重複させない
 */
export const MobileDetailSheet = ({ flashTaskId, isInert, onClose, ...detailPaneProps }: MobileDetailSheetProps): JSX.Element => {
    const { task, allTasks, dependencies } = detailPaneProps;
    // カーソル (選択タスク) の有無をそのまま開閉状態とする。閉じる = カーソル解除なので、
    // 同じ行を再度タップすれば必ず開き直せる (シート側に開閉 state を二重に持たない)
    const isOpen = task !== null;

    return (
        // 閉じている間もマウントしたままにして translate のトランジションを効かせる。
        // 代わりに inert とポインタイベント無効化で、閉じている間は背面の操作を妨げないようにする。
        // 開いていても isInert のとき (ヘルプ表示中) は同様に不活性にする
        <div className={`fixed inset-0 z-40 md:hidden ${isOpen ? "" : "pointer-events-none"}`} inert={!isOpen || isInert}>
            <button
                type="button"
                aria-label="詳細を閉じる"
                onClick={onClose}
                className={`absolute inset-0 h-full w-full cursor-default bg-overlay transition-opacity duration-200 ${isOpen ? "opacity-100" : "opacity-0"}`}
            />

            <section
                aria-label="タスク詳細"
                className={`absolute inset-x-0 bottom-0 flex max-h-[80dvh] flex-col rounded-t-xl border-t border-border bg-bg-alt shadow-lg backdrop-blur-xl transition-transform duration-200 ${
                    isOpen ? "translate-y-0" : "translate-y-full"
                }`}
            >
                <div className="flex flex-shrink-0 items-center gap-2 border-b border-border px-3.5 py-2">
                    <span className="h-1 w-9 flex-shrink-0 rounded-full bg-border" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate text-xs text-text-dim">{task?.title ?? ""}</span>
                    <button type="button" onClick={onClose} className="flex-shrink-0 rounded-base border border-border px-2.5 py-1 text-xs text-text-dim">
                        閉じる
                    </button>
                </div>

                <DetailPane {...detailPaneProps} />
                <DagPanel centerTaskId={task?.id ?? null} tasks={allTasks} dependencies={dependencies} flashTaskId={flashTaskId} />
            </section>
        </div>
    );
};
