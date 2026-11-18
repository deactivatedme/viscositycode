import { describe, expect, it } from "vitest";
import { customThemeSchema, type CustomTheme, type ThemeDocument } from "@/shared/customThemes";
import { THEME_SPECS } from "@/renderer/theme/themePresets";
import {
  MAX_THEME_LABEL_LENGTH,
  planThemeImport,
  themeColorsKey,
  uniqueThemeLabel,
} from "./themeImportPlan";

const palette = {
  bg: "#101010",
  surface: "#161616",
  fg: "#eeeeee",
  accent: "#66aaff",
  accentFg: "#001122",
  border: "#333333",
};
const doc: ThemeDocument = {
  version: 1,
  label: "Shared night",
  light: { ...palette, bg: "#ffffff", fg: "#111111" },
  dark: palette,
};

function installed(id: string, label: string, colors: Pick<ThemeDocument, "light" | "dark">) {
  return { version: 1, id, label, ...colors } satisfies CustomTheme;
}

describe("uniqueThemeLabel", () => {
  it("keeps a free name and numbers a taken one, case-insensitively", () => {
    expect(uniqueThemeLabel("Ocean", ["Forest"])).toBe("Ocean");
    expect(uniqueThemeLabel("Ocean", ["ocean"])).toBe("Ocean (2)");
    expect(uniqueThemeLabel(" Ocean ", ["Ocean", "Ocean (2)"])).toBe("Ocean (3)");
  });

  it("continues an existing number instead of nesting suffixes", () => {
    expect(uniqueThemeLabel("Ocean (2)", ["Ocean", "Ocean (2)"])).toBe("Ocean (3)");
  });

  it("stays within the name limit", () => {
    const long = "x".repeat(MAX_THEME_LABEL_LENGTH);
    const next = uniqueThemeLabel(long, [long]);
    expect(next).toHaveLength(MAX_THEME_LABEL_LENGTH);
    expect(next.endsWith(" (2)")).toBe(true);
  });
});

describe("themeColorsKey", () => {
  it("ignores name, hex case and short hex", () => {
    const shouty = {
      light: { ...doc.light, accent: "#66AAFF", border: "#333" },
      dark: { ...doc.dark, accent: "#6af", border: "#333333" },
    };
    expect(themeColorsKey(shouty)).toBe(
      themeColorsKey({
        light: { ...doc.light, border: "#333333" },
        dark: { ...doc.dark, accent: "#66aaff" },
      }),
    );
    expect(themeColorsKey(doc)).not.toBe(
      themeColorsKey({ ...doc, dark: { ...doc.dark, sidebarFill: true } }),
    );
  });
});

describe("planThemeImport", () => {
  it("applies an installed theme with the same colors instead of adding a copy", () => {
    const existing = installed("custom:night", "My night", {
      light: { ...doc.light, accent: "#66AAFF" },
      dark: doc.dark,
    });
    expect(planThemeImport(doc, { customThemes: [existing] })).toEqual({
      kind: "existing",
      theme: existing,
    });
  });

  it("names a new theme uniquely and gives it a fresh, valid id", () => {
    const sameName = installed("custom:other", "Shared night", {
      light: doc.light,
      dark: { ...doc.dark, accent: "#ff0000" },
    });
    const plan = planThemeImport(doc, {
      customThemes: [sameName],
      newId: () => "custom:fresh-1",
    });
    expect(plan).toEqual({
      kind: "new",
      theme: { ...doc, id: "custom:fresh-1", label: "Shared night (2)" },
    });
    const generated = planThemeImport(doc, { customThemes: [] });
    expect(generated).toMatchObject({ kind: "new", theme: { label: "Shared night" } });
    expect(customThemeSchema.safeParse(generated.theme).success).toBe(true);
  });

  it("avoids bundled preset names but still allows an editable copy of a preset", () => {
    const preset = THEME_SPECS[0]!;
    const plan = planThemeImport(
      { version: 1, label: preset.label, light: preset.light, dark: preset.dark },
      { customThemes: [], newId: () => "custom:copy" },
    );
    expect(plan).toMatchObject({ kind: "new", theme: { label: `${preset.label} (2)` } });
  });
});
