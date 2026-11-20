/**
 * ViscosityCode: full 16-colour ANSI palette + selection colours for xterm.
 *
 * The monochrome Viscosity base theme, Viscosity Blue and Hostile Binary ship curated light/dark
 * ANSI sets (CLI agents rely on red/green/yellow, so the mono set keeps hues at
 * low chroma rather than going grey). Every other
 * preset (built-in or custom) derives its palette from the resolved theme
 * colours: neutrals (black/white and their bright variants) are blended from
 * the terminal background and foreground, hues are canonical terminal colours
 * pulled toward the foreground so they sit in the theme's tonal range, and the
 * selection is a translucent wash of the accent. xterm's `minimumContrastRatio`
 * still guards readability on top of this.
 *
 * Inputs are the xterm-safe strings produced by `resolveTerminalColor`
 * (`#hex` or `rgb()/rgba()`); every output is `#rrggbb` or `rgba()`.
 */

import { mixHex, toHex, type Rgb } from "@/renderer/theme/colorMath";
import {
  DEFAULT_THEME_ID,
  HOSTILE_BINARY_THEME_ID,
  isDarkOnlyTheme,
  VISCOSITY_BLUE_THEME_ID,
} from "@/renderer/theme/themePresets";

export type TerminalAppearance = "light" | "dark";

export interface TerminalAnsiColors {
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

export interface TerminalPalette extends TerminalAnsiColors {
  cursorAccent: string;
  selectionBackground: string;
  selectionInactiveBackground: string;
}

export interface TerminalPaletteInput {
  appearance: TerminalAppearance;
  /** Active preset id (`<html data-theme-preset>`); curated sets key off it. */
  presetId: string;
  background: string;
  foreground: string;
  accent: string;
}

/** Curated monochrome Viscosity sets: neutral greys plus low-chroma hues. */
export const VISCOSITY_MONO_ANSI: Record<TerminalAppearance, TerminalAnsiColors> = {
  dark: {
    black: "#262626",
    red: "#e18881",
    green: "#88ca95",
    yellow: "#e1c885",
    blue: "#8dadd7",
    magenta: "#bf9dc7",
    cyan: "#90cacd",
    white: "#d4d4d4",
    brightBlack: "#737373",
    brightRed: "#fda19a",
    brightGreen: "#a1e4ae",
    brightYellow: "#fce39f",
    brightBlue: "#a6c7f1",
    brightMagenta: "#d9b6e1",
    brightCyan: "#a9e4e7",
    brightWhite: "#fafafa",
  },
  light: {
    black: "#262626",
    red: "#a43b38",
    green: "#2c6d3e",
    yellow: "#7e5d1d",
    blue: "#3f5d90",
    magenta: "#744c7d",
    cyan: "#296e79",
    white: "#737373",
    brightBlack: "#525252",
    brightRed: "#902828",
    brightGreen: "#195c2e",
    brightYellow: "#6c4c02",
    brightBlue: "#2f4c7e",
    brightMagenta: "#623b6b",
    brightCyan: "#135d68",
    brightWhite: "#a3a3a3",
  },
};

/** Curated Viscosity Blue sets: neutral greys plus Tailwind-family hues. */
export const VISCOSITY_ANSI: Record<TerminalAppearance, TerminalAnsiColors> = {
  dark: {
    black: "#27272a",
    red: "#f87171",
    green: "#4ade80",
    yellow: "#facc15",
    blue: "#60a5fa",
    magenta: "#c084fc",
    cyan: "#22d3ee",
    white: "#d4d4d8",
    brightBlack: "#71717a",
    brightRed: "#fca5a5",
    brightGreen: "#86efac",
    brightYellow: "#fde047",
    brightBlue: "#93c5fd",
    brightMagenta: "#d8b4fe",
    brightCyan: "#67e8f9",
    brightWhite: "#fafafa",
  },
  light: {
    black: "#27272a",
    red: "#dc2626",
    green: "#15803d",
    yellow: "#a16207",
    blue: "#2563eb",
    magenta: "#9333ea",
    cyan: "#0e7490",
    white: "#71717a",
    brightBlack: "#52525b",
    brightRed: "#b91c1c",
    brightGreen: "#16a34a",
    brightYellow: "#ca8a04",
    brightBlue: "#1d4ed8",
    brightMagenta: "#7e22ce",
    brightCyan: "#0891b2",
    brightWhite: "#a1a1aa",
  },
};

/**
 * Curated Hostile Binary set: hot red and amber lead, the other hues stay
 * recognisable (agents still mean "ok" with green) but run warm and dim.
 * Dark-only, like the preset.
 */
export const HOSTILE_BINARY_ANSI: TerminalAnsiColors = {
  black: "#2a1416",
  red: "#ff3344",
  green: "#8fd694",
  yellow: "#ffb020",
  blue: "#8aa4d6",
  magenta: "#e27aa8",
  cyan: "#7fc8c2",
  white: "#d9cfca",
  brightBlack: "#7a6a66",
  brightRed: "#ff6b77",
  brightGreen: "#b2e8b5",
  brightYellow: "#ffcc66",
  brightBlue: "#b0c4ea",
  brightMagenta: "#f2a6c8",
  brightCyan: "#a6e0db",
  brightWhite: "#f3ebe6",
};

type Hue = "red" | "green" | "yellow" | "blue" | "magenta" | "cyan";

/** Canonical hues tuned per appearance; derived palettes blend these. */
const BASE_HUES: Record<TerminalAppearance, Record<Hue, [string, string]>> = {
  dark: {
    red: ["#f87171", "#fca5a5"],
    green: ["#4ade80", "#86efac"],
    yellow: ["#facc15", "#fde047"],
    blue: ["#60a5fa", "#93c5fd"],
    magenta: ["#c084fc", "#d8b4fe"],
    cyan: ["#22d3ee", "#67e8f9"],
  },
  light: {
    red: ["#dc2626", "#b91c1c"],
    green: ["#15803d", "#16a34a"],
    yellow: ["#a16207", "#ca8a04"],
    blue: ["#2563eb", "#1d4ed8"],
    magenta: ["#9333ea", "#7e22ce"],
    cyan: ["#0e7490", "#0891b2"],
  },
};

/** Share of the canonical hue kept when harmonizing toward the theme foreground. */
const HUE_WEIGHT = 0.82;

const FALLBACK: Record<TerminalAppearance, { background: string; foreground: string }> = {
  dark: { background: "#0e0e10", foreground: "#e6e6e8" },
  light: { background: "#fafafa", foreground: "#18181b" },
};

/** Parse `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()` or `rgba()` into sRGB bytes. */
export function parseCssRgb(value: string): Rgb | null {
  const input = value.trim();
  const hex = input.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (hex) {
    let digits = hex[1]!;
    if (digits.length === 3) {
      digits = digits
        .split("")
        .map((c) => c + c)
        .join("");
    }
    const n = Number.parseInt(digits.slice(0, 6), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const fn = input.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  if (fn) {
    const channels = [fn[1], fn[2], fn[3]].map((part) => Number(part));
    if (channels.every((channel) => Number.isFinite(channel))) {
      return channels.map((channel) => Math.min(255, Math.max(0, channel))) as Rgb;
    }
  }
  return null;
}

/** Normalize an xterm-safe colour to opaque `#rrggbb`, or `null` if unparseable. */
export function toOpaqueHex(value: string): string | null {
  const rgb = parseCssRgb(value);
  return rgb ? toHex(rgb) : null;
}

/** `rgba()` of `color` at `alpha` (0–1), or `null` if `color` is unparseable. */
export function withAlpha(color: string, alpha: number): string | null {
  const rgb = parseCssRgb(color);
  if (!rgb) return null;
  const a = Number(Math.min(1, Math.max(0, alpha)).toFixed(3));
  return `rgba(${Math.round(rgb[0])}, ${Math.round(rgb[1])}, ${Math.round(rgb[2])}, ${a})`;
}

/**
 * Derive a 16-colour ANSI set from the theme's resolved background and
 * foreground. Neutrals are fg→bg blends (so "black" is visible on dark panels
 * and "white" stays readable on light ones); hues keep their identity (red is
 * still red under an orange accent) but lean toward the foreground.
 */
export function deriveAnsiColors(
  appearance: TerminalAppearance,
  background: string,
  foreground: string,
): TerminalAnsiColors {
  const bg = toOpaqueHex(background) ?? FALLBACK[appearance].background;
  const fg = toOpaqueHex(foreground) ?? FALLBACK[appearance].foreground;
  const hues = BASE_HUES[appearance];
  const hue = (name: Hue, bright: boolean) => mixHex(hues[name][bright ? 1 : 0], fg, HUE_WEIGHT);
  const neutrals =
    appearance === "dark"
      ? {
          black: mixHex(fg, bg, 0.16),
          brightBlack: mixHex(fg, bg, 0.5),
          white: mixHex(fg, bg, 0.82),
          brightWhite: fg,
        }
      : {
          black: mixHex(fg, bg, 0.92),
          brightBlack: mixHex(fg, bg, 0.7),
          white: mixHex(fg, bg, 0.55),
          brightWhite: mixHex(fg, bg, 0.4),
        };
  return {
    black: neutrals.black,
    red: hue("red", false),
    green: hue("green", false),
    yellow: hue("yellow", false),
    blue: hue("blue", false),
    magenta: hue("magenta", false),
    cyan: hue("cyan", false),
    white: neutrals.white,
    brightBlack: neutrals.brightBlack,
    brightRed: hue("red", true),
    brightGreen: hue("green", true),
    brightYellow: hue("yellow", true),
    brightBlue: hue("blue", true),
    brightMagenta: hue("magenta", true),
    brightCyan: hue("cyan", true),
    brightWhite: neutrals.brightWhite,
  };
}

/** The ANSI set for a preset: curated for the Viscosity presets, derived for the rest. */
export function resolveAnsiColors(input: TerminalPaletteInput): TerminalAnsiColors {
  if (input.presetId === DEFAULT_THEME_ID) return VISCOSITY_MONO_ANSI[input.appearance];
  if (input.presetId === VISCOSITY_BLUE_THEME_ID) return VISCOSITY_ANSI[input.appearance];
  if (input.presetId === HOSTILE_BINARY_THEME_ID) return HOSTILE_BINARY_ANSI;
  return deriveAnsiColors(input.appearance, input.background, input.foreground);
}

/** Full xterm palette: ANSI colours, cursor accent and theme-derived selection. */
export function buildTerminalPalette(input: TerminalPaletteInput): TerminalPalette {
  // A dark-only preset is shown dark even when the caller's appearance is light.
  const appearance = isDarkOnlyTheme(input.presetId) ? "dark" : input.appearance;
  const background = toOpaqueHex(input.background) ?? FALLBACK[appearance].background;
  const foreground = toOpaqueHex(input.foreground) ?? FALLBACK[appearance].foreground;
  const selectionAlpha = appearance === "dark" ? 0.3 : 0.22;
  const fallbackSelection =
    appearance === "dark" ? "rgba(148, 191, 255, 0.24)" : "rgba(29, 76, 137, 0.16)";
  return {
    ...resolveAnsiColors(input),
    cursorAccent: background,
    selectionBackground: withAlpha(input.accent, selectionAlpha) ?? fallbackSelection,
    selectionInactiveBackground:
      withAlpha(foreground, appearance === "dark" ? 0.14 : 0.1) ?? fallbackSelection,
  };
}
