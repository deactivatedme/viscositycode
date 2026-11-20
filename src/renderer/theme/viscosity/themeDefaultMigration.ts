/**
 * ViscosityCode: one-time move of an existing install to the Viscosity Blue
 * default. Builds before that default cached the monochrome preset id for
 * every device, picked or not, so the cache cannot tell a choice from the old
 * default; the owner asked for existing installs to follow the new default.
 * Runs once per device (the flag below); a later pick of the monochrome theme
 * is kept. Leaf module: imported by both the early theme boot and the
 * settings store, so it must not import either.
 */
import { DEFAULT_SELECTED_THEME_ID } from "@/shared/settings";

const MOVED_FLAG_KEY = "viscosity:theme-default-blue:v1";
/** `DEFAULT_THEME_ID` in ../themePresets (the monochrome preset). */
const MONOCHROME_THEME_ID = "default";

export function moveCachedThemeToDefaultOnce(settingsCacheKey: string): void {
  try {
    if (localStorage.getItem(MOVED_FLAG_KEY)) return;
    localStorage.setItem(MOVED_FLAG_KEY, "1");
    const raw = localStorage.getItem(settingsCacheKey);
    if (!raw) return;
    const cached: unknown = JSON.parse(raw);
    if (typeof cached !== "object" || cached === null) return;
    if ((cached as { themePreset?: unknown }).themePreset !== MONOCHROME_THEME_ID) return;
    localStorage.setItem(
      settingsCacheKey,
      JSON.stringify({ ...cached, themePreset: DEFAULT_SELECTED_THEME_ID }),
    );
  } catch {
    // Never block boot on a preference move.
  }
}
