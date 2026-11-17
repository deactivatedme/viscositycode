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
    expect(window.setBackgroundColor).toHaveBeenCalledExactlyOnceWith("#f4f4f5");
  });

  it("reports no native material for None so the renderer keeps its CSS tint", async () => {
    const window = createWindowStub();
    const result = await createHandlers(window).setWindowChrome({
      ...basePayload,
      windowMaterial: "none",
    });
    expect(result).toEqual({ nativeCapable: false });
    expect(window.setBackgroundMaterial).toHaveBeenCalledExactlyOnceWith("none");
    expect(window.setBackgroundColor).toHaveBeenCalledExactlyOnceWith("#0a0a0b");
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
    expect(window.setBackgroundColor).toHaveBeenCalledExactlyOnceWith("#0a0a0b");
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

  it("leaves vibrancy to CSS and ignores the Windows-only preference", async () => {
    const window = createWindowStub();
    const result = await createHandlers(window).setWindowChrome({
      ...basePayload,
      windowMaterial: "none",
    });
    expect(result).toEqual({ nativeCapable: true });
    expect(window.setBackgroundMaterial).not.toHaveBeenCalled();
    expect(window.setTitleBarOverlay).not.toHaveBeenCalled();
    expect(syncNativeThemeForMaterial).toHaveBeenCalledWith("dark");
  });
});
