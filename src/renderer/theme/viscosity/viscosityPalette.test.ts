import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import githubDarkDefault from "@shikijs/themes/github-dark-default";
import githubLightDefault from "@shikijs/themes/github-light-default";
import { describe, expect, it } from "vitest";
import { contrastRatio } from "@/renderer/theme/colorMath";
import {
  APP_THEME_OPTIONS,
  DEFAULT_THEME_ID,
  THEME_SPECS,
  VISCOSITY_BLUE_THEME_ID,
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

const DEFAULT_SCOPED = {
  dark: '.dark[data-theme-preset="default"],\n  [data-theme="dark"][data-theme-preset="default"]',
  light:
    '.light[data-theme-preset="default"],\n  [data-theme="light"][data-theme-preset="default"]',
} as const;

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

// The base theme's tokens.css values before it went monochrome (pre-upgrade
// regression for Viscosity Blue).
const RELEASED_BASE: Record<"dark" | "light", Record<string, string>> = {
  dark: {
    "--background": "#0a0a0b",
    "--foreground": "#e6e6e8",
    "--surface": "#111113",
    "--surface-secondary": "color-mix(in oklab, #111113 92%, #e6e6e8 8%)",
    "--surface-tertiary": "color-mix(in oklab, #111113 85%, #e6e6e8 15%)",
    "--overlay": "color-mix(in oklab, #111113 98%, #e6e6e8 2%)",
    "--muted": "#8a8a93",
    "--scrollbar": "color-mix(in oklab, #8a8a93 45%, transparent)",
    "--default": "color-mix(in oklab, #111113 86%, #e6e6e8 14%)",
    "--accent": "#38bdf8",
    "--accent-foreground": "#04121c",
    "--field-background": "color-mix(in oklab, #111113 95%, #e6e6e8 5%)",
    "--field-foreground": "#e6e6e8",
    "--field-placeholder": "#6e6e76",
    "--field-border": "color-mix(in oklab, #1f1f23 70%, transparent)",
    "--segment": "color-mix(in oklab, #111113 78%, #e6e6e8 22%)",
    "--border": "#1f1f23",
    "--separator": "color-mix(in oklab, #1f1f23 75%, transparent)",
    "--sidebar-row-active": "color-mix(in oklab, var(--foreground) 10%, transparent)",
    "--sidebar-background": "#0d0d0f",
    "--content-background": "#0e0e10",
    "--composer-surface": "#141417",
  },
  light: {
    "--background": "#f4f4f5",
    "--foreground": "#18181b",
    "--surface": "#ffffff",
    "--surface-secondary": "color-mix(in oklab, #ffffff 92%, #18181b 8%)",
    "--surface-tertiary": "color-mix(in oklab, #ffffff 85%, #18181b 15%)",
    "--overlay": "color-mix(in oklab, #ffffff 93%, #18181b 7%)",
    "--muted": "#6b6b73",
    "--scrollbar": "color-mix(in oklab, #6b6b73 45%, transparent)",
    "--default": "color-mix(in oklab, #ffffff 82%, #18181b 18%)",
    "--accent": "#0279bb",
    "--accent-foreground": "#ffffff",
    "--field-background": "color-mix(in oklab, #ffffff 95%, #18181b 5%)",
    "--field-foreground": "#18181b",
    "--field-placeholder": "#84848b",
    "--field-border": "color-mix(in oklab, #e3e3e8 70%, transparent)",
    "--segment": "#ffffff",
    "--border": "#e3e3e8",
    "--separator": "color-mix(in oklab, #e3e3e8 75%, transparent)",
    "--sidebar-row-active": "color-mix(in oklab, var(--foreground) 9%, transparent)",
    "--sidebar-background": "#efeff1",
    "--content-background": "#fafafa",
    "--composer-surface": "#ffffff",
  },
};

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

  it("uses monochrome anchors with an achromatic accent", () => {
    const viscosity = THEME_SPECS[0]!;
    expect(viscosity).toMatchObject({
      id: DEFAULT_THEME_ID,
      label: "Viscosity",
      dark: {
        bg: "#000000",
        surface: "#111111",
        fg: "#ededed",
        accent: "#ffffff",
        accentFg: "#000000",
        border: "#262626",
        sidebar: "#000000",
        content: "#0a0a0a",
        composer: "#141414",
      },
      light: {
        bg: "#fafafa",
        surface: "#ffffff",
        fg: "#0a0a0a",
        accent: "#0a0a0a",
        accentFg: "#ffffff",
        border: "#e5e5e5",
        sidebar: "#f5f5f5",
        content: "#ffffff",
        composer: "#ffffff",
      },
    });
    for (const mode of ["dark", "light"] as const) {
      const { accent, accentFg } = viscosity[mode];
      expect(contrastRatio(accentFg, accent)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps the released sky-accent palette selectable as Viscosity Blue", () => {
    // Pre-upgrade regression: these are the anchors the base theme shipped with.
    const blue = THEME_SPECS.find((entry) => entry.id === VISCOSITY_BLUE_THEME_ID)!;
    expect(blue).toMatchObject({
      label: "Viscosity Blue",
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
        accent: "#0279bb",
        accentFg: "#ffffff",
        border: "#e3e3e8",
        sidebar: "#efeff1",
        content: "#fafafa",
        composer: "#ffffff",
      },
    });
    expect(getThemePreset(VISCOSITY_BLUE_THEME_ID).dark["--accent"]).toBe("#38bdf8");
    // A settings doc saved before the upgrade still resolves to the base theme.
    expect(getThemePreset(DEFAULT_THEME_ID).id).toBe(DEFAULT_THEME_ID);
  });

  it.each(["dark", "light"] as const)(
    "applies every released %s base variable on Viscosity Blue",
    (mode) => {
      const preset = getThemePreset(VISCOSITY_BLUE_THEME_ID)[mode];
      const released = RELEASED_BASE[mode];
      expect(Object.keys(preset).sort()).toEqual([...MANAGED_THEME_VARS].sort());
      expect(preset).toEqual({
        ...released,
        // Not declared by the released block: styles.css derived the panel from
        // the content background and left the override unset.
        "--sidebar-panel-background": released["--content-background"],
        "--sidebar-row-active-override": "",
      });
      // Its quieter row washes were scoped to the base theme before the upgrade.
      const scoped = baseBlock(
        `.${mode}[data-theme-preset="viscosity-blue"],\n  [data-theme="${mode}"][data-theme-preset="viscosity-blue"]`,
      );
      expect(scoped["--row-hover"]).toBe("color-mix(in oklab, var(--foreground) 5%, transparent)");
      expect(scoped["--row-active"]).toBe(
        `color-mix(in oklab, var(--foreground) ${mode === "dark" ? 10 : 9}%, transparent)`,
      );
    },
  );

  it("keeps a working agent icon distinct from an idle one in dark mode", () => {
    // Idle icons use the foreground and the working shine is a white band, so
    // the working tone must sit clearly below the foreground.
    const tone = baseBlock(DEFAULT_SCOPED.dark)["--working-tone"];
    expect(tone).toBe("var(--muted)");
    const fg = CSS_BLOCKS.dark["--foreground"]!;
    expect(contrastRatio(CSS_BLOCKS.dark["--muted"]!, fg)).toBeGreaterThanOrEqual(1.5);
  });

  it("orders Viscosity, Viscosity Blue, Viscosity Showcase, then Graphite and the editor themes", () => {
    expect(APP_THEME_OPTIONS.slice(0, 4)).toEqual([
      { id: DEFAULT_THEME_ID, label: "Viscosity" },
      { id: VISCOSITY_BLUE_THEME_ID, label: "Viscosity Blue" },
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
    expect(baseBlock(DEFAULT_SCOPED.dark)).toMatchObject({
      "--row-hover": "color-mix(in oklab, var(--foreground) 5%, transparent)",
      "--row-active": "color-mix(in oklab, var(--foreground) 10%, transparent)",
    });
    // Shell geometry stays upstream's in the compact phone layout.
    expect(baseBlock(":root:not([data-compact-layout])")).toEqual({
      "--field-radius": "0.375rem",
    });
  });

  it.each(["dark", "light"] as const)(
    "keeps the base theme's low-chroma %s status colours readable",
    (mode) => {
      const spec = THEME_SPECS[0]![mode];
      const block = baseBlock(DEFAULT_SCOPED[mode]);
      // Light keeps upstream's white labels; dark sets black ones.
      const label = (name: string) => block[`--${name}-foreground`] ?? "#ffffff";
      for (const name of ["success", "warning", "danger"]) {
        const color = block[`--${name}`]!;
        expect(color).toMatch(/^#[0-9a-f]{6}$/);
        expect(contrastRatio(color, spec.content!)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(color, spec.surface)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(label(name), color)).toBeGreaterThanOrEqual(4.5);
      }
    },
  );

  it("scopes the monochrome code surfaces and calmer effects to the base theme", () => {
    const entry = readFileSync(join(process.cwd(), "src/renderer/viscosity/viscosity.css"), "utf8");
    expect(entry).toContain('@import "../theme/viscosity/monoCode.css";');
    const monoCode = readFileSync(
      join(process.cwd(), "src/renderer/theme/viscosity/monoCode.css"),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "");
    const selectors = [...monoCode.matchAll(/([^{}]+)\{/g)].map((match) => match[1]!.trim());
    expect(selectors.length).toBeGreaterThan(0);
    for (const selector of selectors) {
      expect(selector.startsWith('html[data-theme-preset="default"] ')).toBe(true);
    }
    // Line-number cells are sticky over horizontally scrolled code.
    const gutters = [...monoCode.matchAll(/(--diff-[a-z]+-lineNumber--)\s*:\s*([^;]+);/g)];
    expect(gutters.map((match) => match[1])).toEqual([
      "--diff-plain-lineNumber--",
      "--diff-expand-lineNumber--",
      "--diff-hunk-lineNumber--",
      "--diff-add-lineNumber--",
      "--diff-del-lineNumber--",
    ]);
    for (const [, , value] of gutters) expect(value).not.toContain("transparent");
    // Unlayered (outside @layer base) so it outranks the unlayered :root tokens.
    const unlayered = tokensCss.slice(0, tokensCss.indexOf("@layer base"));
    expect(unlayered).toMatch(/html\[data-theme-preset="default"\]\s*\{[^}]*--vc-shadow-glow:/);
  });

  // Windows: filter: grayscale() drops text to greyscale antialiasing, so code
  // blocks recolour each Shiki token colour to its luma-matched grey instead.
  it("greys chat code blocks by token colour, without a CSS filter", () => {
    const monoCode = readFileSync(
      join(process.cwd(), "src/renderer/theme/viscosity/monoCode.css"),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "");
    expect(monoCode).not.toMatch(/(^|[\s;{])filter\s*:/);
    const greys = new Map(
      [
        ...monoCode.matchAll(
          /\.lc-shiki \[style\*="color:(#[0-9a-f]{6})" i\]\s*\{\s*color:\s*(#[0-9a-f]{6}) !important;\s*\}/g,
        ),
      ].map((match) => [match[1]!, match[2]!]),
    );
    const colours = new Set<string>();
    for (const theme of [githubDarkDefault, githubLightDefault]) {
      colours.add(theme.colors?.["editor.foreground"] ?? "");
      for (const rule of theme.tokenColors ?? []) colours.add(rule.settings.foreground ?? "");
    }
    colours.delete("");
    const lumaGrey = (colour: string) => {
      const [r, g, b] = [1, 3, 5].map((index) => parseInt(colour.slice(index, index + 2), 16));
      const luma = Math.round(0.2126 * r! + 0.7152 * g! + 0.0722 * b!);
      return `#${luma.toString(16).padStart(2, "0").repeat(3)}`;
    };
    const lower = [...colours].map((colour) => colour.toLowerCase());
    expect(Object.fromEntries(lower.map((colour) => [colour, greys.get(colour)]))).toEqual(
      Object.fromEntries(lower.map((colour) => [colour, lumaGrey(colour)])),
    );
  });

  // The default theme's dark danger is low in chroma; a white label on it fails AA.
  it("labels danger-filled controls with the danger foreground, not white", () => {
    const offenders: string[] = [];
    const rendererDir = join(process.cwd(), "src/renderer");
    for (const file of readdirSync(rendererDir, { recursive: true, encoding: "utf8" })) {
      if (!file.endsWith(".tsx") || file.includes(".test.")) continue;
      const source = readFileSync(join(rendererDir, file), "utf8");
      for (const match of source.matchAll(/["'`][^"'`]*\bbg-danger\b[^"'`]*["'`]/g)) {
        if (/\btext-white\b/.test(match[0])) offenders.push(`${file}: ${match[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  describe("warm desktop-shell palette", () => {
    const WARM = {
      dark: baseBlock('html[data-vc-shell].dark[data-theme-preset="default"]'),
      light: baseBlock('html[data-vc-shell].light[data-theme-preset="default"]'),
    } as const;

    it.each(["dark", "light"] as const)(
      "keeps %s text, accent and status colours readable",
      (mode) => {
        const warm = WARM[mode];
        const content = warm["--content-background"]!;
        const surface = warm["--surface"]!;
        for (const background of [content, warm["--sidebar-background"]!, surface]) {
          expect(contrastRatio(warm["--muted"]!, background)).toBeGreaterThanOrEqual(4.5);
        }
        expect(contrastRatio(warm["--field-placeholder"]!, content)).toBeGreaterThanOrEqual(4);
        expect(
          contrastRatio(warm["--accent-foreground"]!, warm["--accent"]!),
        ).toBeGreaterThanOrEqual(4.5);
        // Status colours come from the scoped base-theme block; the warm greys
        // must not pull them under AA.
        const status = baseBlock(DEFAULT_SCOPED[mode]);
        for (const name of ["success", "warning", "danger"]) {
          expect(contrastRatio(status[`--${name}`]!, content)).toBeGreaterThanOrEqual(4.5);
          expect(contrastRatio(status[`--${name}`]!, surface)).toBeGreaterThanOrEqual(4.5);
        }
      },
    );

    it("leaves the monochrome base blocks (Android generator and compact input) unchanged", () => {
      // Pre-upgrade guard: the warm palette is additive and shell-scoped.
      expect(CSS_BLOCKS.dark).toMatchObject({
        "--background": "#000000",
        "--surface": "#111111",
        "--sidebar-background": "#000000",
        "--content-background": "#0a0a0a",
        "--composer-surface": "#141414",
      });
      expect(CSS_BLOCKS.light).toMatchObject({
        "--background": "#fafafa",
        "--surface": "#ffffff",
        "--sidebar-background": "#f5f5f5",
        "--content-background": "#ffffff",
        "--composer-surface": "#ffffff",
      });
      expect(THEME_SPECS[0]!.dark.bg).toBe("#000000");
      expect(THEME_SPECS[0]!.light.bg).toBe("#fafafa");
    });
  });
});
