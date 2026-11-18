/**
 * ViscosityCode: naming and de-duplication for imported themes (file or link).
 *
 * - A document whose light and dark palettes match an installed custom theme
 *   is not added again; that theme is applied instead. Colors compare
 *   case-insensitively and `#abc` equals `#aabbcc`. Bundled presets are not
 *   matched: exporting one and importing it is how users start an editable
 *   copy (see `themeExport.ts`).
 * - A new theme keeps its own name unless a custom theme or bundled preset
 *   already uses it (case-insensitively), in which case it becomes
 *   "Name (2)", "Name (3)", … within the 80-character name limit.
 * - Every new theme gets a fresh installation id, so an import never replaces
 *   an existing record.
 */
import type { CustomTheme, ThemeDocument, ThemePalette } from "@/shared/customThemes";
import { THEME_SPECS } from "@/renderer/theme/themePresets";

export const MAX_THEME_LABEL_LENGTH = 80;

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const NUMBERED_LABEL = /^(.*\S)\s+\((\d{1,4})\)$/u;

function canonicalValue(value: unknown): unknown {
  if (typeof value !== "string" || !HEX.test(value)) return value;
  const lower = value.toLowerCase();
  if (lower.length !== 4) return lower;
  return `#${lower[1]}${lower[1]}${lower[2]}${lower[2]}${lower[3]}${lower[3]}`;
}

function paletteKey(palette: ThemePalette): string {
  const entries = Object.entries(palette)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => [key, canonicalValue(value)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return JSON.stringify(entries);
}

/** Identity of a theme's colors, independent of its name and id. */
export function themeColorsKey(theme: Pick<ThemeDocument, "light" | "dark">): string {
  return `${paletteKey(theme.light)}/${paletteKey(theme.dark)}`;
}

function normalizedLabel(label: string): string {
  return label.trim().toLocaleLowerCase();
}

/** `label`, or the first "label (n)" no other theme uses. */
export function uniqueThemeLabel(label: string, takenLabels: Iterable<string>): string {
  const taken = new Set<string>();
  for (const entry of takenLabels) taken.add(normalizedLabel(entry));
  const trimmed = label.trim().slice(0, MAX_THEME_LABEL_LENGTH).trim();
  if (!taken.has(normalizedLabel(trimmed))) return trimmed;
  const base = trimmed.match(NUMBERED_LABEL)?.[1] ?? trimmed;
  for (let n = 2; n < 10_000; n++) {
    const suffix = ` (${n})`;
    const candidate = `${base.slice(0, MAX_THEME_LABEL_LENGTH - suffix.length).trimEnd()}${suffix}`;
    if (!taken.has(normalizedLabel(candidate))) return candidate;
  }
  return trimmed;
}

export type ThemeImportPlan =
  /** Not installed yet: review it in the editor, then save. */
  | { kind: "new"; theme: CustomTheme }
  /** The same colors are already installed: apply that theme instead. */
  | { kind: "existing"; theme: CustomTheme };

export interface ThemeImportPlanOptions {
  customThemes: readonly CustomTheme[];
  /** A fresh `custom:` id; injectable for tests. */
  newId?: () => string;
}

export function planThemeImport(
  doc: ThemeDocument,
  options: ThemeImportPlanOptions,
): ThemeImportPlan {
  const key = themeColorsKey(doc);
  const custom = options.customThemes.find((theme) => themeColorsKey(theme) === key);
  if (custom) return { kind: "existing", theme: custom };
  const label = uniqueThemeLabel(doc.label, [
    ...options.customThemes.map((theme) => theme.label),
    ...THEME_SPECS.map((spec) => spec.label),
  ]);
  const id = options.newId?.() ?? `custom:${crypto.randomUUID()}`;
  return {
    kind: "new",
    theme: {
      version: doc.version,
      id,
      label,
      light: { ...doc.light },
      dark: { ...doc.dark },
    },
  };
}
