// Modified for ViscosityCode (fork of Poracode). See FORK_CHANGES.md.
import { pathToFileURL } from "node:url";
import { registerLocalFontRenderer } from "../browser/localFontPermissions";
import type { ShellStateStore } from "../backend/BackendStateStore";
import { app, BrowserWindow, screen, type RenderProcessGoneDetails } from "electron";
import type { PoracodeChannel } from "@/shared/channel";
import type { PoracodeWindowKind } from "@/shared/ipc";
import type { RendererProcessGoneIntent } from "@/main/diagnostics/processGone";
import { installSessionPermissions } from "../browser/permissions";
import { supportsNativeWindowMaterial, syncNativeThemeForMaterial } from "./windowMaterial";
import type { WindowMaterialPreference } from "@/shared/ipc/procedures/settings";
import {
  TRANSPARENT_WINDOW_BACKGROUND,
  bindWindowMaterialPreferenceStore,
  resolveWindowsBackgroundMaterial,
  startupWindowMaterialPreference,
  windowBaseBackgroundColor,
  windowCaptionSymbolColor,
} from "./windowChromeAppearance";
import {
  buildRendererAdditionalArguments,
  installAppNavigationGuards,
  installRendererReloadGuard,
  noteRendererWindowClose,
} from "./windowHardening";
import { openDevToolsAfterStartup } from "./deferredDevTools";
import { lowPowerGraphicsArguments } from "../viscosity/system/systemInfoPreloadBridge"; // ViscosityCode:
import { rectOverlapsWorkArea } from "./windowGeometry";

interface WindowBounds {
  x?: number;
  y?: number;
  width: number;
  height: number;
  isMaximized: boolean;
}

function getSavedWindowBounds(state: ShellStateStore, stateKey: string): WindowBounds | null {
  try {
    const raw = state.get(stateKey);
    if (!raw) {
      return null;
    }
    const bounds = JSON.parse(raw) as WindowBounds;
    if (typeof bounds.width !== "number" || typeof bounds.height !== "number") {
      return null;
    }
    if (typeof bounds.x === "number" && typeof bounds.y === "number") {
      const rect = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
      const display = screen.getDisplayMatching(rect);
      if (!rectOverlapsWorkArea(rect, display.workArea)) {
        return {
          width: bounds.width,
          height: bounds.height,
          isMaximized: bounds.isMaximized,
        };
      }
    }
    return bounds;
  } catch {
    return null;
  }
}

export function saveWindowBounds(
  window: BrowserWindow,
  state: ShellStateStore,
  stateKey: string,
): void {
  if (window.isDestroyed()) return;
  state.set(stateKey, captureWindowBounds(window));
}

function captureWindowBounds(window: BrowserWindow): string {
  const isMaximized = window.isMaximized();
  const { x, y, width, height } = window.getNormalBounds();
  return JSON.stringify({ x, y, width, height, isMaximized });
}

export interface CreateMainWindowOptions {
  state: ShellStateStore;
  title: string;
  windowKind?: PoracodeWindowKind;
  boundsStateKey?: string | null;
  defaultWidth?: number;
  defaultHeight?: number;
  minWidth?: number;
  minHeight?: number;
  isDev: boolean;
  channel: PoracodeChannel;
  preloadPath: string;
  rendererHtmlPath: string;
  appVersion: string;
  posthogEnableDev: boolean;
  posthogEnabled: boolean;
  posthogHost: string;
  posthogKey: string;
  sentryEnabled: boolean;
  hostCapabilities?: import("@/shared/hostControlProtocol").HostServiceCapabilities;
  windowChromeHeight: number;
  browserUserAgent: string;
  /** Saved appearance, so the native window opens matching the theme. */
  appearance: "light" | "dark";
  /** Saved opt-in translucent ("liquid glass") sidebar, so the window opens with the material already applied. */
  sidebarTranslucency: boolean;
  /**
   * ViscosityCode: Windows backdrop preference for the first frame. Defaults to
   * the last one a renderer sent this process (else `auto`).
   */
  windowMaterial?: WindowMaterialPreference;
  onClosed(): void;
  onClose?: (event: Electron.Event) => void;
  onRendererProcessGone?: (
    details: RenderProcessGoneDetails,
    intent: RendererProcessGoneIntent | undefined,
  ) => void;
  devServerUrl?: string;
  openDevTools?: boolean;
  showOnReady?: boolean;
  /** Start window-specific host preparation before each renderer navigation. */
  beforeLoad?(window: BrowserWindow): void;
}

export function createMainWindow(options: CreateMainWindowOptions): BrowserWindow {
  const boundsStateKey =
    options.boundsStateKey === undefined ? "window-bounds" : options.boundsStateKey;
  const saved = boundsStateKey ? getSavedWindowBounds(options.state, boundsStateKey) : null;
  const supportsTitleBarOverlay = process.platform === "win32" || process.platform === "linux";
  // Base bg/symbol per appearance, matching styles.css and the runtime
  // setWindowChrome values, so the first frame doesn't flash a fixed palette.
  // ViscosityCode: ViscosityCode base colours (windowChromeAppearance.ts).
  const backgroundColor = windowBaseBackgroundColor(options.appearance);
  const symbolColor = windowCaptionSymbolColor(options.appearance);
  // macOS: always create the window transparent + vibrancy-capable so the glass
  // sidebar can be toggled live (the renderer reveals/hides it purely via CSS —
  // with glass off the opaque content simply covers the material). macOS can't
  // turn an opaque window transparent at runtime, so the capability has to exist
  // from creation. Windows acrylic is applied here for a flash-free first paint
  // when glass is already on, and toggled live via setBackgroundMaterial.
  const isMacOS = process.platform === "darwin";
  bindWindowMaterialPreferenceStore(options.state); // ViscosityCode: persisted backdrop preference.
  // ViscosityCode: the Windows backdrop follows the material preference
  // (Auto = Mica) instead of always acrylic; `none` keeps the window opaque.
  const winMaterialAtStart =
    process.platform === "win32"
      ? resolveWindowsBackgroundMaterial({
          preference: options.windowMaterial ?? startupWindowMaterialPreference(),
          translucent: options.sidebarTranslucency,
          capable: supportsNativeWindowMaterial(),
        })
      : "none";
  const winGlassAtStart = winMaterialAtStart !== "none";
  if (options.sidebarTranslucency && supportsNativeWindowMaterial()) {
    // Match the native appearance to the app theme so the material renders in the
    // right light/dark variant from the first frame.
    syncNativeThemeForMaterial(options.appearance);
  }
  const window = new BrowserWindow({
    title: options.title,
    show: false,
    width: saved?.width ?? options.defaultWidth ?? 1460,
    height: saved?.height ?? options.defaultHeight ?? 920,
    ...(saved?.x != null && saved?.y != null ? { x: saved.x, y: saved.y } : {}),
    minWidth: options.minWidth ?? 540,
    minHeight: options.minHeight ?? 720,
    backgroundColor: isMacOS || winGlassAtStart ? TRANSPARENT_WINDOW_BACKGROUND : backgroundColor,
    autoHideMenuBar: true,
    // ViscosityCode: the blur follows window focus (flat when inactive, like
    // other macOS apps); setWindowChrome detaches it while glass is off.
    ...(isMacOS
      ? {
          vibrancy: "sidebar" as const,
          visualEffectState: "followWindow" as const,
          transparent: true,
        }
      : {}),
    ...(winGlassAtStart ? { backgroundMaterial: winMaterialAtStart } : {}),
    ...(supportsTitleBarOverlay
      ? {
          titleBarStyle: "hidden" as const,
          titleBarOverlay: {
            color: TRANSPARENT_WINDOW_BACKGROUND,
            symbolColor,
            height: options.windowChromeHeight,
          },
        }
      : {
          titleBarStyle: "hiddenInset" as const,
        }),
    webPreferences: {
      preload: options.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
      additionalArguments: [
        ...buildRendererAdditionalArguments({
          appVersion: options.appVersion,
          isDev: options.isDev,
          windowKind: options.windowKind ?? "main",
          channel: options.channel,
          posthogEnableDev: options.posthogEnableDev,
          posthogEnabled: options.posthogEnabled,
          posthogHost: options.posthogHost,
          posthogKey: options.posthogKey,
          sentryEnabled: options.sentryEnabled,
          ...(options.hostCapabilities ? { hostCapabilities: options.hostCapabilities } : {}),
        }),
        // ViscosityCode: software GPU / Remote Desktop hint for Lightweight Auto.
        ...lowPowerGraphicsArguments({
          readGpuFeatureStatus: () => app.getGPUFeatureStatus(),
          platform: process.platform,
          env: process.env,
        }),
      ],
    },
  });
  if ((options.windowKind ?? "main") === "main") {
    registerLocalFontRenderer(
      window.webContents,
      options.isDev
        ? (options.devServerUrl as string)
        : pathToFileURL(options.rendererHtmlPath).href,
    );
  }
  installSessionPermissions(window.webContents.session);
  if (options.isDev && process.env.PORACODE_PROFILE_STARTUP === "1") {
    console.log(`[startup] ${Date.now()} window-created`);
    window.once("ready-to-show", () => console.log(`[startup] ${Date.now()} window-ready`));
    window.webContents.on("console-message", (details) => {
      if (details.message.startsWith("[renderer") || details.message.startsWith("[startup]")) {
        console.log(`[startup] ${Date.now()} ${details.message}`);
      }
    });
  }
  window.webContents.setUserAgent(options.browserUserAgent);

  installAppNavigationGuards(window, {
    isDev: options.isDev,
    allowDevicePreviewWindow: (options.windowKind ?? "main") === "main",
    ...(options.devServerUrl ? { devServerUrl: options.devServerUrl } : {}),
  });
  // `webviewTag` is enabled for the in-app browser; the embedding renderer
  // controls each <webview>'s attributes, so enforce that no webview can
  // request a preload or Node access regardless of what markup is injected.
  window.webContents.on("will-attach-webview", (_event, webPreferences) => {
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
  });

  window.once("ready-to-show", () => {
    if (saved?.isMaximized) {
      // Electron's maximize() also shows the window; defer it until the first
      // real show so a hidden start stays hidden.
      if (options.showOnReady !== false || window.isVisible()) {
        window.maximize();
      } else {
        window.once("show", () => window.maximize());
      }
    }
    if (options.showOnReady !== false) window.show();
  });

  const loadRenderer = () => {
    options.beforeLoad?.(window);
    if (options.isDev) {
      void window.loadURL(options.devServerUrl as string);
    } else {
      void window.loadFile(options.rendererHtmlPath);
    }
  };

  loadRenderer();
  if (options.isDev && options.openDevTools !== false) {
    // Only the main app reports startup ready (the quick-composer ready ping).
    if ((options.windowKind ?? "main") === "main") openDevToolsAfterStartup(window.webContents);
    else window.webContents.openDevTools({ mode: "detach" });
  }

  installRendererReloadGuard(window, {
    loadRenderer,
    ...(options.onRendererProcessGone
      ? { onRendererProcessGone: options.onRendererProcessGone }
      : {}),
  });

  let boundsTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingBounds: string | null = null;
  const flushBounds = () => {
    if (boundsTimer) clearTimeout(boundsTimer);
    boundsTimer = null;
    if (boundsStateKey && pendingBounds !== null) {
      options.state.set(boundsStateKey, pendingBounds);
      pendingBounds = null;
    }
  };
  const debouncedSave = () => {
    if (!boundsStateKey || window.isDestroyed()) return;
    pendingBounds = captureWindowBounds(window);
    if (boundsTimer) clearTimeout(boundsTimer);
    boundsTimer = setTimeout(flushBounds, 500);
  };
  window.on("resize", debouncedSave);
  window.on("move", debouncedSave);
  window.on("maximize", debouncedSave);
  window.on("unmaximize", debouncedSave);
  window.on("close", (event) => {
    if (boundsStateKey) pendingBounds = captureWindowBounds(window);
    flushBounds();
    options.onClose?.(event);
    noteRendererWindowClose(window, event);
  });
  window.on("closed", () => {
    flushBounds();
    options.onClosed();
  });

  return window;
}
