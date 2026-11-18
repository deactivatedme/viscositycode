/**
 * ViscosityCode: client-side preferences for the animated background (Step 3),
 * agent-state effects (Step 4), the sound pack and per-project backgrounds
 * (Step 5).
 *
 * These are view preferences, so they live in this browser's local storage
 * rather than the host settings document (ARCHITECTURE_NOTES.md §8.6). Every
 * storage access is guarded; malformed or unavailable storage yields defaults.
 * The document version is checked on read so a future v2 can migrate instead
 * of misreading. Step 5 groups (`sounds`, `projectBackgrounds`) are additive:
 * a version 1 document written before them reads with their defaults.
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

/** Sound pack cues, one per agent transition worth hearing. */
export const SOUND_CUES = ["done", "error", "attention"] as const;
export type SoundCue = (typeof SOUND_CUES)[number];

export interface SoundSettings {
  /** Master switch for the synthesized sound pack. Off by default. */
  enabled: boolean;
  /** 0..1 — output level of every cue. */
  volume: number;
  /**
   * Also play while the app is in front and the thread is on screen. Off by
   * default: cues are for work you are not looking at.
   */
  alsoInFront: boolean;
  /** A turn finished. */
  done: boolean;
  /** An agent hit an error. */
  error: boolean;
  /** An agent waits for your approval or reply. */
  attention: boolean;
}

/** A project's own background look; absent fields follow the global setting. */
export interface ProjectBackgroundOverride {
  preset?: BackgroundPreset;
  /** 0..1, like `BackgroundSettings.intensity`. */
  intensity?: number;
}

/** Overrides keyed by project id. */
export type ProjectBackgrounds = Readonly<Record<string, ProjectBackgroundOverride>>;

/** `null` clears that field of the override; an absent field leaves it unchanged. */
export interface ProjectBackgroundPatch {
  preset?: BackgroundPreset | null;
  intensity?: number | null;
}

/** Upper bound on stored overrides, so a long-lived device cannot grow the document forever. */
export const MAX_PROJECT_BACKGROUNDS = 200;
const MAX_PROJECT_ID_LENGTH = 512;
const UNSAFE_KEYS: ReadonlySet<string> = new Set(["__proto__", "constructor", "prototype"]);

export interface FxSettings {
  background: BackgroundSettings;
  effects: EffectsSettings;
  sounds: SoundSettings;
  projectBackgrounds: ProjectBackgrounds;
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
  sounds: {
    enabled: false,
    volume: 0.6,
    alsoInFront: false,
    done: true,
    error: true,
    attention: true,
  },
  projectBackgrounds: {},
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

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** One project's override, or null when nothing valid is left to override. */
export function normalizeProjectBackgroundOverride(raw: unknown): ProjectBackgroundOverride | null {
  const value = record(raw);
  const preset = oneOf<BackgroundPreset | undefined>(BACKGROUND_PRESETS, value.preset, undefined);
  const intensity =
    typeof value.intensity === "number" && Number.isFinite(value.intensity)
      ? clamp(value.intensity, 0, 1, 0)
      : undefined;
  if (preset === undefined && intensity === undefined) return null;
  return {
    ...(preset === undefined ? {} : { preset }),
    ...(intensity === undefined ? {} : { intensity }),
  };
}

/** Keep valid, non-empty overrides under safe, bounded project ids. */
export function normalizeProjectBackgrounds(raw: unknown): ProjectBackgrounds {
  const out: Record<string, ProjectBackgroundOverride> = {};
  let count = 0;
  for (const [projectId, value] of Object.entries(record(raw))) {
    if (count >= MAX_PROJECT_BACKGROUNDS) break;
    if (!projectId || projectId.length > MAX_PROJECT_ID_LENGTH || UNSAFE_KEYS.has(projectId)) {
      continue;
    }
    const override = normalizeProjectBackgroundOverride(value);
    if (!override) continue;
    out[projectId] = override;
    count += 1;
  }
  return out;
}

/** Normalise any stored shape into valid settings, field by field. */
export function normalizeFxSettings(raw: unknown): FxSettings {
  const doc = record(raw);
  const bg = record(doc.background);
  const fx = record(doc.effects);
  const snd = record(doc.sounds);
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
    sounds: {
      enabled: bool(snd.enabled, d.sounds.enabled),
      volume: clamp(snd.volume, 0, 1, d.sounds.volume),
      alsoInFront: bool(snd.alsoInFront, d.sounds.alsoInFront),
      done: bool(snd.done, d.sounds.done),
      error: bool(snd.error, d.sounds.error),
      attention: bool(snd.attention, d.sounds.attention),
    },
    projectBackgrounds: normalizeProjectBackgrounds(doc.projectBackgrounds),
  };
}

/** Apply a patch to one project's override; returns null when the override becomes empty. */
export function patchProjectBackground(
  current: ProjectBackgroundOverride | undefined,
  patch: ProjectBackgroundPatch,
): ProjectBackgroundOverride | null {
  const preset = patch.preset === undefined ? current?.preset : (patch.preset ?? undefined);
  const intensity =
    patch.intensity === undefined ? current?.intensity : (patch.intensity ?? undefined);
  return normalizeProjectBackgroundOverride({ preset, intensity });
}

function sameShallow<T extends object>(a: T, b: T): boolean {
  const keys = Object.keys(a) as (keyof T)[];
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}

function sameProjectBackgrounds(a: ProjectBackgrounds, b: ProjectBackgrounds): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => {
    const other = b[key];
    return other !== undefined && sameShallow(a[key]!, other);
  });
}

/**
 * Reuse the previous group objects that did not change, so subscribers that
 * compare one group by reference (the background, the agent monitor) only
 * wake for their own group.
 */
function keepUnchangedGroups(next: FxSettings, previous: FxSettings): FxSettings {
  return {
    background: sameShallow(next.background, previous.background)
      ? previous.background
      : next.background,
    effects: sameShallow(next.effects, previous.effects) ? previous.effects : next.effects,
    sounds: sameShallow(next.sounds, previous.sounds) ? previous.sounds : next.sounds,
    projectBackgrounds: sameProjectBackgrounds(next.projectBackgrounds, previous.projectBackgrounds)
      ? previous.projectBackgrounds
      : next.projectBackgrounds,
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
  setSounds: (patch: Partial<SoundSettings>) => void;
  /** Change one project's background override (`null` fields fall back to global). */
  setProjectBackground: (projectId: string, patch: ProjectBackgroundPatch) => void;
  /** Drop a project's override so it follows the global background again. */
  clearProjectBackground: (projectId: string) => void;
  reset: () => void;
}

export const useFxSettings = create<FxSettingsState>()((set, get) => {
  function current(): FxSettings {
    const { background, effects, sounds, projectBackgrounds } = get();
    return { background, effects, sounds, projectBackgrounds };
  }
  function commit(next: FxSettings): void {
    const normalized = keepUnchangedGroups(normalizeFxSettings(next), current());
    set(normalized);
    writeFxSettings(normalized);
  }
  function withProjectBackground(
    projectId: string,
    override: ProjectBackgroundOverride | null,
  ): ProjectBackgrounds {
    // The edited project goes last; at the cap the least recently edited ones
    // make room, so a new override is never dropped by normalisation.
    const others = Object.entries(get().projectBackgrounds).filter(([id]) => id !== projectId);
    const room = override ? MAX_PROJECT_BACKGROUNDS - 1 : MAX_PROJECT_BACKGROUNDS;
    const next: Record<string, ProjectBackgroundOverride> = {};
    for (const [id, value] of others.slice(Math.max(0, others.length - room))) next[id] = value;
    if (override) next[projectId] = override;
    return next;
  }
  return {
    ...readFxSettings(),
    setBackground: (patch) => {
      const settings = current();
      commit({ ...settings, background: { ...settings.background, ...patch } });
    },
    setEffects: (patch) => {
      const settings = current();
      commit({ ...settings, effects: { ...settings.effects, ...patch } });
    },
    setSounds: (patch) => {
      const settings = current();
      commit({ ...settings, sounds: { ...settings.sounds, ...patch } });
    },
    setProjectBackground: (projectId, patch) => {
      if (!projectId || UNSAFE_KEYS.has(projectId)) return;
      const override = patchProjectBackground(get().projectBackgrounds[projectId], patch);
      commit({ ...current(), projectBackgrounds: withProjectBackground(projectId, override) });
    },
    clearProjectBackground: (projectId) => {
      if (!Object.hasOwn(get().projectBackgrounds, projectId)) return;
      commit({ ...current(), projectBackgrounds: withProjectBackground(projectId, null) });
    },
    reset: () => commit(DEFAULT_FX_SETTINGS),
  };
});
