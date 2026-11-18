import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deriveSecondAccent,
  FALLBACK_THEME_COLORS,
  hslToRgb,
  parseCssColor,
  readThemeColors,
  resolveCssColor,
  rgba,
  rgbToHsl,
  SECOND_ACCENT_HUE_SHIFT,
  themeKey,
} from "./themeColors";

/** Element-wise `toBeCloseTo` matcher for colour triples. */
function closeTo(expected: readonly number[], digits = 3) {
  return expected.map((value) => expect.closeTo(value, digits));
}

describe("parseCssColor", () => {
  it("parses hex in 3, 4, 6 and 8 digit forms", () => {
    expect(parseCssColor("#0af")).toEqual({ rgb: [0, 170, 255], alpha: 1 });
    expect(parseCssColor("#38BDF8")).toEqual({ rgb: [56, 189, 248], alpha: 1 });
    expect(parseCssColor("#00000080")?.alpha).toBeCloseTo(128 / 255);
    expect(parseCssColor("#fff8")?.alpha).toBeCloseTo(136 / 255);
  });

  it("parses legacy and modern rgb()/rgba() syntax", () => {
    expect(parseCssColor("rgb(10, 20, 30)")).toEqual({ rgb: [10, 20, 30], alpha: 1 });
    expect(parseCssColor("rgba(10, 20, 30, 0.5)")).toEqual({ rgb: [10, 20, 30], alpha: 0.5 });
    expect(parseCssColor("rgb(10 20 30 / 25%)")).toEqual({ rgb: [10, 20, 30], alpha: 0.25 });
    expect(parseCssColor("rgb(100% 0% 50%)")).toEqual({ rgb: [255, 0, 127.5], alpha: 1 });
  });

  it("rejects colours it cannot read directly", () => {
    expect(parseCssColor("oklch(0.7 0.1 200)")).toBeNull();
    expect(parseCssColor("color-mix(in oklab, red 50%, blue)")).toBeNull();
    expect(parseCssColor("")).toBeNull();
    expect(parseCssColor("rgb(1, 2)")).toBeNull();
  });
});

describe("resolveCssColor", () => {
  it("uses the canvas resolver only for modern colour syntax", () => {
    const resolve = vi.fn<(value: string) => string | null>((value: string) =>
      value.startsWith("oklch") ? "#102030" : null,
    );
    expect(resolveCssColor("#abcdef", resolve)).toEqual({ rgb: [171, 205, 239], alpha: 1 });
    expect(resolve).not.toHaveBeenCalled();
    expect(resolveCssColor(" oklch(0.2 0.02 250) ", resolve)).toEqual({
      rgb: [16, 32, 48],
      alpha: 1,
    });
    expect(resolveCssColor("nonsense", resolve)).toBeNull();
    expect(resolveCssColor("   ", resolve)).toBeNull();
  });
});

describe("hue maths", () => {
  it("round-trips RGB through HSL", () => {
    for (const color of [
      [56 / 255, 189 / 255, 248 / 255],
      [1, 0, 0],
      [0.2, 0.6, 0.3],
      [0.5, 0.5, 0.5],
    ] as const) {
      expect(hslToRgb(rgbToHsl(color))).toEqual(closeTo(color));
    }
  });

  it("derives the second accent by shifting the hue and keeping S and L", () => {
    const accent = [56 / 255, 189 / 255, 248 / 255] as const;
    const [h, s, l] = rgbToHsl(accent);
    const [h2, s2, l2] = rgbToHsl(deriveSecondAccent(accent));
    expect((h2 - h + 360) % 360).toBeCloseTo(SECOND_ACCENT_HUE_SHIFT, 1);
    expect(s2).toBeCloseTo(s, 3);
    expect(l2).toBeCloseTo(l, 3);
    // A grey accent stays grey.
    expect(deriveSecondAccent([0.4, 0.4, 0.4])).toEqual(closeTo([0.4, 0.4, 0.4]));
  });

  it("formats rgba() strings for the 2D fallback", () => {
    expect(rgba([1, 0.5, 0], 0.25)).toBe("rgba(255, 128, 0, 0.25)");
    expect(rgba([2, -1, 0.5], 3)).toBe("rgba(255, 0, 128, 1)");
  });
});

describe("readThemeColors", () => {
  const root = document.documentElement;

  afterEach(() => {
    root.className = "";
    root.removeAttribute("data-theme");
    root.removeAttribute("data-theme-preset");
    for (const name of ["--background", "--vc-accent", "--accent", "--vc-surface", "--surface"]) {
      root.style.removeProperty(name);
    }
  });

  it("reads the theme variables and derives the second accent", () => {
    root.classList.add("dark");
    root.style.setProperty("--background", "#0a0a0b");
    root.style.setProperty("--vc-accent", "rgb(56, 189, 248)");
    root.style.setProperty("--vc-surface", "#111113");
    const colors = readThemeColors(root, () => null);
    expect(colors.background).toEqual(closeTo([10 / 255, 10 / 255, 11 / 255]));
    expect(colors.accent).toEqual(closeTo([56 / 255, 189 / 255, 248 / 255]));
    expect(colors.surface).toEqual(closeTo([17 / 255, 17 / 255, 19 / 255]));
    expect(colors.accent2).toEqual(closeTo(deriveSecondAccent(colors.accent)));
    expect(colors.isDark).toBe(true);
  });

  it("resolves modern colour syntax through the resolver and detects light themes", () => {
    root.classList.add("light");
    root.style.setProperty("--background", "oklch(0.97 0 0)");
    root.style.setProperty("--accent", "color-mix(in oklab, blue 50%, white)");
    const resolve = (value: string) =>
      value.startsWith("oklch") ? "#f4f4f5" : value.startsWith("color-mix") ? "#8080ff" : null;
    const colors = readThemeColors(root, resolve);
    expect(colors.background).toEqual(closeTo([244 / 255, 244 / 255, 245 / 255]));
    expect(colors.accent).toEqual(closeTo([128 / 255, 128 / 255, 1]));
    expect(colors.isDark).toBe(false);
    // No surface variable: the light fallback surface is used.
    expect(colors.surface).toEqual(closeTo(FALLBACK_THEME_COLORS.light.surface));
  });

  it("composites a translucent accent over the background", () => {
    root.classList.add("dark");
    root.style.setProperty("--background", "#000000");
    root.style.setProperty("--vc-accent", "rgba(255, 255, 255, 0.5)");
    const colors = readThemeColors(root, () => null);
    expect(colors.accent).toEqual(closeTo([0.5, 0.5, 0.5]));
  });

  it("falls back to the base palette for the current appearance", () => {
    root.classList.add("light");
    expect(readThemeColors(root, () => null)).toEqual(FALLBACK_THEME_COLORS.light);
    root.className = "dark";
    expect(readThemeColors(root, () => null)).toEqual(FALLBACK_THEME_COLORS.dark);
  });
});

describe("themeKey", () => {
  it("changes with the theme but not with unrelated inline variables", () => {
    const root = document.createElement("div");
    root.className = "dark";
    root.setAttribute("data-theme", "dark");
    root.setAttribute("data-theme-preset", "default");
    const base = themeKey(root);
    root.style.setProperty("--vc-panel-alpha", "0.8");
    expect(themeKey(root)).toBe(base);
    root.style.setProperty("--accent", "#ff0000");
    expect(themeKey(root)).not.toBe(base);
    const withAccent = themeKey(root);
    root.setAttribute("data-theme-preset", "nord");
    expect(themeKey(root)).not.toBe(withAccent);
  });
});
