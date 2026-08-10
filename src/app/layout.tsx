import type { Metadata } from "next";
import type { ReactNode } from "react";
import { NightSkyBackground } from "@/components/background/night-sky-background";
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
            <body>
                <NightSkyBackground />
                <div className="relative z-10">{children}</div>
            </body>
        </html>
    );
};

export default RootLayout;
