import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
    title: "entodo",
    description: "entodo",
};

/**
 * 全体レイアウト
 */
const RootLayout = ({ children }: LayoutProps<"/">): ReactNode => {
    return (
        <html lang="ja">
            <body>{children}</body>
        </html>
    );
};

export default RootLayout;
