// Modified for ViscosityCode (fork of Poracode). See FORK_CHANGES.md.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const installSessionPermissions = vi.hoisted(() => vi.fn<() => void>());
const dbGetState = vi.hoisted(() => vi.fn<(key: string) => string | null>(() => null));
const getGpuFeatureStatus = vi.hoisted(() =>
  vi.fn<() => { gpu_compositing?: string }>(() => ({ gpu_compositing: "enabled" })),
);
const dbSetState = vi.hoisted(() => vi.fn<() => void>());
const setUserAgent = vi.hoisted(() => vi.fn<(userAgent: string) => void>());
const openDevToolsAfterStartup = vi.hoisted(() => vi.fn<() => void>());
const supportsNativeWindowMaterial = vi.hoisted(() => vi.fn<() => boolean>(() => false));
const syncNativeThemeForMaterial = vi.hoisted(() => vi.fn<(appearance: string) => void>());

let browserWindowOptions: Record<string, unknown> | null = null;
let webContentsHandlers: Record<string, (...args: never[]) => void> = {};
let windowHandlers: Record<string, (...args: never[]) => void> = {};
let windowOnceHandlers: Record<string, (...args: never[]) => void> = {};

vi.mock("electron", () => ({
  app: { getGPUFeatureStatus: getGpuFeatureStatus },
  BrowserWindow: class BrowserWindow {
    webContents = {
      session: {},
      send: vi.fn<() => void>(),
      openDevTools: vi.fn<() => void>(),
      setWindowOpenHandler: vi.fn<() => void>(),
      setUserAgent,
      on: vi.fn<(event: string, handler: (...args: never[]) => void) => void>((event, handler) => {
        webContentsHandlers[event] = handler;
      }),
    };

    constructor(options: Record<string, unknown>) {
      browserWindowOptions = options;
    }

    once = vi.fn<(event: string, handler: (...args: never[]) => void) => void>((event, handler) => {
      windowOnceHandlers[event] = handler;
    });
    on = vi.fn<(event: string, handler: (...args: never[]) => void) => void>((event, handler) => {
      windowHandlers[event] = handler;
    });
    isMaximized = vi.fn<() => boolean>(() => false);
    isVisible = vi.fn<() => boolean>(() => false);
    isDestroyed = vi.fn<() => boolean>(() => false);
    getNormalBounds = vi.fn<() => { x: number; y: number; width: number; height: number }>(() => ({
      x: 0,
      y: 0,
      width: 1460,
      height: 920,
    }));
    loadURL = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    loadFile = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    show = vi.fn<() => void>();
    maximize = vi.fn<() => void>();
  },
  screen: {
    getDisplayMatching: vi.fn<
      () => { workArea: { x: number; y: number; width: number; height: number } }
    >(() => ({
      workArea: { x: 0, y: 0, width: 1920, height: 1080 },
    })),
  },
}));

vi.mock("@/host/db", () => ({
  dbGetState,
  dbSetState,
}));

vi.mock("./deferredDevTools", () => ({
  openDevToolsAfterStartup,
}));

vi.mock("../browser/permissions", () => ({
  installSessionPermissions,
}));

vi.mock("./windowMaterial", () => ({
  supportsNativeWindowMaterial,
  syncNativeThemeForMaterial,
}));

describe("createMainWindow", () => {
  afterEach(() => vi.useRealTimers());

  beforeEach(() => {
    vi.clearAllMocks();
    browserWindowOptions = null;
    webContentsHandlers = {};
    windowHandlers = {};
    windowOnceHandlers = {};
  });

  it("applies the browser user agent to the window and sanitizes attached webviews", async () => {
    const { createMainWindow } = await import("./createMainWindow");
    const userAgent =
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

    createMainWindow({
      state: { get: dbGetState, set: dbSetState },
      title: "Poracode",
      isDev: false,
      channel: "stable",
      preloadPath: "/tmp/preload.cjs",
      rendererHtmlPath: "/tmp/index.html",
      appVersion: "1.2.1",
      posthogEnableDev: false,
      posthogEnabled: false,
      posthogHost: "",
      posthogKey: "",
      sentryEnabled: false,
      windowChromeHeight: 32,
      browserUserAgent: userAgent,
      appearance: "dark",
      sidebarTranslucency: false,
      onClosed: vi.fn<() => void>(),
    });

    expect(setUserAgent).toHaveBeenCalledWith(userAgent);
    expect((browserWindowOptions?.webPreferences as { webviewTag?: boolean })?.webviewTag).toBe(
      true,
    );

    const webPreferences = {
      preload: "/tmp/unsafe.cjs",
      nodeIntegration: true,
      contextIsolation: false,
    };
    webContentsHandlers["will-attach-webview"]?.({} as never, webPreferences as never);

    expect(webPreferences.preload).toBeUndefined();
    expect(webPreferences.nodeIntegration).toBe(false);
    expect(webPreferences.contextIsolation).toBe(true);
  });

  it("supplies window-close intent only when the app does not prevent the close", async () => {
    const { createMainWindow } = await import("./createMainWindow");
    let preventClose = true;
    const onRendererProcessGone =
      vi.fn<
        (
          details: Electron.RenderProcessGoneDetails,
          intent: "app-shutdown" | "reload" | "window-close" | undefined,
        ) => void
      >();
    createMainWindow({
      state: { get: dbGetState, set: dbSetState },
      title: "Poracode",
      isDev: false,
      channel: "stable",
      preloadPath: "/tmp/preload.cjs",
      rendererHtmlPath: "/tmp/index.html",
      appVersion: "1.2.1",
      posthogEnableDev: false,
      posthogEnabled: false,
      posthogHost: "",
      posthogKey: "",
      sentryEnabled: false,
      windowChromeHeight: 32,
      browserUserAgent: "Poracode",
      appearance: "dark",
      sidebarTranslucency: false,
      onClosed: vi.fn<() => void>(),
      onClose(event) {
        if (preventClose) event.preventDefault();
      },
      onRendererProcessGone,
    });
    const killed = {
      reason: "killed",
      exitCode: 9,
    } satisfies Electron.RenderProcessGoneDetails;
    const closeEvent = {
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
    };

    windowHandlers.close?.(closeEvent as never);
    webContentsHandlers["render-process-gone"]?.({} as never, killed as never);
    preventClose = false;
    closeEvent.defaultPrevented = false;
    windowHandlers.close?.(closeEvent as never);
    webContentsHandlers["render-process-gone"]?.({} as never, killed as never);

    expect(onRendererProcessGone.mock.calls).toEqual([
      [killed, undefined],
      [killed, "window-close"],
    ]);
  });

  it("starts host preparation before loading the renderer and repeats it on crash reload", async () => {
    const { createMainWindow } = await import("./createMainWindow");
    const beforeLoad = vi.fn<(window: import("electron").BrowserWindow) => void>((window) => {
      expect(vi.mocked(window.loadFile).mock.calls.length).toBe(beforeLoad.mock.calls.length - 1);
    });
    const window = createMainWindow({
      state: { get: dbGetState, set: dbSetState },
      title: "Poracode",
      isDev: false,
      channel: "stable",
      preloadPath: "/tmp/preload.cjs",
      rendererHtmlPath: "/tmp/index.html",
      appVersion: "1.2.1",
      posthogEnableDev: false,
      posthogEnabled: false,
      posthogHost: "",
      posthogKey: "",
      sentryEnabled: false,
      windowChromeHeight: 32,
      browserUserAgent: "Poracode",
      appearance: "dark",
      sidebarTranslucency: false,
      onClosed: () => {},
      beforeLoad,
    });
    expect(beforeLoad).toHaveBeenCalledExactlyOnceWith(window);
    expect(window.loadFile).toHaveBeenCalledExactlyOnceWith("/tmp/index.html");
    webContentsHandlers["render-process-gone"]?.(
      {} as never,
      { reason: "crashed", exitCode: 1 } as never,
    );
    expect(beforeLoad).toHaveBeenCalledTimes(2);
    expect(window.loadFile).toHaveBeenCalledTimes(2);
  });

  it("persists the last resize when destruction bypasses close without reading a dead window", async () => {
    vi.useFakeTimers();
    const { createMainWindow } = await import("./createMainWindow");
    const onClosed = vi.fn<() => void>();
    const window = createMainWindow({
      state: { get: dbGetState, set: dbSetState },
      title: "Poracode",
      isDev: false,
      channel: "stable",
      preloadPath: "/tmp/preload.cjs",
      rendererHtmlPath: "/tmp/index.html",
      appVersion: "1.2.1",
      posthogEnableDev: false,
      posthogEnabled: false,
      posthogHost: "",
      posthogKey: "",
      sentryEnabled: false,
      windowChromeHeight: 32,
      browserUserAgent: "Poracode",
      appearance: "dark",
      sidebarTranslucency: false,
      onClosed,
    });
    windowHandlers.resize?.();
    const bounds = { x: 134, y: 35, width: 1206, height: 824 };
    vi.mocked(window.getNormalBounds).mockReturnValue(bounds);
    windowHandlers.resize?.();
    expect(dbSetState).not.toHaveBeenCalled();
    vi.mocked(window.isDestroyed).mockReturnValue(true);
    vi.mocked(window.getNormalBounds).mockImplementation(() => {
      throw new Error("Object has been destroyed");
    });
    windowHandlers.closed?.();
    windowHandlers.resize?.();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(dbSetState).toHaveBeenCalledExactlyOnceWith(
      "window-bounds",
      JSON.stringify({ ...bounds, isMaximized: false }),
    );
    expect(onClosed).toHaveBeenCalledOnce();
  });

  async function createWindowWithSavedMaximizedBounds(showOnReady: boolean) {
    const { createMainWindow } = await import("./createMainWindow");
    dbGetState.mockReturnValue(
      JSON.stringify({ x: 0, y: 0, width: 1200, height: 800, isMaximized: true }),
    );
    return createMainWindow({
      state: { get: dbGetState, set: dbSetState },
      title: "Poracode",
      isDev: false,
      channel: "stable",
      preloadPath: "/tmp/preload.cjs",
      rendererHtmlPath: "/tmp/index.html",
      appVersion: "1.2.1",
      posthogEnableDev: false,
      posthogEnabled: false,
      posthogHost: "",
      posthogKey: "",
      sentryEnabled: false,
      windowChromeHeight: 32,
      browserUserAgent: "Poracode",
      appearance: "dark",
      sidebarTranslucency: false,
      showOnReady,
      onClosed: vi.fn<() => void>(),
    });
  }

  it.each([
    ["main", true],
    ["sideChat", false],
  ] as const)(
    "in dev, a %s window defers DevTools until startup: %s",
    async (windowKind, deferred) => {
      const { createMainWindow } = await import("./createMainWindow");
      // DevTools attached during the first load roughly doubled the dev time
      // to first render; only the main app reports when its startup is done.
      const window = createMainWindow({
        state: { get: dbGetState, set: dbSetState },
        title: "Poracode",
        isDev: true,
        devServerUrl: "http://127.0.0.1:3100/",
        windowKind,
        channel: "stable",
        preloadPath: "/tmp/preload.cjs",
        rendererHtmlPath: "/tmp/index.html",
        appVersion: "1.2.1",
        posthogEnableDev: false,
        posthogEnabled: false,
        posthogHost: "",
        posthogKey: "",
        sentryEnabled: false,
        windowChromeHeight: 32,
        browserUserAgent: "Poracode",
        appearance: "dark",
        sidebarTranslucency: false,
        onClosed: vi.fn<() => void>(),
      });

      expect(openDevToolsAfterStartup).toHaveBeenCalledTimes(deferred ? 1 : 0);
      expect(window.webContents.openDevTools).toHaveBeenCalledTimes(deferred ? 0 : 1);
    },
  );

  it("defers the saved-bounds maximize until the first show on a hidden start", async () => {
    const window = await createWindowWithSavedMaximizedBounds(false);

    windowOnceHandlers["ready-to-show"]?.({} as never);

    expect(window.maximize).not.toHaveBeenCalled();
    expect(window.show).not.toHaveBeenCalled();
    expect(window.once).toHaveBeenCalledWith("show", expect.any(Function));

    windowOnceHandlers["show"]?.({} as never);

    expect(window.maximize).toHaveBeenCalledOnce();
  });

  it("maximizes and shows on ready when the window shows on ready", async () => {
    const window = await createWindowWithSavedMaximizedBounds(true);

    windowOnceHandlers["ready-to-show"]?.({} as never);

    expect(window.maximize).toHaveBeenCalledOnce();
    expect(window.show).toHaveBeenCalledOnce();
  });
});

// ViscosityCode: startup colours and the Windows backdrop preference.
describe("createMainWindow native chrome", () => {
  const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");

  beforeEach(() => {
    vi.clearAllMocks();
    browserWindowOptions = null;
    dbGetState.mockReturnValue(null);
    supportsNativeWindowMaterial.mockReturnValue(false);
    getGpuFeatureStatus.mockReturnValue({ gpu_compositing: "enabled" });
  });

  afterEach(async () => {
    if (platformDescriptor) Object.defineProperty(process, "platform", platformDescriptor);
    const { resetRememberedWindowMaterialPreferenceForTests } =
      await import("./windowChromeAppearance");
    resetRememberedWindowMaterialPreferenceForTests();
  });

  async function createOnPlatform(
    platform: NodeJS.Platform,
    overrides: {
      appearance: "light" | "dark";
      sidebarTranslucency: boolean;
      windowMaterial?: "auto" | "mica" | "acrylic" | "none";
      windowKind?: "main" | "thread" | "sideChat" | "browserExtract";
    },
  ) {
    Object.defineProperty(process, "platform", { configurable: true, value: platform });
    const { createMainWindow } = await import("./createMainWindow");
    createMainWindow({
      state: { get: dbGetState, set: dbSetState },
      title: "ViscosityCode",
      isDev: false,
      channel: "stable",
      preloadPath: "/tmp/preload.cjs",
      rendererHtmlPath: "/tmp/index.html",
      appVersion: "1.2.1",
      posthogEnableDev: false,
      posthogEnabled: false,
      posthogHost: "",
      posthogKey: "",
      sentryEnabled: false,
      windowChromeHeight: 32,
      browserUserAgent: "ViscosityCode",
      onClosed: vi.fn<() => void>(),
      ...overrides,
    });
    return browserWindowOptions ?? {};
  }

  it.each([
    ["dark", "#000000", "#fafafa"],
    ["light", "#fafafa", "#1f2937"],
  ] as const)(
    "paints the %s first frame in the base colour with OS caption buttons",
    async (appearance, background, symbolColor) => {
      const options = await createOnPlatform("win32", { appearance, sidebarTranslucency: false });
      expect(options.backgroundColor).toBe(background);
      expect(options.backgroundMaterial).toBeUndefined();
      expect(options.titleBarStyle).toBe("hidden");
      expect(options.titleBarOverlay).toEqual({ color: "#00000000", symbolColor, height: 32 });
    },
  );

  it("starts a translucent Windows 11 window with Mica for the default Auto preference", async () => {
    supportsNativeWindowMaterial.mockReturnValue(true);
    const options = await createOnPlatform("win32", {
      appearance: "dark",
      sidebarTranslucency: true,
    });
    expect(options.backgroundMaterial).toBe("mica");
    expect(options.backgroundColor).toBe("#00000000");
  });

  it("starts with the remembered preference, and None stays opaque", async () => {
    supportsNativeWindowMaterial.mockReturnValue(true);
    const { rememberWindowMaterialPreference } = await import("./windowChromeAppearance");
    rememberWindowMaterialPreference("acrylic");
    expect(
      (await createOnPlatform("win32", { appearance: "dark", sidebarTranslucency: true }))
        .backgroundMaterial,
    ).toBe("acrylic");

    const none = await createOnPlatform("win32", {
      appearance: "dark",
      sidebarTranslucency: true,
      windowMaterial: "none",
    });
    expect(none.backgroundMaterial).toBeUndefined();
    expect(none.backgroundColor).toBe("#000000");
  });

  it("opens a cold launch with the persisted preference instead of Auto (Mica)", async () => {
    supportsNativeWindowMaterial.mockReturnValue(true);
    dbGetState.mockImplementation((key) =>
      key === "viscosity-window-material-v1" ? "none" : null,
    );
    const options = await createOnPlatform("win32", {
      appearance: "dark",
      sidebarTranslucency: true,
    });
    expect(options.backgroundMaterial).toBeUndefined();
    expect(options.backgroundColor).toBe("#000000");
  });

  it("tells the renderer about software compositing for Lightweight Auto", async () => {
    const argumentsOf = (options: Record<string, unknown>) =>
      (options.webPreferences as { additionalArguments: string[] }).additionalArguments;
    expect(
      argumentsOf(
        await createOnPlatform("darwin", { appearance: "dark", sidebarTranslucency: true }),
      ),
    ).not.toContain("--vc-low-power-graphics");
    getGpuFeatureStatus.mockReturnValue({ gpu_compositing: "disabled_software" });
    // macOS keeps its memory-only Auto.
    expect(
      argumentsOf(
        await createOnPlatform("darwin", { appearance: "dark", sidebarTranslucency: true }),
      ),
    ).not.toContain("--vc-low-power-graphics");
    expect(
      argumentsOf(
        await createOnPlatform("win32", { appearance: "dark", sidebarTranslucency: true }),
      ),
    ).toContain("--vc-low-power-graphics");
  });

  it("applies no material on Windows builds without the capability", async () => {
    supportsNativeWindowMaterial.mockReturnValue(false);
    const options = await createOnPlatform("win32", {
      appearance: "light",
      sidebarTranslucency: true,
      windowMaterial: "mica",
    });
    expect(options.backgroundMaterial).toBeUndefined();
    expect(options.backgroundColor).toBe("#fafafa");
  });

  it.each(["thread", "sideChat", "browserExtract"] as const)(
    "builds a %s window from the same factory",
    async (windowKind) => {
      supportsNativeWindowMaterial.mockReturnValue(true);
      const options = await createOnPlatform("win32", {
        appearance: "dark",
        sidebarTranslucency: windowKind === "browserExtract",
        windowKind,
      });
      expect(options.titleBarStyle).toBe("hidden");
      expect(options.backgroundMaterial).toBe(windowKind === "browserExtract" ? "mica" : undefined);
    },
  );

  it("keeps macOS hidden-inset vibrancy without a Windows material", async () => {
    supportsNativeWindowMaterial.mockReturnValue(true);
    const options = await createOnPlatform("darwin", {
      appearance: "dark",
      sidebarTranslucency: true,
      windowMaterial: "mica",
    });
    expect(options.titleBarStyle).toBe("hiddenInset");
    expect(options.vibrancy).toBe("sidebar");
    expect(options.visualEffectState).toBe("followWindow"); // ViscosityCode: inactive windows go flat.
    expect(options.transparent).toBe(true);
    expect(options.backgroundColor).toBe("#00000000");
    expect(options.backgroundMaterial).toBeUndefined();
    expect(options.trafficLightPosition).toBeUndefined();
    expect(syncNativeThemeForMaterial).toHaveBeenCalledWith("dark");
  });
});
