// ViscosityCode: pure window-chrome decisions (startup colours and the Windows
// backdrop material), kept free of Electron imports so they are unit-testable
// and shared by the window factory and the `setWindowChrome` handler.
import {
  windowMaterialPreferenceSchema,
  type WindowMaterialPreference,
} from "@/shared/ipc/procedures/settings";

export type WindowAppearance = "light" | "dark";

/** Fully transparent window background, required for a native backdrop to show. */
export const TRANSPARENT_WINDOW_BACKGROUND = "#00000000";

/**
 * Opaque window background per appearance: the default theme's monochrome
 * `--background` (tokens.css), so the first frame (before the renderer paints),
 * the opaque fallback after a backdrop is switched off and the edge Windows
 * exposes during a fast resize match the default theme instead of flashing.
 */
export function windowBaseBackgroundColor(appearance: WindowAppearance | undefined): string {
  return appearance === "dark" ? "#000000" : "#fafafa";
}

/**
 * Caption-button glyph colour for the OS-drawn minimise/maximise/close buttons
 * (Windows/Linux `titleBarOverlay`). Light glyphs on the dark base, dark glyphs
 * on the light base; both clear WCAG AA against their base by a wide margin.
 */
export function windowCaptionSymbolColor(appearance: WindowAppearance): string {
  return appearance === "dark" ? "#fafafa" : "#1f2937";
}

/** Values Electron's `BrowserWindow.setBackgroundMaterial` accepts that we use. */
export type WindowsBackgroundMaterial = "mica" | "acrylic" | "none";

/**
 * Resolves the Windows 11 DWM backdrop for a window.
 *
 * - No native capability (Windows 10, builds before 22621) or no translucent
 *   sidebar requested: `none` (the renderer keeps its CSS imitation).
 * - `preference` absent: a caller predating the preference, so keep the
 *   upstream behaviour (`acrylic`).
 * - `auto`: Mica, the Windows 11 default for app windows.
 * - `mica` / `acrylic` / `none`: as chosen.
 */
export function resolveWindowsBackgroundMaterial(input: {
  preference: WindowMaterialPreference | undefined;
  translucent: boolean;
  capable: boolean;
}): WindowsBackgroundMaterial {
  if (!input.capable || !input.translucent) return "none";
  switch (input.preference) {
    case undefined:
      return "acrylic";
    case "auto":
    case "mica":
      return "mica";
    case "acrylic":
      return "acrylic";
    case "none":
      return "none";
  }
}

/**
 * Whether a native material can be revealed behind this window, reported to the
 * renderer as `nativeCapable`. Equals the OS capability, except that on Windows
 * an explicit `none` preference opts out of the native backdrop, so the renderer
 * falls back to its in-app tint exactly as it does on Windows 10. macOS vibrancy
 * and Linux are unaffected by the (Windows-only) preference.
 */
export function windowReportsNativeMaterial(input: {
  platform: NodeJS.Platform;
  capable: boolean;
  preference: WindowMaterialPreference | undefined;
}): boolean {
  if (!input.capable) return false;
  return !(input.platform === "win32" && input.preference === "none");
}

/**
 * Last preference a renderer sent through `setWindowChrome`, held in memory so
 * windows created later in this process (a re-created main window, the browser
 * window) open with the user's backdrop, and mirrored to the shell state store
 * so the next cold launch opens with it too instead of flashing `auto` (Mica).
 */
let rememberedPreference: WindowMaterialPreference | undefined;

/** Minimal slice of the main process `ShellStateStore`. */
interface PreferenceStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

/**
 * Shell-state key for the persisted preference. Must be in the backend host's
 * `preloadShellState` list. An unknown value (newer build) reads as absent.
 */
export const WINDOW_MATERIAL_STATE_KEY = "viscosity-window-material-v1";

let preferenceStore: PreferenceStore | undefined;

/** Called by the window factory with the shell state store it was given. */
export function bindWindowMaterialPreferenceStore(store: PreferenceStore): void {
  preferenceStore = store;
}

export function rememberWindowMaterialPreference(preference: WindowMaterialPreference): void {
  if (preference === rememberedPreference) return;
  rememberedPreference = preference;
  preferenceStore?.set(WINDOW_MATERIAL_STATE_KEY, preference);
}

/** The preference new windows start with: the last one sent, else the stored one, else `auto`. */
export function startupWindowMaterialPreference(): WindowMaterialPreference {
  if (rememberedPreference) return rememberedPreference;
  const stored = windowMaterialPreferenceSchema.safeParse(
    preferenceStore?.get(WINDOW_MATERIAL_STATE_KEY),
  );
  return stored.success ? stored.data : "auto";
}

/** Test-only reset of the in-memory preference and store binding. */
export function resetRememberedWindowMaterialPreferenceForTests(): void {
  rememberedPreference = undefined;
  preferenceStore = undefined;
}
