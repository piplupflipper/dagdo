const VERTEX_SHADER = `
attribute vec2 a_position;

void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER = `
precision highp float;

uniform vec2 u_resolution;
uniform float u_time;
uniform vec3 u_color1;
uniform vec3 u_color2;
uniform vec3 u_color3;
uniform vec3 u_color4;

float hash21(vec2 point) {
    point = fract(point * vec2(123.34, 456.21));
    point += dot(point, point + 45.32);
    return fract(point.x * point.y);
}

float valueNoise(vec2 point) {
    vec2 cell = floor(point);
    vec2 local = fract(point);
    vec2 curve = local * local * (3.0 - 2.0 * local);

    float bottomLeft = hash21(cell);
    float bottomRight = hash21(cell + vec2(1.0, 0.0));
    float topLeft = hash21(cell + vec2(0.0, 1.0));
    float topRight = hash21(cell + vec2(1.0, 1.0));

    return mix(mix(bottomLeft, bottomRight, curve.x), mix(topLeft, topRight, curve.x), curve.y);
}

float fbm(vec2 point) {
    float value = 0.0;
    float amplitude = 0.52;
    mat2 turn = mat2(0.80, -0.60, 0.60, 0.80);

    for (int octave = 0; octave < 4; octave++) {
        value += amplitude * valueNoise(point);
        point = turn * point * 2.03 + vec2(17.13, 9.71);
        amplitude *= 0.5;
    }

    return value;
}

void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution.xy;
    vec2 point = uv - 0.5;
    point.x *= u_resolution.x / max(u_resolution.y, 1.0);
    point *= 2.15;

    float time = u_time;
    vec2 warp = vec2(
        fbm(point * 0.68 + vec2(time * 0.010, -time * 0.006)),
        fbm(point * 0.68 + vec2(8.7 - time * 0.007, 3.1 + time * 0.009))
    );
    vec2 warpedPoint = point + (warp - 0.5) * 1.55;

    float broadClouds = fbm(warpedPoint * 0.78 + vec2(-time * 0.012, time * 0.007));
    float middleClouds = fbm((warpedPoint + vec2(broadClouds, -warp.x) * 0.58) * 1.48 + vec2(time * 0.016, -time * 0.010));
    float fineClouds = fbm((warpedPoint + vec2(middleClouds, broadClouds) * 0.36) * 2.85 + vec2(-time * 0.020, time * 0.013));

    float broadMask = smoothstep(0.34, 0.73, broadClouds);
    float middleMask = smoothstep(0.42, 0.76, middleClouds);
    float fineMask = smoothstep(0.48, 0.78, fineClouds);

    vec3 color = mix(u_color4, u_color3, 0.14 + (1.0 - uv.y) * 0.22);
    color = mix(color, u_color3, broadMask * 0.34);
    color = mix(color, u_color2, middleMask * 0.58);
    color = mix(color, u_color1, fineMask * 0.38);
    color += (fineClouds - 0.48) * 0.035;

    gl_FragColor = vec4(color, 1.0);
}
`;

const DARK_PALETTE = ["#b9c8f2", "#6e7fbf", "#4a5aa0", "#33406e"] as const;
const MAX_DEVICE_PIXEL_RATIO = 1.25;
const MAX_RENDER_DIMENSION = 1600;
const MAX_RENDER_PIXELS = 1_500_000;
const FRAME_INTERVAL = 1000 / 30;
/** 雲ドリフトの見かけ速度。シェーダー内の time 係数は変えず、ここだけを調整する */
const ANIMATION_TIME_SCALE = 1.5;

type ShaderLocations = {
    position: number;
    resolution: WebGLUniformLocation;
    time: WebGLUniformLocation;
    colors: [WebGLUniformLocation, WebGLUniformLocation, WebGLUniformLocation, WebGLUniformLocation];
};

/** 16 進カラーを WebGL uniform 用の RGB 配列へ変換する */
const hexToRgb = (hex: string): Float32Array => {
    const value = Number.parseInt(hex.slice(1), 16);
    return new Float32Array([((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255]);
};

/** シェーダーをコンパイルし、失敗時はリソースを解放して null を返す */
const createShader = (gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null => {
    const shader = gl.createShader(type);
    if (shader === null) {
        return null;
    }

    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        return shader;
    }

    gl.deleteShader(shader);
    return null;
};

/** 頂点・フラグメントシェーダーをリンクした描画プログラムを作る */
const createProgram = (gl: WebGLRenderingContext): WebGLProgram | null => {
    const vertexShader = createShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    if (vertexShader === null || fragmentShader === null) {
        if (vertexShader !== null) {
            gl.deleteShader(vertexShader);
        }
        if (fragmentShader !== null) {
            gl.deleteShader(fragmentShader);
        }
        return null;
    }

    const program = gl.createProgram();
    if (program === null) {
        gl.deleteShader(vertexShader);
        gl.deleteShader(fragmentShader);
        return null;
    }

    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);

    if (gl.getProgramParameter(program, gl.LINK_STATUS)) {
        return program;
    }
    gl.deleteProgram(program);
    return null;
};

/**
 * 夜空シェーダーのライフサイクルと省電力描画を管理する
 *
 * 最大 30fps・150 万ピクセルに制限し、画面非表示中と reduced motion 選択時は連続描画を止める
 */
export class NightSkyRenderer {
    private gl: WebGLRenderingContext | null = null;
    private program: WebGLProgram | null = null;
    private positionBuffer: WebGLBuffer | null = null;
    private locations: ShaderLocations | null = null;
    private animationFrame: number | null = null;
    private resizeObserver: ResizeObserver | null = null;
    private motionQuery: MediaQueryList | null = null;
    private animationTime = 0;
    private previousFrameTime = 0;
    private ready = false;
    private destroyed = false;

    constructor(private readonly canvas: HTMLCanvasElement) {}

    /** イベント監視と WebGL 描画を開始する */
    mount(): void {
        if (this.destroyed) {
            return;
        }

        this.canvas.addEventListener("webglcontextlost", this.handleContextLost);
        this.canvas.addEventListener("webglcontextrestored", this.handleContextRestored);
        this.motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
        this.motionQuery.addEventListener("change", this.handleMotionChange);
        document.addEventListener("visibilitychange", this.handleVisibilityChange);
        window.addEventListener("resize", this.handleResize);

        if ("ResizeObserver" in window) {
            this.resizeObserver = new ResizeObserver(this.handleResize);
            this.resizeObserver.observe(this.canvas.parentElement ?? this.canvas);
        }

        if (!this.initializeContext()) {
            return;
        }
        this.startRendering();
    }

    /** イベント監視と WebGL リソースを破棄する */
    destroy(): void {
        if (this.destroyed) {
            return;
        }
        this.destroyed = true;
        this.stopRendering();
        this.resizeObserver?.disconnect();
        this.motionQuery?.removeEventListener("change", this.handleMotionChange);
        document.removeEventListener("visibilitychange", this.handleVisibilityChange);
        window.removeEventListener("resize", this.handleResize);
        this.canvas.removeEventListener("webglcontextlost", this.handleContextLost);
        this.canvas.removeEventListener("webglcontextrestored", this.handleContextRestored);

        if (this.gl !== null && !this.gl.isContextLost()) {
            if (this.positionBuffer !== null) {
                this.gl.deleteBuffer(this.positionBuffer);
            }
            if (this.program !== null) {
                this.gl.deleteProgram(this.program);
            }
        }
        this.gl = null;
        this.program = null;
        this.positionBuffer = null;
        this.locations = null;
        this.resizeObserver = null;
        this.motionQuery = null;
        this.setReady(false);
    }

    private initializeContext(): boolean {
        if (this.destroyed) {
            return false;
        }

        const gl = this.canvas.getContext("webgl", {
            alpha: false,
            antialias: false,
            depth: false,
            stencil: false,
            powerPreference: "low-power",
            preserveDrawingBuffer: false,
        });
        if (gl === null) {
            return false;
        }

        const program = createProgram(gl);
        const positionBuffer = gl.createBuffer();
        if (program === null || positionBuffer === null) {
            if (program !== null) {
                gl.deleteProgram(program);
            }
            if (positionBuffer !== null) {
                gl.deleteBuffer(positionBuffer);
            }
            return false;
        }

        const position = gl.getAttribLocation(program, "a_position");
        const resolution = gl.getUniformLocation(program, "u_resolution");
        const time = gl.getUniformLocation(program, "u_time");
        const color1 = gl.getUniformLocation(program, "u_color1");
        const color2 = gl.getUniformLocation(program, "u_color2");
        const color3 = gl.getUniformLocation(program, "u_color3");
        const color4 = gl.getUniformLocation(program, "u_color4");

        if (position < 0 || resolution === null || time === null || color1 === null || color2 === null || color3 === null || color4 === null) {
            gl.deleteBuffer(positionBuffer);
            gl.deleteProgram(program);
            return false;
        }

        this.gl = gl;
        this.program = program;
        this.positionBuffer = positionBuffer;
        this.locations = { position, resolution, time, colors: [color1, color2, color3, color4] };

        // biome-ignore lint/correctness/useHookAtTopLevel: WebGL の useProgram は React Hook ではない
        gl.useProgram(program);
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(position);
        gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
        gl.disable(gl.BLEND);
        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.STENCIL_TEST);

        this.resize();
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        this.applyPalette();
        this.drawFrame();
        if (gl.getError() !== gl.NO_ERROR) {
            gl.deleteBuffer(positionBuffer);
            gl.deleteProgram(program);
            this.gl = null;
            this.program = null;
            this.positionBuffer = null;
            this.locations = null;
            return false;
        }
        this.setReady(true);
        return true;
    }

    private resize(): boolean {
        if (this.gl === null) {
            return false;
        }

        const bounds = this.canvas.getBoundingClientRect();
        const pixelRatio = Math.min(window.devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO);
        const rawWidth = Math.max(1, Math.round(bounds.width * pixelRatio));
        const rawHeight = Math.max(1, Math.round(bounds.height * pixelRatio));
        const renderScale = Math.min(1, MAX_RENDER_DIMENSION / Math.max(rawWidth, rawHeight), Math.sqrt(MAX_RENDER_PIXELS / (rawWidth * rawHeight)));
        const width = Math.max(1, Math.round(rawWidth * renderScale));
        const height = Math.max(1, Math.round(rawHeight * renderScale));

        if (this.canvas.width === width && this.canvas.height === height) {
            return false;
        }

        this.canvas.width = width;
        this.canvas.height = height;
        this.gl.viewport(0, 0, width, height);
        return true;
    }

    private applyPalette(): void {
        if (this.destroyed || this.gl === null || this.program === null || this.locations === null) {
            return;
        }

        const styles = window.getComputedStyle(document.documentElement);
        // biome-ignore lint/correctness/useHookAtTopLevel: WebGL の useProgram は React Hook ではない
        this.gl.useProgram(this.program);
        for (const [index, fallbackColor] of DARK_PALETTE.entries()) {
            const customProperty = styles.getPropertyValue(`--night-sky-c${index + 1}`).trim();
            const color = /^#[\da-f]{6}$/i.test(customProperty) ? customProperty : fallbackColor;
            this.gl.uniform3fv(this.locations.colors[index], hexToRgb(color));
        }
    }

    private drawFrame(): void {
        if (this.destroyed || this.gl === null || this.program === null || this.locations === null || this.gl.isContextLost()) {
            return;
        }

        // biome-ignore lint/correctness/useHookAtTopLevel: WebGL の useProgram は React Hook ではない
        this.gl.useProgram(this.program);
        this.gl.uniform2f(this.locations.resolution, this.canvas.width, this.canvas.height);
        this.gl.uniform1f(this.locations.time, this.animationTime);
        this.gl.drawArrays(this.gl.TRIANGLES, 0, 3);
    }

    private startRendering(): void {
        if (this.destroyed) {
            return;
        }
        this.stopRendering();
        this.previousFrameTime = 0;
        if (document.hidden) {
            return;
        }
        if (this.motionQuery?.matches === true) {
            this.drawFrame();
            return;
        }
        this.animationFrame = window.requestAnimationFrame(this.renderLoop);
    }

    private stopRendering(): void {
        if (this.animationFrame !== null) {
            window.cancelAnimationFrame(this.animationFrame);
        }
        this.animationFrame = null;
    }

    private setReady(ready: boolean): void {
        this.ready = ready;
        this.canvas.classList.toggle("night-sky-canvas-ready", ready);
        this.canvas.parentElement?.classList.toggle("night-sky-webgl-ready", ready);
    }

    private readonly renderLoop = (timestamp: number): void => {
        if (this.destroyed || !this.ready || document.hidden || this.motionQuery?.matches === true) {
            this.animationFrame = null;
            return;
        }

        if (this.previousFrameTime === 0) {
            this.previousFrameTime = timestamp;
        }
        const elapsed = timestamp - this.previousFrameTime;
        if (elapsed >= FRAME_INTERVAL) {
            this.animationTime += (Math.min(elapsed, 100) / 1000) * ANIMATION_TIME_SCALE;
            this.previousFrameTime = timestamp - (elapsed % FRAME_INTERVAL);
            this.drawFrame();
        }
        this.animationFrame = window.requestAnimationFrame(this.renderLoop);
    };

    private readonly handleResize = (): void => {
        if (!this.destroyed && this.resize()) {
            this.drawFrame();
        }
    };

    private readonly handleMotionChange = (): void => {
        if (!this.destroyed) {
            this.startRendering();
        }
    };

    private readonly handleVisibilityChange = (): void => {
        if (!this.destroyed) {
            this.startRendering();
        }
    };

    private readonly handleContextLost = (event: Event): void => {
        if (this.destroyed) {
            return;
        }
        event.preventDefault();
        this.stopRendering();
        this.setReady(false);
    };

    private readonly handleContextRestored = (): void => {
        if (this.destroyed) {
            return;
        }
        this.program = null;
        this.positionBuffer = null;
        this.locations = null;
        if (!this.initializeContext()) {
            return;
        }
        this.startRendering();
    };
}
