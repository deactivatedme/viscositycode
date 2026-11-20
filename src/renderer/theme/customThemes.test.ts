// Modified for ViscosityCode (fork of Poracode). See FORK_CHANGES.md.
import { contrastRatio } from "./colorMath";
import { afterEach, describe, expect, it } from "vitest";
import { type CustomTheme } from "@/shared/customThemes";
import { DEFAULT_SELECTED_THEME_ID } from "@/shared/settings";
import { THEME_SPECS, getThemePreset } from "./themePresets";
import { buildVariant, MANAGED_THEME_VARS } from "./themeTokens";
import { applyAppTheme, bootstrapAppThemeFromCache, persistThemeBoot } from "./applyAppTheme";

const theme: CustomTheme = {
  ...THEME_SPECS[0]!,
  version: 1,
  id: "custom:sample",
  label: "Personal palette",
  dark: {
    ...THEME_SPECS[0]!.dark,
    bg: "#101010",
    composer: "#141414",
    sidebar: "#000000",
    sidebarFill: true,
    sidebarRowActive: "#1a1a1a",
  },
};
afterEach(() => {
  localStorage.clear();
  for (const key of MANAGED_THEME_VARS) document.documentElement.style.removeProperty(key);
});

describe("custom theme application", () => {
  it("resolves custom palettes and applies their explicit surface controls", () => {
    const vars = getThemePreset(theme.id, [theme]).dark;
    expect(vars["--composer-surface"]).toBe("#141414");
    expect(vars["--sidebar-panel-background"]).toBe("#000000");
    expect(vars["--sidebar-row-active"]).toBe("#1a1a1a");
    const root = document.createElement("div");
    applyAppTheme(root, "dark", theme.id, [theme]);
    expect(root.style.getPropertyValue("--background")).toBe("#101010");
    applyAppTheme(root, "light", theme.id, [theme]);
    expect(root.style.getPropertyValue("--background")).toBe(theme.light.bg);
  });
  // ViscosityCode: a missing theme falls back to the default selection, Viscosity Blue.
  it("applies the default selection when a deleted or unknown custom theme is selected", () => {
    const root = document.createElement("div");
    applyAppTheme(root, "dark", theme.id, [theme]);
    applyAppTheme(root, "dark", theme.id, []);
    const blue = getThemePreset(DEFAULT_SELECTED_THEME_ID).dark;
    for (const key of MANAGED_THEME_VARS)
      expect(root.style.getPropertyValue(key)).toBe(blue[key] ?? "");
  });
  it("applies and clears an explicit selected-row override for glass sidebars", () => {
    const root = document.createElement("div");
    applyAppTheme(root, "dark", theme.id, [theme]);
    expect(root.style.getPropertyValue("--sidebar-row-active-override")).toBe("#1a1a1a");
    applyAppTheme(root, "light", theme.id, [theme]);
    expect(root.style.getPropertyValue("--sidebar-row-active-override")).toBe("");
    applyAppTheme(root, "dark", "default");
    expect(root.style.getPropertyValue("--sidebar-row-active-override")).toBe("");
  });
  it("preserves the previous derived composer and content/sidebar relationship", () => {
    // ViscosityCode: the Viscosity base spec authors an explicit composer fill,
    // so derive from the same anchors without it to keep exercising the
    // automatic composer derivation.
    const { composer: _explicitComposer, ...derivedComposerSpec } = THEME_SPECS[0]!.dark;
    const vars = buildVariant(derivedComposerSpec, "dark");
    expect(vars["--composer-surface"]).toContain("color-mix");
    expect(vars["--sidebar-panel-background"]).toBe(THEME_SPECS[0]!.dark.content);
    // A literal wash avoids --row-active -> --sidebar-row-active -> --row-active cycles.
    expect(vars["--sidebar-row-active"]).not.toContain("var(--row-active)");
  });
  it("restores a saved theme before mount and caches its background for the next launch", () => {
    localStorage.setItem(
      "poracode-shared-settings",
      JSON.stringify({ themeMode: "dark", themePreset: theme.id, customThemes: [theme] }),
    );
    bootstrapAppThemeFromCache();
    expect(document.documentElement.style.getPropertyValue("--background")).toBe("#101010");
    persistThemeBoot("dark", theme.id, [theme]);
    expect(JSON.parse(localStorage.getItem("poracode-boot")!)).toEqual({
      appearance: "dark",
      bg: "#101010",
    });
  });
  it("boots from the previous cache shape and ignores corrupt new palettes", () => {
    localStorage.setItem(
      "poracode-shared-settings",
      JSON.stringify({ themeMode: "dark", themePreset: "github" }),
    );
    bootstrapAppThemeFromCache();
    expect(document.documentElement.style.getPropertyValue("--background")).toBe("#0d1117");
    localStorage.setItem(
      "poracode-shared-settings",
      JSON.stringify({
        themeMode: "dark",
        themePreset: theme.id,
        customThemes: [{ ...theme, dark: {} }],
      }),
    );
    bootstrapAppThemeFromCache();
    expect(document.documentElement.style.getPropertyValue("--background")).toBe(
      getThemePreset(DEFAULT_SELECTED_THEME_ID).dark["--background"],
    );
  });
  // ViscosityCode: a cache without a theme boots the default selection; "default" stays mono.
  it("boots the default selection when the cache has no theme and keeps a cached default", () => {
    bootstrapAppThemeFromCache();
    expect(document.documentElement.dataset.themePreset).toBe(DEFAULT_SELECTED_THEME_ID);
    expect(document.documentElement.style.getPropertyValue("--accent")).toBe("#38bdf8");
    for (const key of MANAGED_THEME_VARS) document.documentElement.style.removeProperty(key);
    localStorage.setItem("poracode-shared-settings", JSON.stringify({ themeMode: "dark" }));
    bootstrapAppThemeFromCache();
    expect(document.documentElement.dataset.themePreset).toBe(DEFAULT_SELECTED_THEME_ID);
    expect(document.documentElement.style.getPropertyValue("--accent")).toBe("#38bdf8");
    localStorage.setItem("poracode-shared-settings", JSON.stringify({ themePreset: "gone" }));
    bootstrapAppThemeFromCache();
    expect(document.documentElement.dataset.themePreset).toBe(DEFAULT_SELECTED_THEME_ID);
    localStorage.setItem(
      "poracode-shared-settings",
      JSON.stringify({ themeMode: "dark", themePreset: "default" }),
    );
    bootstrapAppThemeFromCache();
    expect(document.documentElement.dataset.themePreset).toBe("default");
    for (const key of MANAGED_THEME_VARS)
      expect(document.documentElement.style.getPropertyValue(key)).toBe("");
  });
});

describe("custom content readability", () => {
  it.each([
    { mode: "dark" as const, bg: "#202020", surface: "#262626", fg: "#e0e0e0", content: "#3c3c3c" },
    {
      mode: "light" as const,
      bg: "#ffffff",
      surface: "#ffffff",
      fg: "#222222",
      content: "#e4e4e4",
    },
  ])("derives muted text against the actual $mode content background", ({ mode, ...palette }) => {
    const vars = buildVariant({ ...theme[mode], ...palette }, mode);
    expect(contrastRatio(vars["--muted"]!, palette.content)).toBeGreaterThanOrEqual(4.5);
  });
});
