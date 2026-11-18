/**
 * ViscosityCode: owns the background canvas for one mounted BackgroundLayer.
 *
 * - Picks a backend: WebGL2 first, the 2D canvas when WebGL2 is unavailable,
 *   refuses the shader, or loses its context for good; "off" when neither works.
 * - Runs the capped frame loop that `decideSchedule` allows, sampling the
 *   energy bus once per frame. No React state is touched per frame.
 * - Follows the window size, devicePixelRatio and theme (debounced, keyed so
 *   unrelated inline-style writes on <html> cost nothing).
 *
 * Exactly one canvas (and at most one WebGL context) exists at a time; a
 * canvas that held a WebGL context is never reused, because it cannot hand out
 * a 2D context afterwards.
 */
import { getFxEnergy } from "../energyBus";
import type { BackgroundPreset, BackgroundSettings } from "../fxSettingsStore";
import {
  internalSizeFor,
  type BackgroundBackend,
  type BackgroundRendererKind,
  type InternalSize,
} from "./backend";
import { panelStyleFor } from "./backgroundDom";
import { CANVAS2D_MAX_FPS, Canvas2dBackend } from "./canvas2dBackend";
import { BackgroundEnvironment, type BackgroundEnvironmentSnapshot } from "./environment";
import {
  decideSchedule,
  FrameLoop,
  type FrameLoopTimers,
  type ScheduleDecision,
} from "./scheduler";
import { BACKGROUND_LOOP_SECONDS } from "./shaders";
import { readThemeColors, themeKey, type BackgroundThemeColors } from "./themeColors";
import { WebGl2Backend } from "./webglBackend";

export type BackgroundRendererPreference = "auto" | "webgl2" | "canvas2d";

export interface BackgroundStats {
  /** Frames per second measured over the last second (0 while paused). */
  fps: number;
  framesRendered: number;
  renderer: BackgroundRendererKind;
  /** Pause reason, "context-lost" while waiting for a GPU restore, or null while animating. */
  paused: string | null;
  internalSize: InternalSize;
}

export interface BackgroundEnvironmentLike {
  snapshot(): BackgroundEnvironmentSnapshot;
  setCoverPolling(active: boolean): void;
  dispose(): void;
}

export interface BackgroundControllerOptions {
  root?: HTMLElement;
  rendererPreference?: BackgroundRendererPreference;
  createEnvironment?: (onChange: () => void) => BackgroundEnvironmentLike;
  readColors?: (root: HTMLElement) => BackgroundThemeColors;
  timers?: FrameLoopTimers;
}

/** Energy (0..1) adds at most this fraction to speed (and, in the shader, brightness). */
export const ENERGY_SPEED_BOOST = 0.6;
/** Time constant of the energy smoothing, so bursts swell and fade instead of flickering. */
const ENERGY_TAU_MS = 900;
/** Longest animation step: a stalled frame never jumps the animation. */
const MAX_STEP_MS = 100;
/** Theme changes arrive in bursts (class + many inline variables); read once. */
const THEME_DEBOUNCE_MS = 120;
/** Wait this long for `webglcontextrestored` before falling back to 2D. */
const CONTEXT_RESTORE_TIMEOUT_MS = 5000;
/** After this many context losses the GPU is treated as unreliable. */
const MAX_CONTEXT_LOSSES = 3;
/** Starting point in the loop: a composition that looks settled on first paint. */
const INITIAL_PHASE_SECONDS = 47;

/** Animation speed multiplier for the user intensity (energy is applied on top). */
export function speedForIntensity(intensity: number): number {
  const value = Number.isFinite(intensity) ? Math.min(1, Math.max(0, intensity)) : 0.5;
  return 0.55 + 0.9 * value;
}

function sameSize(a: InternalSize, b: InternalSize): boolean {
  return a.width === b.width && a.height === b.height;
}

export class BackgroundController {
  private readonly root: HTMLElement;
  private readonly loop: FrameLoop;
  private readonly environment: BackgroundEnvironmentLike;
  private readonly readColors: (root: HTMLElement) => BackgroundThemeColors;
  private settings: BackgroundSettings;
  private preference: BackgroundRendererPreference;
  private backend: BackgroundBackend | null = null;
  private webglUnusable = false;
  private contextLosses = 0;
  private restoreTimer = 0;
  private colors: BackgroundThemeColors;
  private currentThemeKey: string;
  private themeTimer = 0;
  private themeObserver: MutationObserver | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private dprQuery: MediaQueryList | null = null;
  private cssWidth: number;
  private cssHeight: number;
  private dpr: number;
  private internalSize: InternalSize = { width: 0, height: 0 };
  private decision: ScheduleDecision = { fps: 0, paused: "hidden", staticFrame: false };
  private dirty = true;
  private phase = INITIAL_PHASE_SECONDS;
  private energy = 0;
  private lastRenderAt = 0;
  private framesRendered = 0;
  private fpsWindowStart = 0;
  private fpsWindowFrames = 0;
  private measuredFps = 0;
  private disposed = false;

  constructor(
    private readonly host: HTMLElement,
    settings: BackgroundSettings,
    options: BackgroundControllerOptions = {},
  ) {
    this.root = options.root ?? document.documentElement;
    this.settings = settings;
    this.preference = options.rendererPreference ?? "auto";
    this.readColors = options.readColors ?? ((root) => readThemeColors(root));
    this.loop = new FrameLoop((now) => this.renderFrame(now, true), options.timers);
    this.colors = this.readColors(this.root);
    this.currentThemeKey = themeKey(this.root);
    this.cssWidth = window.innerWidth;
    this.cssHeight = window.innerHeight;
    this.dpr = window.devicePixelRatio || 1;

    this.installBackend();
    this.observeSize();
    this.observeTheme();
    const createEnvironment =
      options.createEnvironment ??
      ((onChange: () => void) => new BackgroundEnvironment(onChange, { root: this.root }));
    this.environment = createEnvironment(this.reschedule);
    this.reschedule();
  }

  get rendererKind(): BackgroundRendererKind {
    return this.backend?.kind ?? "off";
  }

  stats(): BackgroundStats {
    const lost = this.backend?.contextLost ?? false;
    return {
      fps: this.loop.running ? this.measuredFps : 0,
      framesRendered: this.framesRendered,
      renderer: this.rendererKind,
      paused: lost ? "context-lost" : this.backend ? this.decision.paused : "no-renderer",
      internalSize: { ...this.internalSize },
    };
  }

  /** Apply changed settings (preset, intensity, caps, pause options, panel opacity). */
  update(next: BackgroundSettings): void {
    if (this.disposed) return;
    const previous = this.settings;
    this.settings = next;
    if (next.preset !== previous.preset) this.applyPreset(next.preset);
    if (next.intensity !== previous.intensity) this.dirty = true;
    this.reschedule();
  }

  /** Debug/measurement: force a backend ("auto" returns to normal selection). */
  setRendererPreference(preference: BackgroundRendererPreference): void {
    if (this.disposed || preference === this.preference) return;
    this.preference = preference;
    if (preference !== "canvas2d") {
      this.webglUnusable = false;
      this.contextLosses = 0;
    }
    this.installBackend();
    this.reschedule();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.loop.stop();
    this.environment.dispose();
    this.resizeObserver?.disconnect();
    this.themeObserver?.disconnect();
    this.dprQuery?.removeEventListener?.("change", this.handleDprChange);
    if (this.themeTimer) window.clearTimeout(this.themeTimer);
    this.teardownBackend();
  }

  // --- Backend selection ----------------------------------------------------

  private installBackend(): void {
    this.teardownBackend();
    const { preset } = this.settings;
    const tryWebgl =
      this.preference === "webgl2" || (this.preference === "auto" && !this.webglUnusable);
    if (tryWebgl) {
      const canvas = this.createCanvas();
      const webgl = WebGl2Backend.create(canvas, preset, this.colors);
      if (webgl) {
        canvas.addEventListener("webglcontextlost", this.handleContextLost);
        canvas.addEventListener("webglcontextrestored", this.handleContextRestored);
        this.mount(webgl);
        return;
      }
      this.webglUnusable = true;
    }
    const canvas2d = Canvas2dBackend.create(this.createCanvas(), preset, this.colors);
    if (canvas2d) this.mount(canvas2d);
  }

  private createCanvas(): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.className = "vc-bg-canvas";
    return canvas;
  }

  private mount(backend: BackgroundBackend): void {
    this.backend = backend;
    this.internalSize = { width: 0, height: 0 };
    this.host.replaceChildren(backend.canvas);
    this.dirty = true;
    this.applySize();
  }

  private teardownBackend(): void {
    if (this.restoreTimer) window.clearTimeout(this.restoreTimer);
    this.restoreTimer = 0;
    const backend = this.backend;
    if (!backend) return;
    this.backend = null;
    backend.canvas.removeEventListener("webglcontextlost", this.handleContextLost);
    backend.canvas.removeEventListener("webglcontextrestored", this.handleContextRestored);
    backend.dispose();
    backend.canvas.remove();
    this.internalSize = { width: 0, height: 0 };
  }

  private applyPreset(preset: BackgroundPreset): void {
    const backend = this.backend;
    this.dirty = true;
    if (!backend || backend.setPreset(preset)) return;
    // The GPU refused this preset's shader: draw it with the 2D fallback instead.
    this.webglUnusable = true;
    this.installBackend();
  }

  private fallBackToCanvas2d(): void {
    if (this.disposed) return;
    this.webglUnusable = true;
    if (this.preference === "webgl2") this.preference = "auto";
    this.installBackend();
    this.reschedule();
  }

  private readonly handleContextLost = (event: Event): void => {
    // Ask the browser to restore the context; until then nothing is drawn.
    event.preventDefault();
    this.contextLosses += 1;
    this.loop.stop();
    if (this.contextLosses >= MAX_CONTEXT_LOSSES) {
      this.fallBackToCanvas2d();
      return;
    }
    if (this.restoreTimer) window.clearTimeout(this.restoreTimer);
    this.restoreTimer = window.setTimeout(() => {
      this.restoreTimer = 0;
      this.fallBackToCanvas2d();
    }, CONTEXT_RESTORE_TIMEOUT_MS);
    this.reschedule();
  };

  private readonly handleContextRestored = (): void => {
    if (this.restoreTimer) window.clearTimeout(this.restoreTimer);
    this.restoreTimer = 0;
    const backend = this.backend;
    if (!(backend instanceof WebGl2Backend) || !backend.restore()) {
      this.fallBackToCanvas2d();
      return;
    }
    this.dirty = true;
    this.reschedule();
  };

  // --- Scheduling and rendering ---------------------------------------------

  private readonly reschedule = (): void => {
    if (this.disposed) return;
    const env = this.environment.snapshot();
    const settings = this.settings;
    const decision = decideSchedule({
      fpsCap: settings.fpsCap,
      documentHidden: env.documentHidden,
      windowFocused: env.windowFocused,
      covered: env.covered,
      panelsOpaque: panelStyleFor(settings).alpha >= 1,
      pauseWhenUnfocused: settings.pauseWhenUnfocused,
      prefersReducedMotion: env.prefersReducedMotion,
      respectReducedMotion: settings.respectReducedMotion,
      batterySaver: settings.batterySaver,
      battery: env.battery,
    });
    this.decision = decision;
    this.environment.setCoverPolling(decision.paused === null || decision.paused === "covered");
    const backend = this.backend;
    let fps = decision.fps;
    if (!backend || backend.contextLost) fps = 0;
    else if (backend.kind === "canvas2d") fps = Math.min(fps, CANVAS2D_MAX_FPS);
    if (fps > 0) {
      if (!this.loop.running) this.lastRenderAt = 0;
      this.loop.setFps(fps);
      // Show a fresh frame now rather than at the loop's first slot.
      if (this.dirty) this.renderFrame(performance.now(), false);
      return;
    }
    this.loop.stop();
    this.measuredFps = 0;
    this.fpsWindowStart = 0;
    if (decision.staticFrame && this.dirty) this.renderFrame(performance.now(), false);
  };

  /** Draw a frame. `advance` moves the animation; still frames keep the current time. */
  private renderFrame(now: number, advance: boolean): void {
    const backend = this.backend;
    if (!backend || this.disposed) return;
    const settings = this.settings;
    if (advance) {
      const dt =
        this.lastRenderAt > 0 ? Math.min(Math.max(0, now - this.lastRenderAt), MAX_STEP_MS) : 0;
      this.lastRenderAt = now;
      const target = getFxEnergy();
      this.energy += (target - this.energy) * (1 - Math.exp(-dt / ENERGY_TAU_MS));
      const speed = speedForIntensity(settings.intensity) * (1 + ENERGY_SPEED_BOOST * this.energy);
      this.phase = (this.phase + (dt / 1000) * speed) % BACKGROUND_LOOP_SECONDS;
    }
    if (!backend.render({ time: this.phase, intensity: settings.intensity, energy: this.energy })) {
      return;
    }
    this.dirty = false;
    this.framesRendered += 1;
    if (advance) this.countFrame(now);
  }

  private countFrame(now: number): void {
    if (this.fpsWindowStart === 0) {
      this.fpsWindowStart = now;
      this.fpsWindowFrames = 0;
      return;
    }
    this.fpsWindowFrames += 1;
    const elapsed = now - this.fpsWindowStart;
    if (elapsed < 1000) return;
    this.measuredFps = Math.round(((this.fpsWindowFrames * 1000) / elapsed) * 10) / 10;
    this.fpsWindowStart = now;
    this.fpsWindowFrames = 0;
  }

  // --- Size and theme ---------------------------------------------------------

  private observeSize(): void {
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver((entries) => {
        const rect = entries[entries.length - 1]?.contentRect;
        if (!rect) return;
        this.cssWidth = rect.width;
        this.cssHeight = rect.height;
        this.applySize();
      });
      this.resizeObserver.observe(this.host);
    }
    this.watchDpr();
  }

  private watchDpr(): void {
    this.dprQuery?.removeEventListener?.("change", this.handleDprChange);
    this.dprQuery =
      typeof window.matchMedia === "function"
        ? window.matchMedia(`(resolution: ${this.dpr}dppx)`)
        : null;
    this.dprQuery?.addEventListener?.("change", this.handleDprChange);
  }

  private readonly handleDprChange = (): void => {
    if (this.disposed) return;
    this.dpr = window.devicePixelRatio || 1;
    this.watchDpr();
    this.applySize();
  };

  /** Resize the drawing buffer; redraw at once so a cleared buffer is never shown. */
  private applySize(): void {
    const backend = this.backend;
    if (!backend) return;
    const size = internalSizeFor(backend.kind, this.cssWidth, this.cssHeight, this.dpr);
    if (sameSize(size, this.internalSize)) return;
    backend.resize(size.width, size.height);
    this.internalSize = size;
    this.dirty = true;
    if (this.decision.paused === null || this.decision.staticFrame) {
      this.renderFrame(performance.now(), false);
    }
  }

  private observeTheme(): void {
    if (typeof MutationObserver === "undefined") return;
    this.themeObserver = new MutationObserver(() => {
      if (this.themeTimer) return;
      this.themeTimer = window.setTimeout(this.refreshColors, THEME_DEBOUNCE_MS);
    });
    this.themeObserver.observe(this.root, {
      attributes: true,
      attributeFilter: ["class", "style", "data-theme", "data-theme-preset"],
    });
  }

  private readonly refreshColors = (): void => {
    this.themeTimer = 0;
    if (this.disposed) return;
    const key = themeKey(this.root);
    if (key === this.currentThemeKey) return;
    this.currentThemeKey = key;
    this.colors = this.readColors(this.root);
    this.backend?.setColors(this.colors);
    this.dirty = true;
    if (!this.loop.running && this.decision.staticFrame) {
      this.renderFrame(performance.now(), false);
    }
  };
}
