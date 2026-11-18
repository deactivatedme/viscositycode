import { describe, expect, it, vi } from "vitest";
import { parseThemeDocument, type CustomTheme } from "@/shared/customThemes";
import { copyThemeJson, shareableThemeDocument, shareableThemeFile } from "./themeShare";

const palette = {
  bg: "#101010",
  surface: "#161616",
  fg: "#eeeeee",
  accent: "#66aaff",
  accentFg: "#001122",
  border: "#333333",
};
const custom: CustomTheme = {
  version: 1,
  id: "custom:night",
  label: "Night Owl",
  light: { ...palette, bg: "#ffffff", fg: "#111111" },
  dark: palette,
};

describe("shareableThemeDocument", () => {
  it("shares an installed custom theme without its installation id", () => {
    const doc = shareableThemeDocument(custom.id, [custom]);
    expect(doc).toEqual({ version: 1, label: "Night Owl", light: custom.light, dark: custom.dark });
    expect(doc).not.toHaveProperty("id");
  });

  it("shares the bundled preset shown for a built-in id", () => {
    expect(shareableThemeDocument("default", [custom])).toMatchObject({
      version: 1,
      label: "Viscosity",
    });
  });
});

describe("shareableThemeFile", () => {
  it("serializes an importable document with a portable file name", () => {
    const file = shareableThemeFile(custom.id, [custom])!;
    expect(file.filename).toBe("night-owl-theme.json");
    expect(file.label).toBe("Night Owl");
    expect(parseThemeDocument(file.json)).toEqual({
      version: 1,
      label: "Night Owl",
      light: custom.light,
      dark: custom.dark,
    });
  });
});

describe("copyThemeJson", () => {
  it("writes the JSON and reports success", async () => {
    const write = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve());
    await expect(copyThemeJson("{}", write)).resolves.toBe(true);
    expect(write).toHaveBeenCalledExactlyOnceWith("{}");
  });

  it("reports a refused or missing clipboard", async () => {
    await expect(copyThemeJson("{}", () => Promise.reject(new Error("denied")))).resolves.toBe(
      false,
    );
    await expect(copyThemeJson("{}", null)).resolves.toBe(false);
  });
});
