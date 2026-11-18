/**
 * ViscosityCode: client-side preferences for the animated background (Step 3)
 * and agent-state effects (Step 4).
 *
 * These are view preferences, so they live in this browser's local storage
 * rather than the host settings document (ARCHITECTURE_NOTES.md §8.6). Every
 * storage access is guarded; malformed or unavailable storage yields defaults.
 * The document version is checked on read so a future v2 can migrate instead
 * of misreading.
 */

import { create } from "zustand";

export const FX_SETTINGS_STORAGE_KEY = "viscosity:fx:v1";
export const FX_SETTINGS_VERSION = 1;

export const BACKGROUND_PRESETS = ["mesh", "particles", "aurora"] as const;
export type BackgroundPreset = (typeof BACKGROUND_PRESETS)[number];

export const BACKGROUND_FPS_CAPS = [15, 30, 60] as const;
export type BackgroundFpsCap = (typeof BACKGROUND_FPS_CAPS)[number];

export interface BackgroundSettings {
  /** Master switch for the animated background layer. */
  enabled: boolean;
  preset: BackgroundPreset;
  /** 0..1 — brightness, contrast and speed of the effect. */
  intensity: number;
  fpsCap: BackgroundFpsCap;
  /** 0.4..1 — opacity of panels drawn over the background (1 = opaque). */
  panelOpacity: number;
  /** 0..40 px — backdrop blur behind translucent panels. */
  panelBlur: number;
  /** Stop rendering while the window is not focused. */
  pauseWhenUnfocused: boolean;
  /**
   * Stop animating when the OS asks to reduce motion (macOS Reduce Motion,
   * Windows "Animation effects" off). Off by default: the owner wants the
   * background to keep animating regardless of that setting.
   */
  respectReducedMotion: boolean;
  /** Slow down on battery and stop when the battery is low. */
  batterySaver: boolean;
}

export interface EffectsSettings {
  /** Master switch for all agent-state effects. */
  enabled: boolean;
  thinkingGlow: boolean;
  streamingEnergy: boolean;
  toolIndicator: boolean;
  attentionColor: boolean;
  errorFlash: boolean;
  completionAnimation: boolean;
  typingGlow: boolean;
}

export interface FxSettings {
  background: BackgroundSettings;
  effects: EffectsSettings;
}

export const DEFAULT_FX_SETTINGS: FxSettings = {
  background: {
    enabled: true,
    preset: "mesh",
    intensity: 0.7,
    fpsCap: 30,
    panelOpacity: 0.78,
    panelBlur: 20,
    pauseWhenUnfocused: true,
    respectReducedMotion: false,
    batterySaver: true,
  },
  effects: {
    enabled: true,
    thinkingGlow: true,
    streamingEnergy: true,
    toolIndicator: true,
    attentionColor: true,
    errorFlash: true,
    completionAnimation: true,
    typingGlow: true,
  },
};

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function oneOf<T>(values: readonly T[], value: unknown, fallback: T): T {
  return values.includes(value as T) ? (value as T) : fallback;
}

/** Normalise any stored shape into valid settings, field by field. */
export function normalizeFxSettings(raw: unknown): FxSettings {
  const doc = (raw && typeof raw === "object" ? raw : {}) as {
    background?: Record<string, unknown>;
    effects?: Record<string, unknown>;
  };
  const bg = doc.background ?? {};
  const fx = doc.effects ?? {};
  const d = DEFAULT_FX_SETTINGS;
  return {
    background: {
      enabled: bool(bg.enabled, d.background.enabled),
      preset: oneOf(BACKGROUND_PRESETS, bg.preset, d.background.preset),
      intensity: clamp(bg.intensity, 0, 1, d.background.intensity),
      fpsCap: oneOf(BACKGROUND_FPS_CAPS, bg.fpsCap, d.background.fpsCap),
      panelOpacity: clamp(bg.panelOpacity, 0.4, 1, d.background.panelOpacity),
      panelBlur: clamp(bg.panelBlur, 0, 40, d.background.panelBlur),
      pauseWhenUnfocused: bool(bg.pauseWhenUnfocused, d.background.pauseWhenUnfocused),
      respectReducedMotion: bool(bg.respectReducedMotion, d.background.respectReducedMotion),
      batterySaver: bool(bg.batterySaver, d.background.batterySaver),
    },
    effects: {
      enabled: bool(fx.enabled, d.effects.enabled),
      thinkingGlow: bool(fx.thinkingGlow, d.effects.thinkingGlow),
      streamingEnergy: bool(fx.streamingEnergy, d.effects.streamingEnergy),
      toolIndicator: bool(fx.toolIndicator, d.effects.toolIndicator),
      attentionColor: bool(fx.attentionColor, d.effects.attentionColor),
      errorFlash: bool(fx.errorFlash, d.effects.errorFlash),
      completionAnimation: bool(fx.completionAnimation, d.effects.completionAnimation),
      typingGlow: bool(fx.typingGlow, d.effects.typingGlow),
    },
  };
}

/** Read persisted settings; a missing, foreign-version or broken document yields defaults. */
export function readFxSettings(): FxSettings {
  try {
    const raw = localStorage.getItem(FX_SETTINGS_STORAGE_KEY);
    if (!raw) return normalizeFxSettings(undefined);
    const parsed = JSON.parse(raw) as { version?: unknown } | null;
    if (parsed?.version !== FX_SETTINGS_VERSION) return normalizeFxSettings(undefined);
    return normalizeFxSettings(parsed);
  } catch {
    return normalizeFxSettings(undefined);
  }
}

function writeFxSettings(settings: FxSettings): void {
  try {
    localStorage.setItem(
      FX_SETTINGS_STORAGE_KEY,
      JSON.stringify({ version: FX_SETTINGS_VERSION, ...settings }),
    );
  } catch {
    // Non-fatal: the change still applies for this session.
  }
}

interface FxSettingsState extends FxSettings {
  setBackground: (patch: Partial<BackgroundSettings>) => void;
  setEffects: (patch: Partial<EffectsSettings>) => void;
  reset: () => void;
}

export const useFxSettings = create<FxSettingsState>()((set, get) => {
  function commit(next: FxSettings): void {
    const normalized = normalizeFxSettings(next);
    set(normalized);
    writeFxSettings(normalized);
  }
  return {
    ...readFxSettings(),
    setBackground: (patch) => {
      const { background, effects } = get();
      commit({ background: { ...background, ...patch }, effects });
    },
    setEffects: (patch) => {
      const { background, effects } = get();
      commit({ background, effects: { ...effects, ...patch } });
    },
    reset: () => commit(DEFAULT_FX_SETTINGS),
  };
});
