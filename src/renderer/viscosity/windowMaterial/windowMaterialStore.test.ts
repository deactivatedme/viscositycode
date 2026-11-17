import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_WINDOW_MATERIAL,
  WINDOW_MATERIAL_STORAGE_KEY,
  isWindowMaterialPreference,
  readStoredWindowMaterial,
  setWindowMaterialPreference,
  useWindowMaterialStore,
} from "./windowMaterialStore";

beforeEach(() => {
  window.localStorage.clear();
  useWindowMaterialStore.setState({ preference: DEFAULT_WINDOW_MATERIAL });
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("window material preference storage", () => {
  it("uses a versioned fork key and defaults to Auto", () => {
    expect(WINDOW_MATERIAL_STORAGE_KEY).toBe("viscosity:window-material:v1");
    expect(DEFAULT_WINDOW_MATERIAL).toBe("auto");
    expect(readStoredWindowMaterial()).toBe("auto");
  });

  it("reads every stored v1 value", () => {
    for (const preference of ["auto", "mica", "acrylic", "none"] as const) {
      window.localStorage.setItem(WINDOW_MATERIAL_STORAGE_KEY, preference);
      expect(readStoredWindowMaterial()).toBe(preference);
    }
  });

  it("reads an unknown (newer) value as Auto without rewriting it", () => {
    window.localStorage.setItem(WINDOW_MATERIAL_STORAGE_KEY, "tabbed");
    expect(readStoredWindowMaterial()).toBe("auto");
    expect(window.localStorage.getItem(WINDOW_MATERIAL_STORAGE_KEY)).toBe("tabbed");
  });

  it("falls back to Auto when storage is missing or throws", () => {
    expect(readStoredWindowMaterial(null)).toBe("auto");
    const throwing = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {},
    };
    expect(readStoredWindowMaterial(throwing)).toBe("auto");
  });

  it("validates preference values", () => {
    expect(isWindowMaterialPreference("mica")).toBe(true);
    expect(isWindowMaterialPreference("tabbed")).toBe(false);
    expect(isWindowMaterialPreference(undefined)).toBe(false);
  });
});

describe("useWindowMaterialStore", () => {
  it("persists a chosen preference and updates the store", () => {
    setWindowMaterialPreference("acrylic");
    expect(useWindowMaterialStore.getState().preference).toBe("acrylic");
    expect(window.localStorage.getItem(WINDOW_MATERIAL_STORAGE_KEY)).toBe("acrylic");
  });

  it("keeps the in-memory choice when storage refuses the write", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    setWindowMaterialPreference("none");
    expect(useWindowMaterialStore.getState().preference).toBe("none");
  });

  it("hydrates from storage when the module loads", async () => {
    window.localStorage.setItem(WINDOW_MATERIAL_STORAGE_KEY, "mica");
    vi.resetModules();
    const fresh = await import("./windowMaterialStore");
    expect(fresh.useWindowMaterialStore.getState().preference).toBe("mica");
  });
});
