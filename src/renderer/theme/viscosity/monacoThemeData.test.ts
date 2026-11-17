import { describe, expect, it } from "vitest";
import { buildMonacoThemeData, type MonacoThemeColors } from "./monacoThemeData";
import { deriveAnsiColors } from "./terminalPalette";

const MONACO_COLOR = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;
const TOKEN_COLOR = /^[0-9a-f]{6}$/;

const GITHUB_DARK: MonacoThemeColors = {
  background: "#0d1117",
  content: "#0d1117",
  foreground: "#e6edf3",
  muted: "#8d96a0",
  surface: "#161b22",
  overlay: "rgb(22, 27, 34)",
  border: "#30363d",
  accent: "#2f81f7",
  field: "#1c2128",
  success: "#3fb950",
  warning: "#d29922",
  danger: "#f85149",
};

function rule(data: ReturnType<typeof buildMonacoThemeData>, token: string) {
  return data.rules.find((entry) => entry.token === token);
}

describe("buildMonacoThemeData", () => {
  it("builds widget, selection, gutter and diff colours from the theme", () => {
    const data = buildMonacoThemeData("dark", GITHUB_DARK);
    expect(data.base).toBe("vs-dark");
    expect(data.inherit).toBe(true);
    expect(data.colors).toMatchObject({
      "editor.background": "#00000000",
      "editorGutter.background": "#00000000",
      "editor.foreground": "#e6edf3",
      "editorCursor.foreground": "#2f81f7",
      "editorWidget.background": "#161b22",
      "editorWidget.border": "#30363d",
      "editorSuggestWidget.background": "#161b22",
      "editorSuggestWidget.highlightForeground": "#2f81f7",
      "input.background": "#1c2128",
      "editorGutter.addedBackground": "#3fb950",
      "editorGutter.deletedBackground": "#f85149",
    });
    expect(data.colors["editor.selectionBackground"]).toMatch(/^#2f81f7[0-9a-f]{2}$/);
    expect(data.colors["editor.findMatchBackground"]).toMatch(/^#d29922[0-9a-f]{2}$/);
    expect(data.colors["diffEditor.insertedTextBackground"]).toMatch(/^#3fb950[0-9a-f]{2}$/);
    expect(data.colors["diffEditor.removedTextBackground"]).toMatch(/^#f85149[0-9a-f]{2}$/);
    expect(data.colors["scrollbarSlider.background"]).toMatch(/^#e6edf3[0-9a-f]{2}$/);
    const invalid = Object.entries(data.colors).filter(([, value]) => !MONACO_COLOR.test(value));
    expect(invalid).toEqual([]);
  });

  it("colours comments muted, keywords accent and literals from the theme palette", () => {
    const data = buildMonacoThemeData("dark", GITHUB_DARK);
    const ansi = deriveAnsiColors("dark", "#0d1117", "#e6edf3");
    expect(rule(data, "comment")).toEqual({
      token: "comment",
      foreground: "8d96a0",
      fontStyle: "italic",
    });
    expect(rule(data, "keyword")?.foreground).toBe("2f81f7");
    expect(rule(data, "string")?.foreground).toBe(ansi.green.slice(1));
    expect(rule(data, "number")?.foreground).toBe(ansi.yellow.slice(1));
    expect(rule(data, "type")?.foreground).toBe(ansi.cyan.slice(1));
    const invalidRules = data.rules.filter((entry) => !TOKEN_COLOR.test(entry.foreground ?? ""));
    expect(invalidRules).toEqual([]);
  });

  it("falls back to the Viscosity palette per appearance for missing values", () => {
    const light = buildMonacoThemeData("light", null);
    expect(light.base).toBe("vs");
    expect(light.colors["editor.foreground"]).toBe("#18181b");
    expect(light.colors["editorCursor.foreground"]).toBe("#0279bb");
    const partial = buildMonacoThemeData("dark", {
      accent: "oklch(0.7 0.1 200)",
      foreground: null,
    });
    expect(partial.colors["editorCursor.foreground"]).toBe("#38bdf8");
    expect(partial.colors["editor.foreground"]).toBe("#e6e6e8");
  });

  it("flattens translucent resolved colours to opaque anchors", () => {
    const data = buildMonacoThemeData("dark", { overlay: "rgba(20, 20, 22, 0.5)" });
    expect(data.colors["editorWidget.background"]).toBe("#141416");
  });
});
