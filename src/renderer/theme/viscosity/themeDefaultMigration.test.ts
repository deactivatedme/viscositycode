// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { moveCachedThemeToDefaultOnce } from "./themeDefaultMigration";

const KEY = "poracode-shared-settings";
const read = () =>
  JSON.parse(localStorage.getItem(KEY) ?? "null") as { themePreset?: string } | null;

describe("moveCachedThemeToDefaultOnce", () => {
  beforeEach(() => localStorage.clear());

  it("moves a cached monochrome id to Viscosity Blue once and keeps the other settings", () => {
    localStorage.setItem(KEY, JSON.stringify({ themePreset: "default", themeMode: "dark" }));
    moveCachedThemeToDefaultOnce(KEY);
    expect(read()).toEqual({ themePreset: "viscosity-blue", themeMode: "dark" });
  });

  it("keeps a monochrome pick made after the move", () => {
    localStorage.setItem(KEY, JSON.stringify({ themePreset: "default" }));
    moveCachedThemeToDefaultOnce(KEY);
    localStorage.setItem(KEY, JSON.stringify({ themePreset: "default" }));
    moveCachedThemeToDefaultOnce(KEY);
    expect(read()?.themePreset).toBe("default");
  });

  it("leaves other themes, a missing cache and a corrupt cache alone", () => {
    localStorage.setItem(KEY, JSON.stringify({ themePreset: "hostile-binary" }));
    moveCachedThemeToDefaultOnce(KEY);
    expect(read()?.themePreset).toBe("hostile-binary");

    localStorage.clear();
    moveCachedThemeToDefaultOnce(KEY);
    expect(localStorage.getItem(KEY)).toBeNull();

    localStorage.clear();
    localStorage.setItem(KEY, "{not json");
    expect(() => moveCachedThemeToDefaultOnce(KEY)).not.toThrow();
    expect(localStorage.getItem(KEY)).toBe("{not json");
  });
});
