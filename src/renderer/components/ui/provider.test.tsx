// Modified for ViscosityCode (fork of Poracode). See FORK_CHANGES.md.
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "@heroui/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ThemeMode } from "@/shared/contracts";

const settingsState: {
  themeMode: ThemeMode;
  themePreset: string;
  sidebarTranslucency: boolean;
  customThemes: import("@/shared/customThemes").CustomTheme[];
  sidebarGlassTint: { light: number | null; dark: number | null };
} = {
  themeMode: "system",
  themePreset: "default",
  sidebarTranslucency: false,
  customThemes: [],
  sidebarGlassTint: { light: null, dark: null },
};

const runtime = vi.hoisted(() => ({ browser: false, remote: false }));
const setWindowChrome = vi.hoisted(() =>
  vi.fn<(payload: Record<string, unknown>) => Promise<{ nativeCapable: boolean }>>(),
);

vi.mock("../../state/sharedSettingsStore", () => ({
  useSharedSettings: (selector: (s: typeof settingsState) => unknown) => selector(settingsState),
}));

vi.mock("@/renderer/bridge", () => ({
  isMac: () => false,
  isRemoteSession: () => runtime.remote,
  isWindows: () => false,
  readBridge: () => ({ setWindowChrome }),
}));

vi.mock("@/renderer/clientRuntime", () => ({
  hasElectronHostBridge: () => !runtime.browser,
  isBrowserClientRuntime: () => runtime.browser,
}));

// ViscosityCode: spy on the frosting tint the provider applies.
const applySidebarGlassTint = vi.hoisted(() =>
  vi.fn<(root: HTMLElement, override: number | null, enabled: boolean) => void>(),
);
vi.mock("@/renderer/theme/sidebarGlass", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/renderer/theme/sidebarGlass")>()),
  applySidebarGlassTint,
}));

import { AppProvider, useResolvedAppearance, useThemeModeAppearance } from "./provider";
import { setAppThemeOverride } from "@/renderer/theme/applyAppTheme";
import { setWindowMaterialPreference } from "@/renderer/viscosity/windowMaterial/windowMaterialStore";
import { usePerformanceSettings } from "@/renderer/viscosity/performance/performanceSettingsStore";
import { resetLowMemoryCacheForTests } from "@/renderer/viscosity/performance/lightweight";

function setMatchMedia(prefersDark: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      // Only the colour-scheme queries match; reduced transparency stays off.
      matches: query.includes("dark") ? prefersDark : query.includes("light") && !prefersDark,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

beforeEach(() => {
  setWindowChrome.mockResolvedValue({ nativeCapable: true });
  settingsState.themeMode = "system";
  settingsState.themePreset = "default";
  settingsState.sidebarTranslucency = false;
  runtime.browser = false;
  runtime.remote = false;
  settingsState.customThemes = [];
  document.documentElement.classList.remove("light", "dark");
  delete document.documentElement.dataset.sidebarGlass;
  delete document.documentElement.dataset.nativeMaterial;
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.themePreset;
  setMatchMedia(true);
});

afterEach(() => {
  toast.clear();
  // Restore the testSetup default matchMedia stub so other tests behave.
  setMatchMedia(true);
});

describe("AppProvider", () => {
  it("renders children", () => {
    render(
      <AppProvider>
        <div>provider works</div>
      </AppProvider>,
    );
    expect(screen.getByText("provider works")).toBeInTheDocument();
  });

  it("uses faux sidebar glass by default in the browser", async () => {
    runtime.browser = true;
    runtime.remote = true;

    render(
      <AppProvider contentReady>
        <span />
      </AppProvider>,
    );

    await waitFor(() => {
      expect(document.documentElement.dataset.sidebarGlass).toBe("on");
      expect(document.documentElement.dataset.nativeMaterial).toBe("off");
    });
  });

  it("uses a bounded responsive toast width", async () => {
    render(
      <AppProvider>
        <span />
      </AppProvider>,
    );

    act(() => {
      toast("Width test");
    });

    await waitFor(() => {
      const region = document.querySelector('[data-slot="toast-region"]');
      expect(region).toHaveClass("lc-toast-region");
      expect(region).toHaveStyle({
        "--toast-width": "min(32rem, calc(100vw - 2rem))",
      });
    });
  });

  it("marks long toast descriptions as a bounded scrolling region", async () => {
    render(
      <AppProvider>
        <span />
      </AppProvider>,
    );

    act(() => {
      toast("Bounded toast", {
        description: Array.from({ length: 100 }, (_, index) => `Description line ${index}`).join(
          "\n",
        ),
        timeout: 0,
      });
    });

    await waitFor(() => {
      expect(document.querySelector('[data-slot="toast-description"]')).toHaveClass(
        "lc-toast__description",
      );
      expect(document.querySelector('[data-slot="toast"]')).toHaveClass("lc-toast");
    });
  });

  it.each([
    ["down", { clientX: 100, clientY: 170 }],
    ["left", { clientX: 30, clientY: 100 }],
    ["right", { clientX: 170, clientY: 100 }],
  ])("dismisses a toast with a touch swipe %s", async (_direction, end) => {
    render(
      <AppProvider>
        <span />
      </AppProvider>,
    );
    act(() => {
      toast("Swipe test", { timeout: 0 });
    });

    const toastElement = await screen
      .findByText("Swipe test")
      .then((title) => title.closest('[data-slot="toast"]'));
    expect(toastElement).not.toBeNull();
    Object.defineProperty(toastElement, "setPointerCapture", {
      value: vi.fn<(pointerId: number) => void>(),
    });

    fireEvent.pointerDown(toastElement!, {
      pointerId: 1,
      pointerType: "touch",
      isPrimary: true,
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerMove(toastElement!, { pointerId: 1, pointerType: "touch", ...end });
    fireEvent.pointerUp(toastElement!, { pointerId: 1, pointerType: "touch", ...end });

    await waitFor(() => {
      expect(screen.queryByText("Swipe test")).not.toBeInTheDocument();
    });
  });

  it("keeps a toast for upward, short, and mouse drags", async () => {
    render(
      <AppProvider>
        <span />
      </AppProvider>,
    );
    act(() => {
      toast("Keep test", { timeout: 0 });
    });

    const toastElement = await screen
      .findByText("Keep test")
      .then((title) => title.closest('[data-slot="toast"]'));
    expect(toastElement).not.toBeNull();
    Object.defineProperty(toastElement, "setPointerCapture", {
      value: vi.fn<(pointerId: number) => void>(),
    });

    fireEvent.pointerDown(toastElement!, {
      pointerId: 1,
      pointerType: "touch",
      isPrimary: true,
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerMove(toastElement!, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 100,
      clientY: 20,
    });
    fireEvent.pointerUp(toastElement!, { pointerId: 1, pointerType: "touch" });

    fireEvent.pointerDown(toastElement!, {
      pointerId: 2,
      pointerType: "touch",
      isPrimary: true,
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerMove(toastElement!, {
      pointerId: 2,
      pointerType: "touch",
      clientX: 140,
      clientY: 140,
    });
    fireEvent.pointerUp(toastElement!, { pointerId: 2, pointerType: "touch" });

    fireEvent.pointerDown(toastElement!, {
      pointerId: 3,
      pointerType: "mouse",
      isPrimary: true,
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerMove(toastElement!, {
      pointerId: 3,
      pointerType: "mouse",
      clientX: 200,
      clientY: 200,
    });
    fireEvent.pointerUp(toastElement!, { pointerId: 3, pointerType: "mouse" });

    expect(screen.getByText("Keep test")).toBeInTheDocument();
  });

  it("applies dark class + data-theme when themeMode is explicit 'dark'", () => {
    settingsState.themeMode = "dark";
    render(
      <AppProvider>
        <span />
      </AppProvider>,
    );
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.dataset.themePreset).toBe("default");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.classList.contains("light")).toBe(false);
  });

  it("applies light class + data-theme when themeMode is explicit 'light'", () => {
    settingsState.themeMode = "light";
    render(
      <AppProvider>
        <span />
      </AppProvider>,
    );
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("follows the system preference when themeMode is 'system' (dark)", () => {
    settingsState.themeMode = "system";
    setMatchMedia(true);
    render(
      <AppProvider>
        <span />
      </AppProvider>,
    );
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("follows the system preference when themeMode is 'system' (light)", () => {
    settingsState.themeMode = "system";
    setMatchMedia(false);
    render(
      <AppProvider>
        <span />
      </AppProvider>,
    );
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  // ViscosityCode: Monaco and xterm read this context, so it must go dark when
  // a dark-only playbook theme switches in, and back when it switches out.
  it("reports the shown appearance while a dark-only theme override is active", () => {
    settingsState.themeMode = "light";
    function Probe() {
      return <span data-testid="appearance">{useResolvedAppearance()}</span>;
    }
    try {
      render(
        <AppProvider>
          <Probe />
        </AppProvider>,
      );
      expect(screen.getByTestId("appearance").textContent).toBe("light");

      act(() => setAppThemeOverride("hostile-binary"));
      expect(screen.getByTestId("appearance").textContent).toBe("dark");
      expect(document.documentElement.classList.contains("dark")).toBe(true);
      // The boot cache keeps the user's own appearance.
      expect(JSON.parse(localStorage.getItem("poracode-boot") ?? "{}").appearance).toBe("light");

      act(() => setAppThemeOverride(null));
      expect(screen.getByTestId("appearance").textContent).toBe("light");
      expect(document.documentElement.classList.contains("light")).toBe(true);
    } finally {
      act(() => setAppThemeOverride(null));
    }
  });

  // ViscosityCode: Settings theme previews must keep showing the variant a preset
  // gets in the user's Mode, not the dark one a playbook override forces.
  it("keeps the mode appearance for Settings previews while a dark-only override is active", () => {
    settingsState.themeMode = "light";
    function Probe() {
      return <span data-testid="mode-appearance">{useThemeModeAppearance()}</span>;
    }
    try {
      render(
        <AppProvider>
          <Probe />
        </AppProvider>,
      );
      act(() => setAppThemeOverride("hostile-binary"));
      expect(document.documentElement.classList.contains("dark")).toBe(true);
      expect(screen.getByTestId("mode-appearance").textContent).toBe("light");
    } finally {
      act(() => setAppThemeOverride(null));
    }
  });

  // ViscosityCode: title-bar symbols follow the shown appearance; in an explicit
  // mode the native theme does too.
  it("sends the shown appearance to the window chrome while an override is active", async () => {
    Object.defineProperty(window, "poracode", { configurable: true, value: {} });
    settingsState.themeMode = "light";
    try {
      render(
        <AppProvider contentReady>
          <span />
        </AppProvider>,
      );
      await waitFor(() => {
        expect(setWindowChrome).toHaveBeenLastCalledWith(
          expect.objectContaining({ appearance: "light", symbolColor: "#1f2937" }),
        );
      });

      act(() => setAppThemeOverride("hostile-binary"));
      await waitFor(() => {
        expect(setWindowChrome).toHaveBeenLastCalledWith(
          expect.objectContaining({ appearance: "dark", symbolColor: "#fafafa" }),
        );
      });

      act(() => setAppThemeOverride(null));
      await waitFor(() => {
        expect(setWindowChrome).toHaveBeenLastCalledWith(
          expect.objectContaining({ appearance: "light", symbolColor: "#1f2937" }),
        );
      });
    } finally {
      act(() => setAppThemeOverride(null));
      Reflect.deleteProperty(window, "poracode");
    }
  });

  // ViscosityCode: main mirrors the payload appearance into nativeTheme.themeSource,
  // which drives prefers-color-scheme. In system mode an override must not feed
  // back into the OS preference the provider reads.
  it("keeps a light OS light in system mode after a dark-only override", async () => {
    const listeners = new Set<(event: MediaQueryListEvent) => void>();
    let nativeDark = false;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: (query: string) => ({
        get matches() {
          return query.includes("color-scheme: dark") ? nativeDark : false;
        },
        media: query,
        onchange: null,
        addEventListener: (_: string, cb: (event: MediaQueryListEvent) => void) => {
          if (query.includes("color-scheme")) listeners.add(cb);
        },
        removeEventListener: (_: string, cb: (event: MediaQueryListEvent) => void) => {
          listeners.delete(cb);
        },
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      }),
    });
    // Simulate the main process: an applied material sets themeSource from the payload.
    setWindowChrome.mockImplementation(async (payload) => {
      const dark = payload.appearance === "dark";
      if (payload.materialEnabled && dark !== nativeDark) {
        nativeDark = dark;
        queueMicrotask(() => {
          for (const cb of listeners) cb({ matches: dark } as MediaQueryListEvent);
        });
      }
      return { nativeCapable: true };
    });
    Object.defineProperty(window, "poracode", { configurable: true, value: {} });
    settingsState.themeMode = "system";
    settingsState.sidebarTranslucency = true;
    function Probe() {
      return <span data-testid="appearance">{useResolvedAppearance()}</span>;
    }
    try {
      render(
        <AppProvider contentReady>
          <Probe />
        </AppProvider>,
      );
      expect(screen.getByTestId("appearance").textContent).toBe("light");

      act(() => setAppThemeOverride("hostile-binary"));
      await waitFor(() => {
        expect(setWindowChrome).toHaveBeenLastCalledWith(
          expect.objectContaining({ appearance: "light", symbolColor: "#fafafa" }),
        );
      });
      expect(screen.getByTestId("appearance").textContent).toBe("dark");

      act(() => setAppThemeOverride(null));
      await waitFor(() => {
        expect(setWindowChrome).toHaveBeenLastCalledWith(
          expect.objectContaining({ appearance: "light", symbolColor: "#1f2937" }),
        );
      });
      expect(nativeDark).toBe(false);
      expect(screen.getByTestId("appearance").textContent).toBe("light");
      expect(document.documentElement.classList.contains("light")).toBe(true);
      expect(JSON.parse(localStorage.getItem("poracode-boot") ?? "{}").appearance).toBe("light");
    } finally {
      act(() => setAppThemeOverride(null));
      setWindowChrome.mockReset();
      Reflect.deleteProperty(window, "poracode");
    }
  });

  // ViscosityCode: the native material cannot follow a dark-only theme in system
  // mode on a light OS, so it is turned off and the opaque base paints dark.
  it("drops the native material while a dark-only theme shows over a light OS in system mode", async () => {
    Object.defineProperty(window, "poracode", { configurable: true, value: {} });
    settingsState.themeMode = "system";
    settingsState.sidebarTranslucency = true;
    setMatchMedia(false);
    try {
      render(
        <AppProvider contentReady>
          <span />
        </AppProvider>,
      );
      await waitFor(() => {
        expect(setWindowChrome).toHaveBeenLastCalledWith(
          expect.objectContaining({
            materialEnabled: true,
            appearance: "light",
            shownAppearance: "light",
          }),
        );
      });
      expect(document.documentElement.dataset.nativeMaterial).toBe("on");

      act(() => setAppThemeOverride("hostile-binary"));
      await waitFor(() => {
        expect(setWindowChrome).toHaveBeenLastCalledWith(
          expect.objectContaining({
            materialEnabled: false,
            appearance: "light",
            shownAppearance: "dark",
          }),
        );
        expect(document.documentElement.dataset.nativeMaterial).toBe("off");
      });

      act(() => setAppThemeOverride(null));
      await waitFor(() => {
        expect(setWindowChrome).toHaveBeenLastCalledWith(
          expect.objectContaining({ materialEnabled: true, shownAppearance: "light" }),
        );
        expect(document.documentElement.dataset.nativeMaterial).toBe("on");
      });
    } finally {
      act(() => setAppThemeOverride(null));
      Reflect.deleteProperty(window, "poracode");
    }
  });

  // ViscosityCode: the Frosting slider edits the tint of the shown appearance.
  it("applies the frosting tint of the shown appearance", () => {
    settingsState.themeMode = "light";
    settingsState.sidebarGlassTint = { light: 10, dark: 90 };
    try {
      render(
        <AppProvider contentReady>
          <span />
        </AppProvider>,
      );
      expect(applySidebarGlassTint).toHaveBeenLastCalledWith(expect.anything(), 10, false);

      act(() => setAppThemeOverride("hostile-binary"));
      expect(applySidebarGlassTint).toHaveBeenLastCalledWith(expect.anything(), 90, false);
    } finally {
      act(() => setAppThemeOverride(null));
      settingsState.sidebarGlassTint = { light: null, dark: null };
    }
  });

  // ViscosityCode: the Windows backdrop preference rides on setWindowChrome.
  it("forwards the window material preference to the native window chrome", async () => {
    Object.defineProperty(window, "poracode", { configurable: true, value: {} });
    try {
      settingsState.sidebarTranslucency = true;
      setWindowMaterialPreference("acrylic");
      render(
        <AppProvider contentReady>
          <span />
        </AppProvider>,
      );
      await waitFor(() => {
        expect(setWindowChrome).toHaveBeenLastCalledWith(
          expect.objectContaining({ materialEnabled: true, windowMaterial: "acrylic" }),
        );
      });

      act(() => setWindowMaterialPreference("mica"));
      await waitFor(() => {
        expect(setWindowChrome).toHaveBeenLastCalledWith(
          expect.objectContaining({ windowMaterial: "mica" }),
        );
      });
    } finally {
      setWindowMaterialPreference("auto");
      Reflect.deleteProperty(window, "poracode");
    }
  });

  // ViscosityCode: Lightweight mode turns the glass off, which detaches the
  // native material; leaving it restores the user's setting live.
  it("turns the glass and native material off in Lightweight mode", async () => {
    Object.defineProperty(window, "poracode", { configurable: true, value: {} });
    settingsState.sidebarTranslucency = true;
    try {
      render(
        <AppProvider contentReady>
          <span />
        </AppProvider>,
      );
      await waitFor(() => {
        expect(setWindowChrome).toHaveBeenLastCalledWith(
          expect.objectContaining({ materialEnabled: true }),
        );
      });

      act(() => usePerformanceSettings.getState().setLightweight("on"));
      await waitFor(() => {
        expect(setWindowChrome).toHaveBeenLastCalledWith(
          expect.objectContaining({ materialEnabled: false }),
        );
      });
      expect(document.documentElement.dataset.sidebarGlass).toBe("off");

      act(() => usePerformanceSettings.getState().setLightweight("off"));
      await waitFor(() => {
        expect(setWindowChrome).toHaveBeenLastCalledWith(
          expect.objectContaining({ materialEnabled: true }),
        );
      });
      expect(document.documentElement.dataset.sidebarGlass).toBe("on");
    } finally {
      act(() => usePerformanceSettings.getState().setLightweight("auto"));
      Reflect.deleteProperty(window, "poracode");
    }
  });

  // ViscosityCode: Auto on a large Windows machine probes WebGL synchronously;
  // windows that do not sync the chrome, and the boot render, must not pay for it.
  it("skips the Lightweight GPU probe in secondary windows and before content is ready", () => {
    settingsState.sidebarTranslucency = true;
    Object.defineProperty(globalThis, "viscosityHost", {
      configurable: true,
      value: { system: { totalMemoryBytes: 32 * 1024 ** 3, probeWebGl: true } },
    });
    resetLowMemoryCacheForTests();
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockImplementation(() => null);
    try {
      const secondary = render(
        <AppProvider contentReady syncWindowChrome={false}>
          <span />
        </AppProvider>,
      );
      secondary.unmount();
      const booting = render(
        <AppProvider>
          <span />
        </AppProvider>,
      );
      expect(getContext).not.toHaveBeenCalled();

      booting.rerender(
        <AppProvider contentReady>
          <span />
        </AppProvider>,
      );
      expect(getContext).toHaveBeenCalledWith("webgl2", { failIfMajorPerformanceCaveat: true });
    } finally {
      getContext.mockRestore();
      Reflect.deleteProperty(globalThis, "viscosityHost");
      resetLowMemoryCacheForTests();
    }
  });
});
