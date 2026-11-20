// Modified for ViscosityCode (fork of Poracode). See FORK_CHANGES.md.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { prewarmModule, runtimeMock, mobileModule, lightweightMock, loaded } = vi.hoisted(() => ({
  prewarmModule: { loaded: false },
  runtimeMock: { browser: false },
  mobileModule: { loaded: false },
  lightweightMock: { active: false },
  loaded: new Set<string>(),
}));

vi.mock("@/renderer/viscosity/performance/lightweight", () => ({
  isLightweightActive: () => lightweightMock.active,
}));
vi.mock("@/renderer/commands/CommandPalette", () => {
  loaded.add("commandPalette");
  return { CommandPalette: () => null };
});
vi.mock("@/renderer/components/thread/ChatPane/parts/items/ItemMarkdownInner", () => {
  loaded.add("markdown");
  return { default: () => null };
});
vi.mock("@/renderer/views/SettingsOverlay/SettingsOverlay", () => {
  loaded.add("settings");
  return { SettingsOverlay: () => null };
});

vi.mock("@/renderer/clientRuntime", () => ({
  isBrowserClientRuntime: () => runtimeMock.browser,
}));
vi.mock("@/renderer/views/MainView/parts/MobileWorkspacePage", () => {
  mobileModule.loaded = true;
  return { MobileWorkspacePage: () => null };
});

vi.mock("@/renderer/components/terminal/terminalPrewarm", () => {
  prewarmModule.loaded = true;
  // Also mark on call: vi.resetModules keeps the mock registry, so the factory runs once.
  return {
    prewarmTerminalSurface: vi.fn<() => Promise<void>>(async () => {
      prewarmModule.loaded = true;
    }),
  };
});

describe("deferredFeatures", () => {
  const idleCallbacks: Array<() => void> = [];

  beforeEach(() => {
    idleCallbacks.length = 0;
    prewarmModule.loaded = false;
    runtimeMock.browser = false;
    mobileModule.loaded = false;
    lightweightMock.active = false;
    loaded.clear();
    document.documentElement.dataset.windowKind = "quickComposer";
    vi.stubGlobal("requestIdleCallback", (callback: () => void) => {
      idleCallbacks.push(callback);
      return idleCallbacks.length;
    });
    vi.stubGlobal("cancelIdleCallback", vi.fn());
  });

  afterEach(() => {
    delete document.documentElement.dataset.windowKind;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("does not import terminal prewarm in the quick composer window", async () => {
    const { startDeferredFeaturePrewarm } = await import("./deferredFeatures");
    const stop = startDeferredFeaturePrewarm();

    expect(idleCallbacks).toHaveLength(1);
    idleCallbacks[0]!();
    stop();
    await Promise.resolve();

    expect(prewarmModule.loaded).toBe(false);
  });

  it("defers offline browser compact imports and resumes through the online event", async () => {
    runtimeMock.browser = true;
    let online = false;
    vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
    const { startDeferredFeaturePrewarm } = await import("./deferredFeatures");
    const stop = startDeferredFeaturePrewarm("compact");
    try {
      expect(idleCallbacks).toHaveLength(0);
      expect(mobileModule.loaded).toBe(false);
      online = true;
      window.dispatchEvent(new Event("online"));
      window.dispatchEvent(new Event("online"));
      expect(idleCallbacks).toHaveLength(1);
      idleCallbacks[0]!();
      await vi.waitFor(() => expect(mobileModule.loaded).toBe(true));
    } finally {
      stop();
    }
  });

  it("does not restart a stopped offline browser prewarm", async () => {
    runtimeMock.browser = true;
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const { startDeferredFeaturePrewarm } = await import("./deferredFeatures");
    const stop = startDeferredFeaturePrewarm("compact");
    stop();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    window.dispatchEvent(new Event("online"));
    expect(idleCallbacks).toHaveLength(0);
    expect(mobileModule.loaded).toBe(false);
  });

  it("Lightweight desktop prewarms only the command palette and markdown", async () => {
    lightweightMock.active = true;
    delete document.documentElement.dataset.windowKind;
    const { startDeferredFeaturePrewarm } = await import("./deferredFeatures");
    const stop = startDeferredFeaturePrewarm("desktop");
    try {
      for (let step = 0; step < 10 && idleCallbacks.length > 0; step++) {
        idleCallbacks.shift()!();
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      expect([...loaded].sort()).toEqual(["commandPalette", "markdown"]);
      expect(prewarmModule.loaded).toBe(false);
      expect(idleCallbacks).toHaveLength(0);
    } finally {
      stop();
    }
  });

  it("a desktop browser client keeps the full prewarm when Lightweight is on", async () => {
    runtimeMock.browser = true;
    lightweightMock.active = true;
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    delete document.documentElement.dataset.windowKind;
    const { startDeferredFeaturePrewarm } = await import("./deferredFeatures");
    const stop = startDeferredFeaturePrewarm("desktop");
    try {
      idleCallbacks.shift()!();
      await vi.waitFor(() => expect(prewarmModule.loaded).toBe(true));
    } finally {
      stop();
    }
  });

  it("full desktop prewarm starts with the terminal surface when Lightweight is off", async () => {
    delete document.documentElement.dataset.windowKind;
    const { startDeferredFeaturePrewarm } = await import("./deferredFeatures");
    const stop = startDeferredFeaturePrewarm("desktop");
    try {
      idleCallbacks.shift()!();
      await vi.waitFor(() => expect(prewarmModule.loaded).toBe(true));
    } finally {
      stop();
    }
  });
});
