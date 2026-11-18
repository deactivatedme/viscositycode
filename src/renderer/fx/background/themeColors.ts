/**
 * ViscosityCode: the four theme colours the background shaders read.
 *
 * Values come from the live CSS custom properties on <html>, so built-in,
 * Viscosity and custom themes all drive the background. Theme variables are
 * authored in modern syntax (`oklch()`, `color-mix()`), so they are resolved
 * to sRGB with the same canvas-based resolver xterm uses
 * (`resolveTerminalColor`); plain hex / rgb() values skip the canvas.
 */
import { resolveTerminalColor } from "@/renderer/components/terminal/terminalColors";

/** 0..1 sRGB triple, ready for a `vec3` uniform. */
export type Rgb01 = readonly [number, number, number];

export interface BackgroundThemeColors {
  /** Page background (`--background`): the base the effect is painted on. */
  background: Rgb01;
  /** Primary accent (`--vc-accent`). */
  accent: Rgb01;
  /** Second accent, derived from the accent's hue. */
  accent2: Rgb01;
  /** Raised surface (`--vc-surface`). */
  surface: Rgb01;
  isDark: boolean;
}

export interface ParsedCssColor {
  /** 0..255 channels. */
  rgb: [number, number, number];
  /** 0..1 */
  alpha: number;
}

/** Hue shift (degrees) from the accent to the second accent: an analogous partner. */
export const SECOND_ACCENT_HUE_SHIFT = 40;

const HEX_RE = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB_RE = /^rgba?\(([^)]*)\)$/i;

function channel(token: string | undefined, scale: number): number | null {
  if (token === undefined) return null;
  const trimmed = token.trim();
  if (!trimmed) return null;
  const value = trimmed.endsWith("%")
    ? (Number.parseFloat(trimmed) / 100) * scale
    : Number.parseFloat(trimmed);
  return Number.isFinite(value) ? value : null;
}

/**
 * Parse a `#hex` / `rgb()` / `rgba()` colour (legacy comma or modern space
 * syntax) into 0..255 channels and a 0..1 alpha. Anything else returns null.
 */
export function parseCssColor(value: string): ParsedCssColor | null {
  const text = value.trim();
  const hex = text.match(HEX_RE);
  if (hex) {
    let digits = hex[1] ?? "";
    if (digits.length <= 4) {
      digits = digits
        .split("")
        .map((c) => c + c)
        .join("");
    }
    const n = (i: number) => Number.parseInt(digits.slice(i, i + 2), 16);
    return { rgb: [n(0), n(2), n(4)], alpha: digits.length === 8 ? n(6) / 255 : 1 };
  }
  const rgb = text.match(RGB_RE);
  if (!rgb) return null;
  const [colorPart = "", alphaPart] = (rgb[1] ?? "").split("/");
  const tokens = colorPart.includes(",") ? colorPart.split(",") : colorPart.trim().split(/\s+/);
  const r = channel(tokens[0], 255);
  const g = channel(tokens[1], 255);
  const b = channel(tokens[2], 255);
  if (r === null || g === null || b === null) return null;
  const alpha = channel(alphaPart ?? tokens[3], 1) ?? 1;
  const clamp255 = (v: number) => Math.min(255, Math.max(0, v));
  return {
    rgb: [clamp255(r), clamp255(g), clamp255(b)],
    alpha: Math.min(1, Math.max(0, alpha)),
  };
}

/** Resolve any CSS colour string to 0..255 channels, or null when unparseable. */
export function resolveCssColor(
  value: string,
  resolve: (value: string) => string | null = resolveTerminalColor,
): ParsedCssColor | null {
  const text = value.trim();
  if (!text) return null;
  const direct = parseCssColor(text);
  if (direct) return direct;
  const resolved = resolve(text);
  return resolved ? parseCssColor(resolved) : null;
}

/** 0..1 channels; a translucent colour is composited over `over`. */
function to01(color: ParsedCssColor, over: Rgb01): Rgb01 {
  const [r, g, b] = color.rgb;
  const a = color.alpha;
  return [
    (r / 255) * a + over[0] * (1 - a),
    (g / 255) * a + over[1] * (1 - a),
    (b / 255) * a + over[2] * (1 - a),
  ];
}

export function rgbToHsl([r, g, b]: Rgb01): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

export function hslToRgb([h, s, l]: readonly [number, number, number]): Rgb01 {
  const hue = (((h % 360) + 360) % 360) / 360;
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const convert = (t: number) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return [convert(hue + 1 / 3), convert(hue), convert(hue - 1 / 3)];
}

/** The accent's analogous partner: same saturation and lightness, hue shifted. */
export function deriveSecondAccent(accent: Rgb01, shift = SECOND_ACCENT_HUE_SHIFT): Rgb01 {
  const [h, s, l] = rgbToHsl(accent);
  return hslToRgb([h + shift, s, l]);
}

/** WCAG relative luminance of a 0..1 sRGB colour. */
export function luminance01([r, g, b]: Rgb01): number {
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Below this background luminance the effect uses its dark-theme (additive glow) look. */
const DARK_LUMINANCE = 0.4;

const DARK_ACCENT: Rgb01 = [56 / 255, 189 / 255, 248 / 255];
const LIGHT_ACCENT: Rgb01 = [2 / 255, 121 / 255, 187 / 255];

/** Viscosity base palette (tokens.css), used when a variable is missing or unreadable. */
export const FALLBACK_THEME_COLORS: { dark: BackgroundThemeColors; light: BackgroundThemeColors } =
  {
    dark: {
      background: [10 / 255, 10 / 255, 11 / 255],
      accent: DARK_ACCENT,
      accent2: deriveSecondAccent(DARK_ACCENT),
      surface: [17 / 255, 17 / 255, 19 / 255],
      isDark: true,
    },
    light: {
      background: [244 / 255, 244 / 255, 245 / 255],
      accent: LIGHT_ACCENT,
      accent2: deriveSecondAccent(LIGHT_ACCENT),
      surface: [1, 1, 1],
      isDark: false,
    },
  };

const BACKGROUND_VARS = ["--background"] as const;
const ACCENT_VARS = ["--vc-accent", "--accent"] as const;
const SURFACE_VARS = ["--vc-surface", "--surface"] as const;

/**
 * Inline theme variables a preset or custom theme writes on <html>
 * (`applyAppTheme`). Together with the class / data-theme attributes they key
 * a cheap "did the theme change?" check that needs no style recalculation, so
 * unrelated inline-style writes on <html> (effects, panel alpha) are ignored.
 */
const THEME_KEY_VARS = ["--background", "--accent", "--surface", "--content-background"] as const;

export function themeKey(root: HTMLElement): string {
  const parts = [
    root.getAttribute("class") ?? "",
    root.getAttribute("data-theme") ?? "",
    root.getAttribute("data-theme-preset") ?? "",
  ];
  for (const name of THEME_KEY_VARS) parts.push(root.style.getPropertyValue(name));
  return parts.join("|");
}

function classAppearance(root: HTMLElement): "dark" | "light" | null {
  if (root.classList.contains("dark") || root.getAttribute("data-theme") === "dark") return "dark";
  if (root.classList.contains("light") || root.getAttribute("data-theme") === "light") {
    return "light";
  }
  return null;
}

function readFirst(
  style: CSSStyleDeclaration,
  names: readonly string[],
  resolve: (value: string) => string | null,
): ParsedCssColor | null {
  for (const name of names) {
    const parsed = resolveCssColor(style.getPropertyValue(name), resolve);
    if (parsed) return parsed;
  }
  return null;
}

/**
 * Read the shader colours from <html>'s computed custom properties. Missing or
 * unparseable values fall back to the Viscosity base palette for the current
 * light/dark class. Translucent values are composited over the background.
 */
export function readThemeColors(
  root: HTMLElement = document.documentElement,
  resolve: (value: string) => string | null = resolveTerminalColor,
): BackgroundThemeColors {
  const fallback =
    classAppearance(root) === "light" ? FALLBACK_THEME_COLORS.light : FALLBACK_THEME_COLORS.dark;
  let style: CSSStyleDeclaration;
  try {
    style = getComputedStyle(root);
  } catch {
    return fallback;
  }
  const bgParsed = readFirst(style, BACKGROUND_VARS, resolve);
  const background = bgParsed
    ? to01(bgParsed, fallback.isDark ? [0, 0, 0] : [1, 1, 1])
    : fallback.background;
  const accentParsed = readFirst(style, ACCENT_VARS, resolve);
  const accent = accentParsed ? to01(accentParsed, background) : fallback.accent;
  const surfaceParsed = readFirst(style, SURFACE_VARS, resolve);
  const surface = surfaceParsed ? to01(surfaceParsed, background) : fallback.surface;
  return {
    background,
    accent,
    accent2: deriveSecondAccent(accent),
    surface,
    isDark: bgParsed ? luminance01(background) < DARK_LUMINANCE : fallback.isDark,
  };
}

/** `rgba()` string for 2D-canvas fill styles. */
export function rgba(color: Rgb01, alpha = 1): string {
  const c = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255);
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 1000) / 1000;
  return `rgba(${c(color[0])}, ${c(color[1])}, ${c(color[2])}, ${a})`;
}

/** Linear interpolation between two colours. */
export function mixRgb(a: Rgb01, b: Rgb01, t: number): Rgb01 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
