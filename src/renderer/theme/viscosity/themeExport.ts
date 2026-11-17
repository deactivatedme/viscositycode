/**
 * ViscosityCode: export a built-in theme preset as a version 1 custom-theme
 * document, so users can start their own theme from any bundled palette and
 * re-import it through the existing Import theme flow.
 */

import {
  CUSTOM_THEME_VERSION,
  serializeThemeDocument,
  type ThemeDocument,
} from "@/shared/customThemes";
import { DEFAULT_THEME_ID, THEME_SPECS, getThemePreset } from "@/renderer/theme/themePresets";

/**
 * The v1 document for the built-in preset the app shows for `themeId`.
 * Legacy, unknown and no-longer-installed custom ids resolve the same way the
 * app applies them (to the base theme). Installed custom themes export from
 * their own editor, so callers only offer this while no custom theme is active.
 */
export function builtInThemeDocument(themeId: string): ThemeDocument | null {
  const resolvedId = getThemePreset(themeId).id;
  const spec =
    THEME_SPECS.find((entry) => entry.id === resolvedId) ??
    THEME_SPECS.find((entry) => entry.id === DEFAULT_THEME_ID);
  if (!spec) return null;
  return {
    version: CUSTOM_THEME_VERSION,
    label: spec.label,
    light: { ...spec.light },
    dark: { ...spec.dark },
  };
}

/** A portable file name for a theme label, e.g. "Rosé Pine" → "rose-pine-theme.json". */
export function themeExportFilename(label: string): string {
  const slug = label
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return `${slug || "custom"}-theme.json`;
}

/** Serialized JSON + file name for the built-in preset shown for `themeId`. */
export function exportBuiltInTheme(themeId: string): { filename: string; json: string } | null {
  const doc = builtInThemeDocument(themeId);
  if (!doc) return null;
  return { filename: themeExportFilename(doc.label), json: serializeThemeDocument(doc) };
}
