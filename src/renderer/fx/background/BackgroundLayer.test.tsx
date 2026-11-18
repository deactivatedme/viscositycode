import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFxSettings } from "../fxSettingsStore";
import { BackgroundLayer } from "./BackgroundLayer";
import {
  BACKGROUND_ATTRIBUTE,
  BACKGROUND_BLUR_ATTRIBUTE,
  PANEL_ALPHA_VAR,
  PANEL_BLUR_VAR,
} from "./backgroundDom";
import type { BackgroundDebugApi } from "./debugHook";

function fake2dContext(): CanvasRenderingContext2D {
  const target: Record<string, unknown> = {
    createRadialGradient: () => ({ addColorStop: () => undefined }),
    createLinearGradient: () => ({ addColorStop: () => undefined }),
  };
  return new Proxy(target, {
    get: (object, key) => (key in object ? object[key as string] : () => undefined),
    set: (object, key, value) => {
      object[key as string] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

function debugApi(): BackgroundDebugApi | undefined {
  return (window as Window & { __viscosityFx?: { background?: BackgroundDebugApi } }).__viscosityFx
    ?.background;
}

describe("BackgroundLayer", () => {
  const root = document.documentElement;

  beforeEach(() => {
    localStorage.clear();
    useFxSettings.getState().reset();
    // jsdom has no WebGL: the layer must settle on the 2D fallback.
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(((kind: string) =>
      kind === "2d" ? fake2dContext() : null) as typeof HTMLCanvasElement.prototype.getContext);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("mounts one inert full-window canvas and turns the panels translucent", () => {
    render(<BackgroundLayer />);
    const layers = document.body.querySelectorAll(":scope > .vc-bg-layer");
    expect(layers).toHaveLength(1);
    const layer = layers[0];
    expect(layer?.getAttribute("aria-hidden")).toBe("true");
    expect(layer?.querySelectorAll("canvas")).toHaveLength(1);
    expect(root.getAttribute(BACKGROUND_ATTRIBUTE)).toBe("on");
    expect(root.style.getPropertyValue(PANEL_ALPHA_VAR)).toBe("0.86");
    expect(root.style.getPropertyValue(PANEL_BLUR_VAR)).toBe("18px");
  });

  it("follows panel opacity and blur changes", () => {
    render(<BackgroundLayer />);
    act(() => useFxSettings.getState().setBackground({ panelOpacity: 0.55, panelBlur: 0 }));
    expect(root.style.getPropertyValue(PANEL_ALPHA_VAR)).toBe("0.55");
    expect(root.style.getPropertyValue(PANEL_BLUR_VAR)).toBe("0px");
    expect(root.getAttribute(BACKGROUND_BLUR_ATTRIBUTE)).toBe("off");
  });

  it("keeps the same canvas when other settings change", () => {
    render(<BackgroundLayer />);
    const canvas = document.querySelector(".vc-bg-layer canvas");
    act(() => useFxSettings.getState().setBackground({ preset: "aurora", intensity: 0.9 }));
    expect(document.querySelector(".vc-bg-layer canvas")).toBe(canvas);
  });

  it("removes the layer and the <html> state when disabled", () => {
    render(<BackgroundLayer />);
    act(() => useFxSettings.getState().setBackground({ enabled: false }));
    expect(document.querySelector(".vc-bg-layer")).toBeNull();
    expect(root.hasAttribute(BACKGROUND_ATTRIBUTE)).toBe(false);
    expect(root.style.getPropertyValue(PANEL_ALPHA_VAR)).toBe("");
    expect(root.style.getPropertyValue(PANEL_BLUR_VAR)).toBe("");

    act(() => useFxSettings.getState().setBackground({ enabled: true }));
    expect(document.querySelectorAll(".vc-bg-layer canvas")).toHaveLength(1);
    expect(root.getAttribute(BACKGROUND_ATTRIBUTE)).toBe("on");
  });

  it("renders nothing and sets nothing while disabled from the start", () => {
    useFxSettings.getState().setBackground({ enabled: false });
    render(<BackgroundLayer />);
    expect(document.querySelector(".vc-bg-layer")).toBeNull();
    expect(root.hasAttribute(BACKGROUND_ATTRIBUTE)).toBe(false);
  });

  it("cleans up on unmount", () => {
    const { unmount } = render(<BackgroundLayer />);
    unmount();
    expect(document.querySelector(".vc-bg-layer")).toBeNull();
    expect(root.hasAttribute(BACKGROUND_ATTRIBUTE)).toBe(false);
    expect(root.style.getPropertyValue(PANEL_ALPHA_VAR)).toBe("");
  });

  it("exposes the development measurement hook", () => {
    render(<BackgroundLayer />);
    const api = debugApi();
    expect(api).toBeDefined();
    expect(api?.stats()).toMatchObject({ renderer: "canvas2d" });
    expect(api?.stats().framesRendered).toBeGreaterThan(0);

    act(() => api?.setPreset("particles"));
    expect(useFxSettings.getState().background.preset).toBe("particles");

    act(() => useFxSettings.getState().setBackground({ enabled: false }));
    expect(api?.stats()).toMatchObject({ renderer: "off", paused: "disabled" });
  });
});
