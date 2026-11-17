import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const KEY = "viscosity:appearance:v1";

async function loadStore() {
  vi.resetModules();
  return import("./viscosityAppearanceStore");
}

function resetDocument() {
  document.documentElement.style.removeProperty("--vc-font-ui");
  delete document.documentElement.dataset.vcUiFont;
  document.body.style.removeProperty("font-family");
}

beforeEach(() => {
  localStorage.clear();
  resetDocument();
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  resetDocument();
});

describe("viscosity appearance store", () => {
  it("defaults to Geist and leaves the stylesheet fonts in charge", async () => {
    const store = await loadStore();
    expect(store.useViscosityAppearance.getState().uiFont).toBe("geist");
    store.applyViscosityAppearance();
    expect(document.documentElement.style.getPropertyValue("--vc-font-ui")).toBe("");
    expect(document.body.style.getPropertyValue("font-family")).toBe("");
  });

  it("persists the UI font and applies it to the token and the body", async () => {
    const store = await loadStore();
    store.useViscosityAppearance.getState().setUiFont("system");
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ uiFont: "system" });
    expect(document.documentElement.style.getPropertyValue("--vc-font-ui")).toBe(
      store.VISCOSITY_UI_FONT_STACKS.system,
    );
    expect(document.documentElement.dataset.vcUiFont).toBe("system");
    expect(document.body.style.getPropertyValue("font-family")).toBe("var(--vc-font-ui)");

    // A fresh renderer (next launch) restores the saved choice.
    const reloaded = await loadStore();
    expect(reloaded.useViscosityAppearance.getState().uiFont).toBe("system");

    reloaded.useViscosityAppearance.getState().setUiFont("geist");
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ uiFont: "geist" });
    expect(document.documentElement.style.getPropertyValue("--vc-font-ui")).toBe("");
    expect(document.body.style.getPropertyValue("font-family")).toBe("");
  });

  it("ignores malformed or unknown persisted values", async () => {
    localStorage.setItem(KEY, "{not json");
    expect((await loadStore()).useViscosityAppearance.getState().uiFont).toBe("geist");
    localStorage.setItem(KEY, JSON.stringify({ uiFont: "comic-sans" }));
    expect((await loadStore()).useViscosityAppearance.getState().uiFont).toBe("geist");
    localStorage.setItem(KEY, "null");
    expect((await loadStore()).useViscosityAppearance.getState().uiFont).toBe("geist");
  });

  it("keeps working when storage is unavailable", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const store = await loadStore();
    expect(store.useViscosityAppearance.getState().uiFont).toBe("geist");
    expect(() => store.useViscosityAppearance.getState().setUiFont("system")).not.toThrow();
    expect(store.useViscosityAppearance.getState().uiFont).toBe("system");
    expect(document.documentElement.dataset.vcUiFont).toBe("system");
  });

  it("follows a change made in another window", async () => {
    const store = await loadStore();
    localStorage.setItem(KEY, JSON.stringify({ uiFont: "system" }));
    window.dispatchEvent(new StorageEvent("storage", { key: KEY }));
    expect(store.useViscosityAppearance.getState().uiFont).toBe("system");
    expect(document.documentElement.dataset.vcUiFont).toBe("system");
  });
});
