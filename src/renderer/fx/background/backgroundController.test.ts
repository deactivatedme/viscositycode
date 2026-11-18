import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setFxEnergy } from "../energyBus";
import { DEFAULT_FX_SETTINGS, type BackgroundSettings } from "../fxSettingsStore";
import {
  BackgroundController,
  speedForIntensity,
  type BackgroundEnvironmentLike,
} from "./backgroundController";
import type { BackgroundEnvironmentSnapshot } from "./environment";
import type { FrameLoopTimers } from "./scheduler";
import { FALLBACK_THEME_COLORS } from "./themeColors";
import { BACKGROUND_WEBGL_ATTRIBUTES } from "./webglBackend";

type ContextRequest = { kind: string; attributes: unknown };

/** A WebGL2 context stand-in: every call is a no-op, builds always succeed. */
function createFakeWebgl() {
  let lost = false;
  const draws = { count: 0 };
  const loseContext = vi.fn<() => void>(() => {
    lost = true;
  });
  const target: Record<string, unknown> = {
    VERTEX_SHADER: 1,
    FRAGMENT_SHADER: 2,
    COMPILE_STATUS: 3,
    LINK_STATUS: 4,
    TRIANGLES: 5,
    isContextLost: () => lost,
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    createShader: () => ({}),
    createProgram: () => ({}),
    createVertexArray: () => ({}),
    getUniformLocation: () => ({}),
    getExtension: (name: string) => (name === "WEBGL_lose_context" ? { loseContext } : null),
    drawArrays: () => {
      draws.count += 1;
    },
  };
  const gl = new Proxy(target, {
    get: (object, key) => (key in object ? object[key as string] : () => undefined),
  });
  return { gl, draws, loseContext, setLost: (value: boolean) => (lost = value) };
}

/** A 2D context stand-in that accepts any drawing call. */
function createFake2d() {
  const calls = { fillRect: 0 };
  const target: Record<string, unknown> = {
    createRadialGradient: () => ({ addColorStop: () => undefined }),
    createLinearGradient: () => ({ addColorStop: () => undefined }),
    fillRect: () => {
      calls.fillRect += 1;
    },
  };
  const ctx = new Proxy(target, {
    get: (object, key) => (key in object ? object[key as string] : () => undefined),
    set: (object, key, value) => {
      object[key as string] = value;
      return true;
    },
  });
  return { ctx, calls };
}

function stubContexts(options: { webgl: unknown; twoD: unknown }) {
  const requests: ContextRequest[] = [];
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
    this: HTMLCanvasElement,
    kind: string,
    attributes?: unknown,
  ) {
    requests.push({ kind, attributes });
    if (kind === "webgl2") return options.webgl as RenderingContext | null;
    if (kind === "2d") return options.twoD as RenderingContext | null;
    return null;
  } as typeof HTMLCanvasElement.prototype.getContext);
  return requests;
}

const visible: BackgroundEnvironmentSnapshot = {
  documentHidden: false,
  windowFocused: true,
  prefersReducedMotion: false,
  battery: null,
  covered: false,
};

function fakeEnvironment(initial: BackgroundEnvironmentSnapshot = visible) {
  let snapshot = initial;
  let onChange: () => void = () => undefined;
  const environment: BackgroundEnvironmentLike = {
    snapshot: () => snapshot,
    setCoverPolling: vi.fn<(active: boolean) => void>(),
    dispose: vi.fn<() => void>(),
  };
  return {
    create: (callback: () => void) => {
      onChange = callback;
      return environment;
    },
    environment,
    set(next: Partial<BackgroundEnvironmentSnapshot>) {
      snapshot = { ...snapshot, ...next };
      onChange();
    },
  };
}

/** rAF on 60 Hz vsync boundaries and timers at their due time, driven by `advance`. */
function manualTimers() {
  let now = 1000;
  let nextId = 1;
  const frames = new Map<number, FrameRequestCallback>();
  const timeouts = new Map<number, { at: number; callback: () => void }>();
  const timers: FrameLoopTimers = {
    requestAnimationFrame: (callback) => {
      const id = nextId++;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame: (id) => {
      frames.delete(id);
    },
    setTimeout: (callback, ms) => {
      const id = nextId++;
      timeouts.set(id, { at: now + ms, callback });
      return id;
    },
    clearTimeout: (id) => {
      timeouts.delete(id);
    },
  };
  const vsync = 1000 / 60;
  return {
    timers,
    pendingFrames: () => frames.size,
    advance(ms: number) {
      const end = now + ms;
      while (now < end) {
        now = Math.min(end, (Math.floor(now / vsync + 1e-9) + 1) * vsync);
        for (const [id, entry] of [...timeouts]) {
          if (entry.at > now) continue;
          timeouts.delete(id);
          entry.callback();
        }
        const due = [...frames.values()];
        frames.clear();
        for (const callback of due) callback(now);
      }
    },
  };
}

const settings: BackgroundSettings = { ...DEFAULT_FX_SETTINGS.background };

describe("BackgroundController", () => {
  let host: HTMLDivElement;
  const controllers: BackgroundController[] = [];

  function start(
    overrides: Partial<BackgroundSettings> = {},
    env = fakeEnvironment(),
    timers = manualTimers(),
    rendererPreference: "auto" | "webgl2" | "canvas2d" = "auto",
  ) {
    const controller = new BackgroundController(
      host,
      { ...settings, ...overrides },
      {
        createEnvironment: env.create,
        readColors: () => FALLBACK_THEME_COLORS.dark,
        timers: timers.timers,
        rendererPreference,
      },
    );
    controllers.push(controller);
    return { controller, env, timers };
  }

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
  });

  afterEach(() => {
    for (const controller of controllers.splice(0)) controller.dispose();
    host.remove();
    setFxEnergy(0);
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("prefers WebGL2 with the low-power context attributes", () => {
    const webgl = createFakeWebgl();
    const requests = stubContexts({ webgl: webgl.gl, twoD: createFake2d().ctx });
    const { controller } = start();
    expect(controller.stats().renderer).toBe("webgl2");
    expect(requests).toEqual([{ kind: "webgl2", attributes: BACKGROUND_WEBGL_ATTRIBUTES }]);
    expect(BACKGROUND_WEBGL_ATTRIBUTES).toMatchObject({
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
      powerPreference: "low-power",
      desynchronized: true,
    });
    expect(host.querySelectorAll("canvas")).toHaveLength(1);
    // A fresh frame is drawn at once, not only at the first loop slot.
    expect(webgl.draws.count).toBe(1);
  });

  it("falls back to the 2D canvas on a fresh element when getContext('webgl2') returns null", () => {
    const fake2d = createFake2d();
    const requests = stubContexts({ webgl: null, twoD: fake2d.ctx });
    const { controller } = start();
    expect(controller.stats().renderer).toBe("canvas2d");
    expect(requests.map((request) => request.kind)).toEqual(["webgl2", "2d"]);
    expect(host.querySelectorAll("canvas")).toHaveLength(1);
    expect(fake2d.calls.fillRect).toBeGreaterThan(0);
  });

  it("caps the 2D fallback at 15 fps and reports the reduced internal size", () => {
    stubContexts({ webgl: null, twoD: createFake2d().ctx });
    const { controller, timers } = start({ fpsCap: 60 });
    const startFrames = controller.stats().framesRendered;
    timers.advance(2000);
    const rendered = controller.stats().framesRendered - startFrames;
    expect(rendered).toBeGreaterThanOrEqual(28);
    expect(rendered).toBeLessThanOrEqual(31);
    expect(controller.stats().fps).toBeGreaterThan(13);
    expect(controller.stats().fps).toBeLessThanOrEqual(15.5);
    const { width, height } = controller.stats().internalSize;
    expect(width).toBeLessThanOrEqual(640);
    expect(height).toBeGreaterThan(0);
  });

  it("reports 'off' when neither WebGL2 nor 2D is available", () => {
    stubContexts({ webgl: null, twoD: null });
    const { controller } = start();
    expect(controller.stats()).toMatchObject({ renderer: "off", paused: "no-renderer", fps: 0 });
    expect(host.querySelector("canvas")).toBeNull();
  });

  it("honours a forced 2D renderer without touching WebGL", () => {
    const requests = stubContexts({ webgl: createFakeWebgl().gl, twoD: createFake2d().ctx });
    const { controller } = start({}, fakeEnvironment(), manualTimers(), "canvas2d");
    expect(controller.stats().renderer).toBe("canvas2d");
    expect(requests.map((request) => request.kind)).toEqual(["2d"]);
  });

  it("switches renderer on request and releases the WebGL context", () => {
    const webgl = createFakeWebgl();
    stubContexts({ webgl: webgl.gl, twoD: createFake2d().ctx });
    const { controller } = start();
    controller.setRendererPreference("canvas2d");
    expect(controller.stats().renderer).toBe("canvas2d");
    expect(webgl.loseContext).toHaveBeenCalledTimes(1);
    expect(host.querySelectorAll("canvas")).toHaveLength(1);
  });

  it("releases the canvas and its WebGL context on dispose", () => {
    const webgl = createFakeWebgl();
    stubContexts({ webgl: webgl.gl, twoD: createFake2d().ctx });
    const env = fakeEnvironment();
    const { controller } = start({}, env);
    controller.dispose();
    expect(webgl.loseContext).toHaveBeenCalledTimes(1);
    expect(host.querySelector("canvas")).toBeNull();
    expect(env.environment.dispose).toHaveBeenCalled();
  });

  it("waits for a lost context, then falls back to 2D if it never comes back", () => {
    vi.useFakeTimers();
    const webgl = createFakeWebgl();
    stubContexts({ webgl: webgl.gl, twoD: createFake2d().ctx });
    const { controller } = start();
    const canvas = host.querySelector("canvas");
    webgl.setLost(true);
    const lostEvent = new Event("webglcontextlost", { cancelable: true });
    canvas?.dispatchEvent(lostEvent);
    expect(lostEvent.defaultPrevented).toBe(true);
    expect(controller.stats().paused).toBe("context-lost");
    vi.advanceTimersByTime(5000);
    expect(controller.stats().renderer).toBe("canvas2d");
  });

  it("rebuilds after the context is restored", () => {
    vi.useFakeTimers();
    const webgl = createFakeWebgl();
    stubContexts({ webgl: webgl.gl, twoD: createFake2d().ctx });
    const { controller, timers } = start();
    const canvas = host.querySelector("canvas");
    webgl.setLost(true);
    canvas?.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    expect(timers.pendingFrames()).toBe(0);
    webgl.setLost(false);
    canvas?.dispatchEvent(new Event("webglcontextrestored"));
    vi.advanceTimersByTime(5000);
    expect(controller.stats()).toMatchObject({ renderer: "webgl2", paused: null });
    expect(timers.pendingFrames()).toBe(1);
  });

  it("pauses with the scheduler and keeps a still frame where one is visible", () => {
    const webgl = createFakeWebgl();
    stubContexts({ webgl: webgl.gl, twoD: createFake2d().ctx });
    const { controller, env, timers } = start();
    env.set({ documentHidden: true });
    expect(controller.stats().paused).toBe("hidden");
    expect(timers.pendingFrames()).toBe(0);

    env.set({ documentHidden: false, windowFocused: false });
    expect(controller.stats().paused).toBe("unfocused");
    expect(timers.pendingFrames()).toBe(0);

    controller.update({ ...settings, pauseWhenUnfocused: false });
    expect(controller.stats().paused).toBeNull();
    expect(timers.pendingFrames()).toBe(1);
  });

  it("redraws a still frame under a covering overlay so it is current when the overlay closes", () => {
    const webgl = createFakeWebgl();
    stubContexts({ webgl: webgl.gl, twoD: createFake2d().ctx });
    const { controller, env, timers } = start();
    env.set({ covered: true });
    expect(controller.stats().paused).toBe("covered");
    expect(timers.pendingFrames()).toBe(0);

    // A preset (or theme/size) change made in Settings, which covers the window.
    const before = webgl.draws.count;
    controller.update({ ...settings, preset: "aurora" });
    expect(webgl.draws.count).toBe(before + 1);
    expect(timers.pendingFrames()).toBe(0);
  });

  it("keeps animating under reduced motion unless the user opts in", () => {
    stubContexts({ webgl: createFakeWebgl().gl, twoD: createFake2d().ctx });
    const env = fakeEnvironment({ ...visible, prefersReducedMotion: true });
    const { controller } = start({}, env);
    expect(controller.stats().paused).toBeNull();
    controller.update({ ...settings, respectReducedMotion: true });
    expect(controller.stats().paused).toBe("reduced-motion");
  });

  it("stops animating when panels are fully opaque", () => {
    stubContexts({ webgl: createFakeWebgl().gl, twoD: createFake2d().ctx });
    const { controller } = start({ panelOpacity: 1 });
    expect(controller.stats().paused).toBe("opaque-panels");
  });

  it("polls for covering overlays only while it matters", () => {
    stubContexts({ webgl: createFakeWebgl().gl, twoD: createFake2d().ctx });
    const env = fakeEnvironment();
    start({}, env);
    expect(env.environment.setCoverPolling).toHaveBeenLastCalledWith(true);
    env.set({ documentHidden: true });
    expect(env.environment.setCoverPolling).toHaveBeenLastCalledWith(false);
    env.set({ documentHidden: false, covered: true });
    expect(env.environment.setCoverPolling).toHaveBeenLastCalledWith(true);
  });

  it("speeds up with intensity", () => {
    expect(speedForIntensity(0)).toBeLessThan(speedForIntensity(0.55));
    expect(speedForIntensity(0.55)).toBeLessThan(speedForIntensity(1));
    expect(speedForIntensity(Number.NaN)).toBe(speedForIntensity(0.5));
  });
});
