import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { contrastRatio } from "@/renderer/theme/colorMath";
import {
  APP_THEME_OPTIONS,
  DEFAULT_THEME_ID,
  THEME_SPECS,
  VISCOSITY_SHOWCASE_THEME_ID,
  getThemePreset,
} from "@/renderer/theme/themePresets";
import { buildVariant, MANAGED_THEME_VARS } from "@/renderer/theme/themeTokens";

const tokensCss = readFileSync(
  join(process.cwd(), "src/renderer/theme/viscosity/tokens.css"),
  "utf8",
);

/** Declarations of the first rule whose selector list matches `selector` exactly. */
function baseBlock(selector: string): Record<string, string> {
  const layer = tokensCss.slice(tokensCss.indexOf("@layer base"));
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s*");
  const match = layer.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`));
  if (!match?.[1]) throw new Error(`Missing Viscosity base block for ${selector}`);
  const vars: Record<string, string> = {};
  for (const declaration of match[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    vars[declaration[1]!] = declaration[2]!.trim();
  }
  return vars;
}

const CSS_BLOCKS = {
  dark: baseBlock('.dark,\n  [data-theme="dark"]'),
  light: baseBlock('.light,\n  [data-theme="light"]'),
} as const;

// Hand-tuned in tokens.css for a Cursor-like hierarchy (see its header); every
// other managed variable must equal what the preset derivation produces.
const HAND_TUNED = new Set([
  "--muted",
  "--scrollbar",
  "--field-placeholder",
  "--segment",
  "--sidebar-row-active",
]);
// Base-cascade defaults styles.css already derives from the variables above.
const INHERITED_FROM_BASE = new Set([
  "--sidebar-panel-background",
  "--sidebar-row-active-override",
]);

describe("Viscosity base palette", () => {
  it.each(["dark", "light"] as const)(
    "mirrors the default preset anchors in the %s CSS base block",
    (mode) => {
      const spec = THEME_SPECS.find((entry) => entry.id === DEFAULT_THEME_ID)![mode];
      const derived = buildVariant(spec, mode);
      const css = CSS_BLOCKS[mode];
      const mismatches: string[] = [];
      for (const key of MANAGED_THEME_VARS) {
        if (HAND_TUNED.has(key) || INHERITED_FROM_BASE.has(key)) continue;
        if (css[key] !== derived[key]) {
          mismatches.push(`${key}: css=${css[key]} preset=${derived[key]}`);
        }
      }
      expect(mismatches).toEqual([]);
      expect(css["--composer-surface"]).toBe(spec.composer);
    },
  );

  it.each(["dark", "light"] as const)(
    "keeps hand-tuned %s secondary text readable and clearly dimmer than the foreground",
    (mode) => {
      const spec = THEME_SPECS.find((entry) => entry.id === DEFAULT_THEME_ID)![mode];
      const muted = CSS_BLOCKS[mode]["--muted"]!;
      for (const background of [spec.bg, spec.content!, spec.surface, spec.sidebar!]) {
        expect(contrastRatio(muted, background)).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrastRatio(spec.fg, muted)).toBeGreaterThanOrEqual(1.9);
    },
  );

  it("uses the Cursor-inspired anchors with a single sky accent", () => {
    const viscosity = THEME_SPECS[0]!;
    expect(viscosity).toMatchObject({
      id: DEFAULT_THEME_ID,
      label: "Viscosity",
      dark: {
        bg: "#0a0a0b",
        surface: "#111113",
        fg: "#e6e6e8",
        accent: "#38bdf8",
        accentFg: "#04121c",
        border: "#1f1f23",
        sidebar: "#0d0d0f",
        content: "#0e0e10",
        composer: "#141417",
      },
      light: {
        bg: "#f4f4f5",
        surface: "#ffffff",
        fg: "#18181b",
        accentFg: "#ffffff",
        border: "#e3e3e8",
        sidebar: "#efeff1",
        content: "#fafafa",
        composer: "#ffffff",
      },
    });
    // Light accent keeps sky-600's hue but clears WCAG AA under white labels.
    expect(contrastRatio(viscosity.light.accentFg, viscosity.light.accent)).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(contrastRatio(viscosity.dark.accentFg, viscosity.dark.accent)).toBeGreaterThanOrEqual(
      4.5,
    );
  });

  it("orders Viscosity, Viscosity Showcase, then Graphite and the editor themes", () => {
    expect(APP_THEME_OPTIONS.slice(0, 3)).toEqual([
      { id: DEFAULT_THEME_ID, label: "Viscosity" },
      { id: VISCOSITY_SHOWCASE_THEME_ID, label: "Viscosity Showcase" },
      { id: "poracode-legacy", label: "Graphite" },
    ]);
    // The persisted pre-rebrand id still resolves to the relabelled preset.
    expect(getThemePreset("lightcode-legacy").label).toBe("Graphite");
  });

  it("never shows the upstream product name in a preset label", () => {
    for (const option of APP_THEME_OPTIONS) {
      expect(option.label).not.toMatch(/poracode|lightcode/i);
    }
  });

  it("ships the bold showcase palette", () => {
    expect(getThemePreset(VISCOSITY_SHOWCASE_THEME_ID).dark).toMatchObject({
      "--background": "#07050f",
      "--surface": "#100b1e",
      "--foreground": "#f3f0ff",
      "--accent": "#c084fc",
      "--accent-foreground": "#12051f",
      "--border": "#2a1f45",
      "--sidebar-background": "#0b0716",
      "--content-background": "#0c0818",
    });
    expect(getThemePreset(VISCOSITY_SHOWCASE_THEME_ID).light).toMatchObject({
      "--background": "#f7f4ff",
      "--surface": "#ffffff",
      "--foreground": "#1d1533",
      "--accent": "#7c3aed",
      "--accent-foreground": "#ffffff",
      "--border": "#ddd3f5",
      "--sidebar-background": "#f0ebff",
      "--content-background": "#fbf9ff",
    });
  });

  it("scopes the quieter row washes to the Viscosity base theme", () => {
    expect(
      baseBlock(
        '.dark[data-theme-preset="default"],\n  [data-theme="dark"][data-theme-preset="default"]',
      ),
    ).toEqual({
      "--row-hover": "color-mix(in oklab, var(--foreground) 5%, transparent)",
      "--row-active": "color-mix(in oklab, var(--foreground) 10%, transparent)",
    });
    // Shell geometry stays upstream's in the compact phone layout.
    expect(baseBlock(":root:not([data-compact-layout])")).toEqual({
      "--field-radius": "0.375rem",
    });
  });
});
