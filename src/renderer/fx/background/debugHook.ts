/**
 * ViscosityCode: development-only measurement hook for the background, read
 * over CDP by smoke/perf scripts:
 *
 *   window.__viscosityFx.background.stats()
 *     → { fps, framesRendered, renderer: "webgl2" | "canvas2d" | "off",
 *         paused: string | null, internalSize: { width, height } }
 *   window.__viscosityFx.background.setPreset("aurora")
 *   window.__viscosityFx.background.forceRenderer("canvas2d")   // or "webgl2" / "auto"
 *
 * Installed only when `import.meta.env.DEV`; other fx modules may add their
 * own keys to `window.__viscosityFx`, so this one merges rather than replaces.
 */
import { BACKGROUND_PRESETS, useFxSettings, type BackgroundPreset } from "../fxSettingsStore";
import type {
  BackgroundController,
  BackgroundRendererPreference,
  BackgroundStats,
} from "./backgroundController";

export interface BackgroundDebugApi {
  stats(): BackgroundStats;
  setPreset(preset: BackgroundPreset): void;
  forceRenderer(renderer: BackgroundRendererPreference): void;
}

type FxDebugWindow = Window & { __viscosityFx?: Record<string, unknown> };

let activeController: BackgroundController | null = null;
let forcedRenderer: BackgroundRendererPreference = "auto";

const OFF_STATS: BackgroundStats = {
  fps: 0,
  framesRendered: 0,
  renderer: "off",
  paused: "disabled",
  internalSize: { width: 0, height: 0 },
};

const api: BackgroundDebugApi = {
  stats: () => activeController?.stats() ?? { ...OFF_STATS, internalSize: { width: 0, height: 0 } },
  setPreset: (preset) => {
    if (!(BACKGROUND_PRESETS as readonly string[]).includes(preset)) {
      throw new Error(`Unknown background preset "${String(preset)}"`);
    }
    useFxSettings.getState().setBackground({ preset });
  },
  forceRenderer: (renderer) => {
    if (renderer !== "auto" && renderer !== "webgl2" && renderer !== "canvas2d") {
      throw new Error(`Unknown background renderer "${String(renderer)}"`);
    }
    forcedRenderer = renderer;
    activeController?.setRendererPreference(renderer);
  },
};

/** Renderer the debug hook asked for; new controllers start with it. */
export function debugRendererPreference(): BackgroundRendererPreference {
  return forcedRenderer;
}

/** Expose `window.__viscosityFx.background` (DEV only; idempotent). */
export function installBackgroundDebugHook(): void {
  if (!import.meta.env.DEV || typeof window === "undefined") return;
  const target = window as FxDebugWindow;
  const namespace = target.__viscosityFx ?? {};
  namespace.background = api;
  target.__viscosityFx = namespace;
}

/** Point the debug hook at the live controller (DEV only). Returns the unregister. */
export function registerBackgroundDebug(controller: BackgroundController): () => void {
  if (!import.meta.env.DEV) return () => undefined;
  installBackgroundDebugHook();
  activeController = controller;
  return () => {
    if (activeController === controller) activeController = null;
  };
}
