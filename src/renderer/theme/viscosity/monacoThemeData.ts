/**
 * ViscosityCode: Monaco theme data built from the active app theme.
 *
 * Monaco only understands `#rrggbb` / `#rrggbbaa` colours, so callers resolve
 * the app's CSS custom properties first (see `readMonacoThemeColors`) and this
 * module turns them into widget colours and a small token rule set. The
 * editor background stays transparent so the pane's `--content-background`
 * shows through, exactly like the previous fixed themes.
 */

import { mixHex } from "@/renderer/theme/colorMath";
import {
  deriveAnsiColors,
  parseCssRgb,
  toOpaqueHex,
  type TerminalAppearance,
} from "./terminalPalette";

/** Resolved (xterm-safe: `#hex` / `rgb()` / `rgba()`) theme colours; any may be missing. */
export interface MonacoThemeColors {
  background?: string | null;
  content?: string | null;
  foreground?: string | null;
  muted?: string | null;
  surface?: string | null;
  overlay?: string | null;
  border?: string | null;
  accent?: string | null;
  field?: string | null;
  success?: string | null;
  warning?: string | null;
  danger?: string | null;
}

/** The CSS custom property each `MonacoThemeColors` key is read from. */
export const MONACO_THEME_CSS_VARS: Record<keyof MonacoThemeColors, string> = {
  background: "--background",
  content: "--content-background",
  foreground: "--foreground",
  muted: "--muted",
  surface: "--surface",
  overlay: "--overlay",
  border: "--border",
  accent: "--accent",
  field: "--field-background",
  success: "--success",
  warning: "--warning",
  danger: "--danger",
};

export interface MonacoTokenRule {
  token: string;
  foreground?: string;
  fontStyle?: string;
}

export interface MonacoThemeData {
  base: "vs" | "vs-dark";
  inherit: boolean;
  rules: MonacoTokenRule[];
  colors: Record<string, string>;
}

type Resolved = Required<{ [K in keyof MonacoThemeColors]: string }>;

/** Viscosity values double as the fallback when a variable cannot be resolved. */
const FALLBACK_COLORS: Record<TerminalAppearance, Resolved> = {
  dark: {
    background: "#0a0a0b",
    content: "#0e0e10",
    foreground: "#e6e6e8",
    muted: "#8a8a93",
    surface: "#111113",
    overlay: "#141416",
    border: "#1f1f23",
    accent: "#38bdf8",
    field: "#1c1c1e",
    success: "#4ade80",
    warning: "#facc15",
    danger: "#f87171",
  },
  light: {
    background: "#f4f4f5",
    content: "#fafafa",
    foreground: "#18181b",
    muted: "#6b6b73",
    surface: "#ffffff",
    overlay: "#ededee",
    border: "#e3e3e8",
    accent: "#0279bb",
    field: "#f3f3f4",
    success: "#15803d",
    warning: "#a16207",
    danger: "#dc2626",
  },
};

const TRANSPARENT = "#00000000";

/** Max RGB channel spread (0–255) for an accent to count as grey. */
const GREY_ACCENT_SPREAD = 12;

/** True for an achromatic accent (e.g. the monochrome Viscosity base theme). */
function isGreyAccent(hex: string): boolean {
  const rgb = parseCssRgb(hex);
  return rgb !== null && Math.max(...rgb) - Math.min(...rgb) <= GREY_ACCENT_SPREAD;
}

/** `#rrggbb` + two-digit alpha (0–1). */
function alpha(hex: string, value: number): string {
  const byte = Math.round(Math.min(1, Math.max(0, value)) * 255);
  return `${hex}${byte.toString(16).padStart(2, "0")}`;
}

/** Monaco token colours are bare 6-digit hex. */
function token(hex: string): string {
  return hex.replace("#", "").toLowerCase();
}

function resolveColors(appearance: TerminalAppearance, input: MonacoThemeColors | null): Resolved {
  const fallback = FALLBACK_COLORS[appearance];
  const resolved = { ...fallback };
  if (!input) return resolved;
  for (const key of Object.keys(fallback) as (keyof MonacoThemeColors)[]) {
    const value = input[key];
    // Translucent values (e.g. a glass tint) are flattened to their sRGB
    // channels; Monaco widgets need opaque anchors to derive from.
    const hex = value && parseCssRgb(value) ? toOpaqueHex(value) : null;
    if (hex) resolved[key] = hex;
  }
  return resolved;
}

/**
 * Build Monaco theme data for `appearance` from resolved theme colours. Pass
 * `null` to get the Viscosity fallback (used for the inactive appearance until
 * it becomes active and is re-defined from real CSS values).
 */
export function buildMonacoThemeData(
  appearance: TerminalAppearance,
  input: MonacoThemeColors | null,
): MonacoThemeData {
  const c = resolveColors(appearance, input);
  const dark = appearance === "dark";
  const editorBg = c.content;
  const widget = c.overlay;
  const ansi = deriveAnsiColors(appearance, editorBg, c.foreground);
  const subtle = (amount: number) => alpha(c.foreground, amount);

  const colors: Record<string, string> = {
    "editor.background": TRANSPARENT,
    "editor.foreground": c.foreground,
    "editorGutter.background": TRANSPARENT,
    "editorLineNumber.foreground": mixHex(c.muted, editorBg, 0.75),
    "editorLineNumber.activeForeground": c.foreground,
    "editorCursor.foreground": c.accent,
    "editor.lineHighlightBackground": subtle(dark ? 0.035 : 0.03),
    "editor.lineHighlightBorder": TRANSPARENT,
    "editor.selectionBackground": alpha(c.accent, dark ? 0.28 : 0.22),
    "editor.inactiveSelectionBackground": alpha(c.accent, dark ? 0.16 : 0.12),
    "editor.selectionHighlightBackground": alpha(c.accent, 0.14),
    "editor.wordHighlightBackground": subtle(0.08),
    "editor.wordHighlightStrongBackground": alpha(c.accent, 0.18),
    "editor.findMatchBackground": alpha(c.warning, dark ? 0.45 : 0.35),
    "editor.findMatchBorder": c.warning,
    "editor.findMatchHighlightBackground": alpha(c.warning, dark ? 0.2 : 0.18),
    "editor.findRangeHighlightBackground": subtle(0.05),
    "editorWhitespace.foreground": alpha(c.muted, 0.35),
    "editorIndentGuide.background1": alpha(c.border, 0.9),
    "editorIndentGuide.activeBackground1": alpha(c.muted, 0.6),
    "editorBracketMatch.background": alpha(c.accent, 0.14),
    "editorBracketMatch.border": alpha(c.accent, 0.55),
    "editorLink.activeForeground": c.accent,
    "editorError.foreground": c.danger,
    "editorWarning.foreground": c.warning,
    "editorInfo.foreground": c.accent,
    "editorGutter.addedBackground": c.success,
    "editorGutter.modifiedBackground": c.accent,
    "editorGutter.deletedBackground": c.danger,
    "editorOverviewRuler.border": TRANSPARENT,
    "editorOverviewRuler.findMatchForeground": alpha(c.warning, 0.8),
    "editorOverviewRuler.selectionHighlightForeground": alpha(c.accent, 0.6),
    "editorWidget.background": widget,
    "editorWidget.foreground": c.foreground,
    "editorWidget.border": c.border,
    "editorHoverWidget.background": widget,
    "editorHoverWidget.foreground": c.foreground,
    "editorHoverWidget.border": c.border,
    "editorSuggestWidget.background": widget,
    "editorSuggestWidget.foreground": c.foreground,
    "editorSuggestWidget.border": c.border,
    "editorSuggestWidget.selectedBackground": alpha(c.accent, dark ? 0.22 : 0.16),
    "editorSuggestWidget.selectedForeground": c.foreground,
    "editorSuggestWidget.highlightForeground": c.accent,
    "editorSuggestWidget.focusHighlightForeground": c.accent,
    "list.hoverBackground": subtle(0.06),
    "list.activeSelectionBackground": alpha(c.accent, dark ? 0.22 : 0.16),
    "list.activeSelectionForeground": c.foreground,
    "list.inactiveSelectionBackground": subtle(0.08),
    "list.highlightForeground": c.accent,
    "list.focusOutline": alpha(c.accent, 0.6),
    "input.background": c.field,
    "input.foreground": c.foreground,
    "input.border": c.border,
    "input.placeholderForeground": c.muted,
    "inputOption.activeBorder": c.accent,
    "inputOption.activeBackground": alpha(c.accent, 0.2),
    focusBorder: alpha(c.accent, 0.6),
    "widget.shadow": dark ? "#00000066" : "#00000020",
    "scrollbar.shadow": TRANSPARENT,
    "scrollbarSlider.background": subtle(dark ? 0.08 : 0.07),
    "scrollbarSlider.hoverBackground": subtle(dark ? 0.15 : 0.13),
    "scrollbarSlider.activeBackground": subtle(dark ? 0.21 : 0.19),
    "diffEditor.insertedTextBackground": alpha(c.success, dark ? 0.18 : 0.16),
    "diffEditor.removedTextBackground": alpha(c.danger, dark ? 0.18 : 0.14),
    "diffEditor.insertedLineBackground": alpha(c.success, dark ? 0.08 : 0.07),
    "diffEditor.removedLineBackground": alpha(c.danger, dark ? 0.08 : 0.06),
    "diffEditor.diagonalFill": alpha(c.border, 0.8),
    "diffEditorGutter.insertedLineBackground": alpha(c.success, 0.16),
    "diffEditorGutter.removedLineBackground": alpha(c.danger, 0.16),
    "peekView.border": c.accent,
    "peekViewEditor.background": editorBg,
    "peekViewResult.background": widget,
    "peekViewTitle.background": widget,
    "minimap.background": TRANSPARENT,
  };

  // A grey accent means a monochrome theme: syntax reads through weight and
  // grey steps instead of hues.
  const ink = (share: number) => token(mixHex(c.foreground, editorBg, share));
  const fg = token(c.foreground);
  const greyscaleRules = (): MonacoTokenRule[] => [
    { token: "comment", foreground: token(c.muted), fontStyle: "italic" },
    { token: "keyword", foreground: fg, fontStyle: "bold" },
    { token: "storage", foreground: fg, fontStyle: "bold" },
    { token: "string", foreground: ink(0.72) },
    { token: "string.escape", foreground: fg },
    { token: "regexp", foreground: ink(0.72) },
    { token: "number", foreground: fg },
    { token: "constant", foreground: fg },
    { token: "type", foreground: fg },
    { token: "type.identifier", foreground: fg },
    { token: "tag", foreground: fg, fontStyle: "bold" },
    { token: "attribute.name", foreground: ink(0.85) },
    { token: "attribute.value", foreground: ink(0.72) },
    { token: "annotation", foreground: token(c.muted) },
    { token: "delimiter", foreground: ink(0.7) },
    { token: "operator", foreground: ink(0.8) },
  ];
  const colouredRules = (): MonacoTokenRule[] => [
    { token: "comment", foreground: token(c.muted), fontStyle: "italic" },
    { token: "keyword", foreground: token(c.accent) },
    { token: "storage", foreground: token(c.accent) },
    { token: "string", foreground: token(ansi.green) },
    { token: "string.escape", foreground: token(ansi.cyan) },
    { token: "regexp", foreground: token(ansi.red) },
    { token: "number", foreground: token(ansi.yellow) },
    { token: "constant", foreground: token(ansi.yellow) },
    { token: "type", foreground: token(ansi.cyan) },
    { token: "type.identifier", foreground: token(ansi.cyan) },
    { token: "tag", foreground: token(ansi.red) },
    { token: "attribute.name", foreground: token(ansi.yellow) },
    { token: "attribute.value", foreground: token(ansi.green) },
    { token: "annotation", foreground: token(ansi.magenta) },
    { token: "delimiter", foreground: token(mixHex(c.foreground, editorBg, 0.7)) },
    { token: "operator", foreground: token(mixHex(c.foreground, editorBg, 0.8)) },
  ];

  const grey = isGreyAccent(c.accent);
  if (grey) {
    // Monaco colourises bracket pairs by default; keep them in grey steps.
    const brackets = [c.foreground, mixHex(c.foreground, editorBg, 0.7)];
    for (let level = 1; level <= 6; level++) {
      colors[`editorBracketHighlight.foreground${level}`] = brackets[(level - 1) % 2]!;
    }
    colors["editorBracketHighlight.unexpectedBracket.foreground"] = c.danger;
  }

  // Greyscale drops the base theme's rules (coloured JSON keys, variables,
  // YAML keys, SQL, ...) so unlisted tokens fall back to editor.foreground.
  return {
    base: dark ? "vs-dark" : "vs",
    inherit: !grey,
    rules: grey ? greyscaleRules() : colouredRules(),
    colors,
  };
}
