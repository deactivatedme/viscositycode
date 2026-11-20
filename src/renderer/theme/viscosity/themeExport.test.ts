import { describe, expect, it } from "vitest";
import { parseThemeDocument } from "@/shared/customThemes";
import { THEME_SPECS } from "@/renderer/theme/themePresets";
import { builtInThemeDocument, exportBuiltInTheme, themeExportFilename } from "./themeExport";

describe("built-in theme export", () => {
  it("exports every built-in preset as an importable version 1 document", () => {
    for (const spec of THEME_SPECS) {
      const exported = exportBuiltInTheme(spec.id);
      expect(exported).not.toBeNull();
      const doc = parseThemeDocument(exported!.json);
      expect(doc).toEqual({
        version: 1,
        label: spec.label,
        light: spec.light,
        dark: spec.dark,
      });
      // The document carries no installation id; import assigns a fresh one.
      expect(JSON.parse(exported!.json)).not.toHaveProperty("id");
    }
  });

  it("names the file after the preset label", () => {
    expect(exportBuiltInTheme("default")?.filename).toBe("viscosity-theme.json");
    expect(exportBuiltInTheme("viscosity-showcase")?.filename).toBe(
      "viscosity-showcase-theme.json",
    );
    expect(themeExportFilename("Rosé Pine")).toBe("rose-pine-theme.json");
    expect(themeExportFilename("  ✨  ")).toBe("custom-theme.json");
  });

  it("resolves legacy, unknown and uninstalled custom ids like the app does", () => {
    expect(builtInThemeDocument("lightcode-legacy")?.label).toBe("Graphite");
    expect(builtInThemeDocument("no-such-theme")?.label).toBe("Viscosity Blue");
    // A deleted custom theme renders the default selection, so that is what exports.
    expect(builtInThemeDocument("custom:deleted")?.label).toBe("Viscosity Blue");
    expect(builtInThemeDocument("default")?.label).toBe("Viscosity");
  });

  it("copies palettes so edits to an export never touch the catalog", () => {
    const doc = builtInThemeDocument("default")!;
    doc.dark.bg = "#123456";
    expect(THEME_SPECS[0]!.dark.bg).toBe("#000000");
  });
});
