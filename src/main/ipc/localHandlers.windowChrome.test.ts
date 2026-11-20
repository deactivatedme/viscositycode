import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolvePoracodePaths } from "@/shared/poracodePaths";
import {
  resetRememberedWindowMaterialPreferenceForTests,
  startupWindowMaterialPreference,
} from "../window/windowChromeAppearance";
import { createLocalIpcHandlers } from "./localHandlers";

const supportsNativeWindowMaterial = vi.hoisted(() => vi.fn<() => boolean>(() => true));
const syncNativeThemeForMaterial = vi.hoisted(() => vi.fn<(appearance: string) => void>());

vi.mock("electron", () => ({
  app: { getPath: vi.fn<() => string>(() => "/tmp"), isPackaged: false },
  clipboard: { write: vi.fn<() => Promise<void>>(async () => {}) },
  ClipboardItem: class ClipboardItem {},
  dialog: {},
  nativeImage: {},
  shell: {},
  BrowserWindow: class BrowserWindow {},
}));

vi.mock("../window/windowMaterial", () => ({
  supportsNativeWindowMaterial,
  syncNativeThemeForMaterial,
}));

function createWindowStub() {
  return {
    setTitleBarOverlay: vi.fn<(options: Record<string, unknown>) => void>(),
    setBackgroundMaterial: vi.fn<(material: string) => void>(),
    setBackgroundColor: vi.fn<(color: string) => void>(),
    setVibrancy: vi.fn<(type: string | null) => void>(), // ViscosityCode:
  };
}

function createHandlers(window: ReturnType<typeof createWindowStub> | null) {
  return createLocalIpcHandlers({
    getMainWindow: () => window as never,
    getBrowserPanelManager: () => null,
    sshConnectionManager: {} as never,
    requirePoracodePaths: () => resolvePoracodePaths("/tmp"),
    updatePowerSaveBlocker: vi.fn<() => void>(),
    autoUpdater: {} as never,
    extractBrowserToWindow: vi.fn<() => void>(),
    injectBrowserToMain: vi.fn<() => void>(),
    requestRelaunch: vi.fn<() => void>(),
    database: { callDatabase: vi.fn<() => Promise<undefined>>(async () => undefined) } as never,
    backendServices: {
      callService: vi.fn<() => Promise<undefined>>(async () => undefined),
    } as never,
    revertCheckpoint: vi.fn<() => Promise<never>>(),
  });
}

const basePayload = {
  backgroundColor: "rgba(0, 0, 0, 0)",
  symbolColor: "#fafafa",
  materialEnabled: true,
  appearance: "dark",
} as const;

describe("setWindowChrome on Windows 11", () => {
  const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");

  beforeEach(() => {
    supportsNativeWindowMaterial.mockReturnValue(true);
    Object.defineProperty(process, "platform", { configurable: true, value: "win32" });
  });

  afterEach(() => {
    if (platformDescriptor) Object.defineProperty(process, "platform", platformDescriptor);
    resetRememberedWindowMaterialPreferenceForTests();
  });

  it("keeps the upstream acrylic behaviour for a payload without a preference", async () => {
    const window = createWindowStub();
    const result = await createHandlers(window).setWindowChrome(basePayload);
    expect(result).toEqual({ nativeCapable: true });
    expect(window.setBackgroundMaterial).toHaveBeenCalledExactlyOnceWith("acrylic");
    expect(window.setBackgroundColor).toHaveBeenCalledExactlyOnceWith("#00000000");
    expect(window.setTitleBarOverlay).toHaveBeenCalledExactlyOnceWith({
      color: basePayload.backgroundColor,
      symbolColor: basePayload.symbolColor,
      height: 32,
    });
    expect(syncNativeThemeForMaterial).toHaveBeenCalledWith("dark");
    expect(startupWindowMaterialPreference()).toBe("auto");
  });

  it("applies Mica for Auto and remembers the preference for new windows", async () => {
    const window = createWindowStub();
    await createHandlers(window).setWindowChrome({ ...basePayload, windowMaterial: "auto" });
    expect(window.setBackgroundMaterial).toHaveBeenCalledExactlyOnceWith("mica");
    expect(startupWindowMaterialPreference()).toBe("auto");

    await createHandlers(window).setWindowChrome({ ...basePayload, windowMaterial: "acrylic" });
    expect(window.setBackgroundMaterial).toHaveBeenLastCalledWith("acrylic");
    expect(startupWindowMaterialPreference()).toBe("acrylic");
  });

  it("turns the backdrop off and paints the base colour while loading or translucency is off", async () => {
    const window = createWindowStub();
    await createHandlers(window).setWindowChrome({
      ...basePayload,
      materialEnabled: false,
      appearance: "light",
      windowMaterial: "mica",
    });
    expect(window.setBackgroundMaterial).toHaveBeenCalledExactlyOnceWith("none");
    expect(window.setBackgroundColor).toHaveBeenCalledExactlyOnceWith("#fafafa");
  });

  it("paints the opaque base in the shown appearance when it differs", async () => {
    const window = createWindowStub();
    await createHandlers(window).setWindowChrome({
      ...basePayload,
      materialEnabled: false,
      appearance: "light",
      shownAppearance: "dark",
      windowMaterial: "mica",
    });
    expect(window.setBackgroundMaterial).toHaveBeenCalledExactlyOnceWith("none");
    expect(window.setBackgroundColor).toHaveBeenCalledExactlyOnceWith("#000000");
    expect(syncNativeThemeForMaterial).not.toHaveBeenCalled();
  });

  it("reports no native material for None so the renderer keeps its CSS tint", async () => {
    const window = createWindowStub();
    const result = await createHandlers(window).setWindowChrome({
      ...basePayload,
      windowMaterial: "none",
    });
    expect(result).toEqual({ nativeCapable: false });
    expect(window.setBackgroundMaterial).toHaveBeenCalledExactlyOnceWith("none");
    expect(window.setBackgroundColor).toHaveBeenCalledExactlyOnceWith("#000000");
    expect(syncNativeThemeForMaterial).not.toHaveBeenCalled();
  });

  it("never applies a material on Windows builds without the capability", async () => {
    supportsNativeWindowMaterial.mockReturnValue(false);
    const window = createWindowStub();
    const result = await createHandlers(window).setWindowChrome({
      ...basePayload,
      windowMaterial: "mica",
    });
    expect(result).toEqual({ nativeCapable: false });
    expect(window.setBackgroundMaterial).toHaveBeenCalledExactlyOnceWith("none");
    expect(window.setBackgroundColor).toHaveBeenCalledExactlyOnceWith("#000000");
  });

  it("answers without a main window", async () => {
    await expect(
      createHandlers(null).setWindowChrome({ ...basePayload, windowMaterial: "mica" }),
    ).resolves.toEqual({ nativeCapable: true });
  });
});

describe("setWindowChrome on macOS", () => {
  const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");

  beforeEach(() => {
    supportsNativeWindowMaterial.mockReturnValue(true);
    Object.defineProperty(process, "platform", { configurable: true, value: "darwin" });
  });

  afterEach(() => {
    if (platformDescriptor) Object.defineProperty(process, "platform", platformDescriptor);
    resetRememberedWindowMaterialPreferenceForTests();
  });

  it("attaches vibrancy and ignores the Windows-only preference", async () => {
    const window = createWindowStub();
    const result = await createHandlers(window).setWindowChrome({
      ...basePayload,
      windowMaterial: "none",
    });
    expect(result).toEqual({ nativeCapable: true });
    expect(window.setVibrancy).toHaveBeenCalledExactlyOnceWith("sidebar");
    expect(window.setBackgroundMaterial).not.toHaveBeenCalled();
    expect(window.setTitleBarOverlay).not.toHaveBeenCalled();
    expect(syncNativeThemeForMaterial).toHaveBeenCalledWith("dark");
  });

  // ViscosityCode: glass off (or Lightweight) detaches the live blur.
  it("detaches vibrancy while the material is off and reattaches it live", async () => {
    const window = createWindowStub();
    const handlers = createHandlers(window);
    await handlers.setWindowChrome({ ...basePayload, materialEnabled: false });
    expect(window.setVibrancy).toHaveBeenLastCalledWith(null);
    await handlers.setWindowChrome(basePayload);
    expect(window.setVibrancy).toHaveBeenLastCalledWith("sidebar");
    expect(window.setBackgroundMaterial).not.toHaveBeenCalled();
  });

  // ViscosityCode: the window stays opaque from the moment vibrancy detaches.
  it("pairs vibrancy with an opaque base while off and transparency while on", async () => {
    const window = createWindowStub();
    const handlers = createHandlers(window);
    await handlers.setWindowChrome({ ...basePayload, materialEnabled: false });
    expect(window.setBackgroundColor).toHaveBeenLastCalledWith("#000000");
    await handlers.setWindowChrome({
      ...basePayload,
      materialEnabled: false,
      appearance: "dark",
      shownAppearance: "light",
    });
    expect(window.setBackgroundColor).toHaveBeenLastCalledWith("#fafafa");
    await handlers.setWindowChrome(basePayload);
    expect(window.setBackgroundColor).toHaveBeenLastCalledWith("#00000000");
  });

  it("never touches vibrancy on Windows", async () => {
    Object.defineProperty(process, "platform", { configurable: true, value: "win32" });
    const window = createWindowStub();
    await createHandlers(window).setWindowChrome({ ...basePayload, materialEnabled: false });
    expect(window.setVibrancy).not.toHaveBeenCalled();
  });
});
