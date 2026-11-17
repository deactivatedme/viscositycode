import { afterEach, describe, expect, it } from "vitest";
import {
  rememberWindowMaterialPreference,
  resetRememberedWindowMaterialPreferenceForTests,
  resolveWindowsBackgroundMaterial,
  startupWindowMaterialPreference,
  windowBaseBackgroundColor,
  windowCaptionSymbolColor,
  windowReportsNativeMaterial,
} from "./windowChromeAppearance";

afterEach(() => resetRememberedWindowMaterialPreferenceForTests());

describe("resolveWindowsBackgroundMaterial", () => {
  it("keeps the upstream acrylic behaviour for payloads without a preference", () => {
    expect(
      resolveWindowsBackgroundMaterial({ preference: undefined, translucent: true, capable: true }),
    ).toBe("acrylic");
    expect(
      resolveWindowsBackgroundMaterial({
        preference: undefined,
        translucent: false,
        capable: true,
      }),
    ).toBe("none");
  });

  it("maps Auto to Mica only when translucency is on and the OS is capable", () => {
    expect(
      resolveWindowsBackgroundMaterial({ preference: "auto", translucent: true, capable: true }),
    ).toBe("mica");
    expect(
      resolveWindowsBackgroundMaterial({ preference: "auto", translucent: false, capable: true }),
    ).toBe("none");
    expect(
      resolveWindowsBackgroundMaterial({ preference: "auto", translucent: true, capable: false }),
    ).toBe("none");
  });

  it("honours explicit choices and never applies a material without the capability", () => {
    for (const preference of ["mica", "acrylic", "none"] as const) {
      expect(
        resolveWindowsBackgroundMaterial({ preference, translucent: true, capable: true }),
      ).toBe(preference);
      expect(
        resolveWindowsBackgroundMaterial({ preference, translucent: true, capable: false }),
      ).toBe("none");
      expect(
        resolveWindowsBackgroundMaterial({ preference, translucent: false, capable: true }),
      ).toBe("none");
    }
  });
});

describe("windowReportsNativeMaterial", () => {
  it("reports the OS capability unchanged without a preference", () => {
    expect(
      windowReportsNativeMaterial({ platform: "win32", capable: true, preference: undefined }),
    ).toBe(true);
    expect(
      windowReportsNativeMaterial({ platform: "win32", capable: false, preference: undefined }),
    ).toBe(false);
  });

  it("lets an explicit None opt Windows out so the renderer keeps its CSS tint", () => {
    expect(
      windowReportsNativeMaterial({ platform: "win32", capable: true, preference: "none" }),
    ).toBe(false);
    expect(
      windowReportsNativeMaterial({ platform: "win32", capable: true, preference: "mica" }),
    ).toBe(true);
  });

  it("ignores the Windows-only preference on macOS vibrancy", () => {
    expect(
      windowReportsNativeMaterial({ platform: "darwin", capable: true, preference: "none" }),
    ).toBe(true);
  });
});

describe("window base colours", () => {
  it("uses the ViscosityCode base colours with contrasting caption glyphs", () => {
    expect(windowBaseBackgroundColor("dark")).toBe("#0a0a0b");
    expect(windowBaseBackgroundColor("light")).toBe("#f4f4f5");
    // Upstream's fallback for a payload without an appearance was the light base.
    expect(windowBaseBackgroundColor(undefined)).toBe("#f4f4f5");
    expect(windowCaptionSymbolColor("dark")).toBe("#fafafa");
    expect(windowCaptionSymbolColor("light")).toBe("#1f2937");
  });
});

describe("startupWindowMaterialPreference", () => {
  it("starts from Auto and then follows the last preference a renderer sent", () => {
    expect(startupWindowMaterialPreference()).toBe("auto");
    rememberWindowMaterialPreference("acrylic");
    expect(startupWindowMaterialPreference()).toBe("acrylic");
  });
});
