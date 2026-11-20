/**
 * ViscosityCode: the Lightweight mode preference (./lightweight.ts).
 *
 * It lives in the `performance` group of the version 1 document under
 * `viscosity:fx:v1`, which once also held the removed Effects groups
 * (background, effects, sounds, projectBackgrounds, motion). Those groups are
 * no longer read, but a write merges into the stored document and leaves them
 * exactly as they were, so an older build still finds them. A missing, broken
 * or foreign-version document reads as defaults and is replaced on write.
 */
import { create } from "zustand";

export const FX_SETTINGS_STORAGE_KEY = "viscosity:fx:v1";
export const FX_SETTINGS_VERSION = 1;

/** `auto` turns the mode on for low-memory or low-power devices. */
export const LIGHTWEIGHT_MODES = ["auto", "on", "off"] as const;
export type LightweightMode = (typeof LIGHTWEIGHT_MODES)[number];

export const DEFAULT_LIGHTWEIGHT_MODE: LightweightMode = "auto";

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** The stored v1 document, or null when it is missing, broken or another version. */
function readDocument(): Record<string, unknown> | null {
  try {
    const raw = localStorage.getItem(FX_SETTINGS_STORAGE_KEY);
    const doc = raw ? record(JSON.parse(raw)) : null;
    return doc?.version === FX_SETTINGS_VERSION ? doc : null;
  } catch {
    return null;
  }
}

export function readLightweightMode(): LightweightMode {
  const value = record(readDocument()?.performance)?.lightweight;
  return LIGHTWEIGHT_MODES.find((mode) => mode === value) ?? DEFAULT_LIGHTWEIGHT_MODE;
}

function writeLightweightMode(lightweight: LightweightMode): void {
  try {
    const doc = readDocument() ?? { version: FX_SETTINGS_VERSION };
    const performance = record(doc.performance) ?? {};
    localStorage.setItem(
      FX_SETTINGS_STORAGE_KEY,
      JSON.stringify({ ...doc, performance: { ...performance, lightweight } }),
    );
  } catch {
    // Non-fatal: the change still applies for this session.
  }
}

interface PerformanceSettingsState {
  lightweight: LightweightMode;
  setLightweight: (mode: LightweightMode) => void;
}

export const usePerformanceSettings = create<PerformanceSettingsState>()((set) => ({
  lightweight: readLightweightMode(),
  setLightweight: (lightweight) => {
    set({ lightweight });
    writeLightweightMode(lightweight);
  },
}));
