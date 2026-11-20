import { describe, expect, it } from "vitest";
import { contrastRatio } from "@/renderer/theme/colorMath";
import {
  HOSTILE_BINARY_ANSI,
  VISCOSITY_ANSI,
  VISCOSITY_MONO_ANSI,
  buildTerminalPalette,
  deriveAnsiColors,
  parseCssRgb,
  withAlpha,
  type TerminalAnsiColors,
} from "./terminalPalette";

const ANSI_KEYS: (keyof TerminalAnsiColors)[] = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "brightBlack",
  "brightRed",
  "brightGreen",
  "brightYellow",
  "brightBlue",
  "brightMagenta",
  "brightCyan",
  "brightWhite",
];
const HEX = /^#[0-9a-f]{6}$/;
const RGBA = /^rgba\(\d{1,3}, \d{1,3}, \d{1,3}, [\d.]+\)$/;

describe("terminal palette", () => {
  it("uses the curated monochrome ANSI sets for the base theme", () => {
    for (const appearance of ["dark", "light"] as const) {
      const content = appearance === "dark" ? "#0a0a0a" : "#ffffff";
      const palette = buildTerminalPalette({
        appearance,
        presetId: "default",
        background: content,
        foreground: appearance === "dark" ? "#ededed" : "#0a0a0a",
        accent: appearance === "dark" ? "#ffffff" : "#0a0a0a",
      });
      expect(palette).toMatchObject(VISCOSITY_MONO_ANSI[appearance]);
      // CLI agents colour errors/diffs with these hues; keep them readable.
      const hues = ANSI_KEYS.filter((key) => !/black|white/i.test(key));
      expect(hues.filter((key) => contrastRatio(palette[key], content) < 4.5)).toEqual([]);
    }
  });

  it("keeps the original curated ANSI sets for Viscosity Blue", () => {
    for (const appearance of ["dark", "light"] as const) {
      const palette = buildTerminalPalette({
        appearance,
        presetId: "viscosity-blue",
        background: appearance === "dark" ? "#0e0e10" : "#fafafa",
        foreground: appearance === "dark" ? "#e6e6e8" : "#18181b",
        accent: appearance === "dark" ? "#38bdf8" : "#0279bb",
      });
      expect(palette).toMatchObject(VISCOSITY_ANSI[appearance]);
    }
  });

  it("uses one readable dark ANSI set for Hostile Binary, even in light appearance", () => {
    for (const appearance of ["dark", "light"] as const) {
      const content = "#050303";
      const palette = buildTerminalPalette({
        appearance,
        presetId: "hostile-binary",
        background: content,
        foreground: "#f3ebe6",
        accent: "#ff3344",
      });
      expect(palette).toMatchObject(HOSTILE_BINARY_ANSI);
      expect(palette.selectionBackground).toBe(
        buildTerminalPalette({
          appearance: "dark",
          presetId: "hostile-binary",
          background: content,
          foreground: "#f3ebe6",
          accent: "#ff3344",
        }).selectionBackground,
      );
      const hues = ANSI_KEYS.filter((key) => !/black|white/i.test(key));
      expect(hues.filter((key) => contrastRatio(palette[key], content) < 4.5)).toEqual([]);
    }
  });

  it("derives a full 16-colour xterm-safe set for other presets", () => {
    const palette = buildTerminalPalette({
      appearance: "dark",
      presetId: "gruvbox",
      background: "#282828",
      foreground: "#f0e5c7",
      accent: "#fe8019",
    });
    expect(ANSI_KEYS.filter((key) => !HEX.test(palette[key]))).toEqual([]);
    expect(palette).not.toMatchObject(VISCOSITY_ANSI.dark);
    expect(palette).not.toMatchObject(VISCOSITY_MONO_ANSI.dark);
    expect(palette.cursorAccent).toBe("#282828");
    expect(palette.selectionBackground).toBe("rgba(254, 128, 25, 0.3)");
    expect(palette.selectionInactiveBackground).toMatch(RGBA);
  });

  it("keeps derived neutrals ordered between background and foreground", () => {
    const dark = deriveAnsiColors("dark", "#1a1b26", "#cdd5f7");
    const bg = "#1a1b26";
    // black separates from the panel; white/brightWhite read as text.
    expect(contrastRatio(dark.black, bg)).toBeGreaterThan(1.1);
    expect(contrastRatio(dark.brightBlack, bg)).toBeGreaterThan(contrastRatio(dark.black, bg));
    expect(contrastRatio(dark.white, bg)).toBeGreaterThan(contrastRatio(dark.brightBlack, bg));
    expect(dark.brightWhite).toBe("#cdd5f7");

    const light = deriveAnsiColors("light", "#ffffff", "#1f2328");
    // On light panels "white" must still be visible text, and black is near fg.
    expect(contrastRatio(light.white, "#ffffff")).toBeGreaterThan(3);
    expect(contrastRatio(light.black, "#ffffff")).toBeGreaterThan(10);
  });

  it("keeps hue identity under a non-blue accent and leans toward the foreground", () => {
    const colors = deriveAnsiColors("dark", "#282828", "#f0e5c7");
    const [r, g, b] = parseCssRgb(colors.red)!;
    expect(r).toBeGreaterThan(g);
    expect(r).toBeGreaterThan(b);
    const [br, bg, bb] = parseCssRgb(colors.blue)!;
    expect(bb).toBeGreaterThan(br);
    expect(bb).toBeGreaterThan(bg);
    // Blended toward the warm foreground, so not the raw canonical hue.
    expect(colors.red).not.toBe("#f87171");
  });

  it("accepts the resolver's rgb()/rgba() output and falls back on garbage", () => {
    expect(parseCssRgb("rgba(10, 20, 30, 0.5)")).toEqual([10, 20, 30]);
    expect(parseCssRgb("rgb(10 20 30)")).toEqual([10, 20, 30]);
    expect(parseCssRgb("#abc")).toEqual([170, 187, 204]);
    expect(parseCssRgb("#11223344")).toEqual([17, 34, 51]);
    expect(parseCssRgb("oklch(0.5 0.1 200)")).toBeNull();
    expect(withAlpha("not a colour", 0.3)).toBeNull();

    const palette = buildTerminalPalette({
      appearance: "light",
      presetId: "github",
      background: "",
      foreground: "var(--missing)",
      accent: "",
    });
    expect(ANSI_KEYS.filter((key) => !HEX.test(palette[key]))).toEqual([]);
    expect(palette.cursorAccent).toBe("#fafafa");
    expect(palette.selectionBackground).toBe("rgba(29, 76, 137, 0.16)");
  });
});
