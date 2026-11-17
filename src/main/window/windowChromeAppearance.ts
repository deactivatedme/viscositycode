// ViscosityCode: pure window-chrome decisions (startup colours and the Windows
// backdrop material), kept free of Electron imports so they are unit-testable
// and shared by the window factory and the `setWindowChrome` handler.
import type { WindowMaterialPreference } from "@/shared/ipc/procedures/settings";

export type WindowAppearance = "light" | "dark";

/** Fully transparent window background, required for a native backdrop to show. */
export const TRANSPARENT_WINDOW_BACKGROUND = "#00000000";

/**
 * Opaque window background per appearance: the ViscosityCode base colours, so
 * the first frame (before the renderer paints) and the opaque fallback after a
 * backdrop is switched off match the default theme instead of flashing.
 */
export function windowBaseBackgroundColor(appearance: WindowAppearance | undefined): string {
  return appearance === "dark" ? "#0a0a0b" : "#f4f4f5";
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
 * window) open with the user's backdrop. Not persisted: before the renderer's
 * first call a fresh process starts from the default (`auto`), and the renderer
 * corrects the material live once it loads.
 */
let rememberedPreference: WindowMaterialPreference | undefined;

export function rememberWindowMaterialPreference(preference: WindowMaterialPreference): void {
  rememberedPreference = preference;
}

/** The preference new windows start with: the last one sent, else `auto`. */
export function startupWindowMaterialPreference(): WindowMaterialPreference {
  return rememberedPreference ?? "auto";
}

/** Test-only reset of the in-memory preference. */
export function resetRememberedWindowMaterialPreferenceForTests(): void {
  rememberedPreference = undefined;
}
