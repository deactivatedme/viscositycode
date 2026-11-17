import { create } from "zustand";
import {
  WINDOW_MATERIAL_PREFERENCES,
  type WindowMaterialPreference,
} from "@/shared/ipc/procedures/settings";

/**
 * ViscosityCode: the Windows 11 window backdrop preference (Auto / Mica /
 * Acrylic / None). It is a per-device client view preference
 * (ARCHITECTURE_NOTES §8.6), so it lives in this renderer's local storage, not
 * in the host settings shared with paired clients. The AppProvider forwards it
 * to the main process through `setWindowChrome`.
 *
 * Storage format v1: the raw preference string under
 * {@link WINDOW_MATERIAL_STORAGE_KEY}. A missing, unreadable or unknown value
 * (for example one written by a newer build) reads as the default and is left
 * untouched until the user picks again.
 */
export const WINDOW_MATERIAL_STORAGE_KEY = "viscosity:window-material:v1";
export const DEFAULT_WINDOW_MATERIAL: WindowMaterialPreference = "auto";

export function isWindowMaterialPreference(value: unknown): value is WindowMaterialPreference {
  return (
    typeof value === "string" && (WINDOW_MATERIAL_PREFERENCES as readonly string[]).includes(value)
  );
}

type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): PreferenceStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    // Storage can be blocked (sandboxed or privacy-restricted contexts).
    return null;
  }
}

export function readStoredWindowMaterial(
  storage: PreferenceStorage | null = defaultStorage(),
): WindowMaterialPreference {
  try {
    const stored = storage?.getItem(WINDOW_MATERIAL_STORAGE_KEY);
    return isWindowMaterialPreference(stored) ? stored : DEFAULT_WINDOW_MATERIAL;
  } catch {
    return DEFAULT_WINDOW_MATERIAL;
  }
}

function writeStoredWindowMaterial(
  preference: WindowMaterialPreference,
  storage: PreferenceStorage | null = defaultStorage(),
): void {
  try {
    storage?.setItem(WINDOW_MATERIAL_STORAGE_KEY, preference);
  } catch {
    // Quota or blocked storage: keep the in-memory choice for this session.
  }
}

interface WindowMaterialState {
  preference: WindowMaterialPreference;
}

export const useWindowMaterialStore = create<WindowMaterialState>()(() => ({
  preference: readStoredWindowMaterial(),
}));

export function setWindowMaterialPreference(preference: WindowMaterialPreference): void {
  writeStoredWindowMaterial(preference);
  useWindowMaterialStore.setState({ preference });
}

export function useWindowMaterialPreference(): WindowMaterialPreference {
  return useWindowMaterialStore((state) => state.preference);
}
