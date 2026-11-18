/**
 * ViscosityCode: the contract both background backends (WebGL2 and the 2D
 * canvas fallback) implement, plus their internal-resolution policy.
 */
import type { BackgroundPreset } from "../fxSettingsStore";
import type { BackgroundThemeColors } from "./themeColors";

export type BackgroundBackendKind = "webgl2" | "canvas2d";
export type BackgroundRendererKind = BackgroundBackendKind | "off";

export interface BackgroundFrame {
  /** Animation time in seconds, wrapped to the shader loop. */
  time: number;
  /** 0..1 user intensity. */
  intensity: number;
  /** 0..1 smoothed agent output energy. */
  energy: number;
}

export interface BackgroundBackend {
  readonly kind: BackgroundBackendKind;
  readonly canvas: HTMLCanvasElement;
  /** Whether the GPU context is currently lost (always false for 2D). */
  readonly contextLost: boolean;
  /** Switch preset; false when the preset cannot be built on this backend. */
  setPreset(preset: BackgroundPreset): boolean;
  setColors(colors: BackgroundThemeColors): void;
  /** Set the drawing-buffer size in device pixels (clears the canvas). */
  resize(width: number, height: number): void;
  /** Draw one frame; false when nothing could be drawn (lost context). */
  render(frame: BackgroundFrame): boolean;
  /** Free GPU/canvas resources. The canvas element is not reused afterwards. */
  dispose(): void;
}

export interface InternalSize {
  width: number;
  height: number;
}

/**
 * Internal resolution per backend: the effect is soft, so it renders well
 * below device resolution and the canvas is CSS-scaled up to the window.
 */
const RESOLUTION_POLICY: Record<
  BackgroundBackendKind,
  { dprFactor: number; minScale: number; maxScale: number; maxSide: number }
> = {
  // ~0.5 × devicePixelRatio, at most one internal pixel per CSS pixel.
  webgl2: { dprFactor: 0.5, minScale: 0.5, maxScale: 1, maxSide: 1600 },
  // The 2D fallback draws on the CPU; keep it small.
  canvas2d: { dprFactor: 0.35, minScale: 0.25, maxScale: 0.35, maxSide: 640 },
};

/** Drawing-buffer size for a CSS-pixel viewport on the given backend. */
export function internalSizeFor(
  kind: BackgroundBackendKind,
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number,
): InternalSize {
  const policy = RESOLUTION_POLICY[kind];
  const width = Number.isFinite(cssWidth) ? Math.max(0, cssWidth) : 0;
  const height = Number.isFinite(cssHeight) ? Math.max(0, cssHeight) : 0;
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  let scale = Math.min(policy.maxScale, Math.max(policy.minScale, dpr * policy.dprFactor));
  const longest = Math.max(width, height) * scale;
  if (longest > policy.maxSide) scale *= policy.maxSide / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
