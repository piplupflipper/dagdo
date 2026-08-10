"use client";

import { type JSX, useEffect, useRef } from "react";
import { NightSkyRenderer } from "@/components/background/night-sky-renderer";

/**
 * 全ルートの背面に固定表示する夜空背景
 *
 * WebGL が利用できない環境では CSS の雲レイヤーをそのままフォールバックとして表示する
 */
export const NightSkyBackground = (): JSX.Element => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (canvas === null) {
            return;
        }

        const renderer = new NightSkyRenderer(canvas);
        renderer.mount();
        return () => renderer.destroy();
    }, []);

    return (
        <div className="night-sky" aria-hidden="true">
            <span className="night-sky-cloud night-sky-cloud-a" />
            <span className="night-sky-cloud night-sky-cloud-b" />
            <span className="night-sky-cloud night-sky-cloud-c" />
            <span className="night-sky-cloud night-sky-cloud-d" />
            <canvas className="night-sky-canvas" ref={canvasRef} tabIndex={-1} />
            <span className="night-sky-grain" />
        </div>
    );
};
