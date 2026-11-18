/**
 * ViscosityCode: when and how fast the animated background renders.
 *
 * `decideSchedule` is a pure policy function (unit-tested case by case);
 * `FrameLoop` is the capped requestAnimationFrame driver. Nothing here touches
 * React: the controller feeds the loop and the loop calls straight back into
 * the renderer.
 */

/** Why the background is not animating, or `null` while it animates. */
export type BackgroundPauseReason =
  /** The window is hidden or minimised (`document.hidden`, `html[data-app-hidden]`). */
  | "hidden"
  /** A full-window opaque overlay (Settings, Git review, …) covers the background. */
  | "covered"
  /** Panels are fully opaque, so no part of the background can show. */
  | "opaque-panels"
  /** The window lost focus and the user asked to pause then. */
  | "unfocused"
  /** The OS asks to reduce motion and the user opted to honour it. */
  | "reduced-motion"
  /** Battery saver: on battery at or below {@link LOW_BATTERY_LEVEL}. */
  | "low-battery";

export interface BatteryStatus {
  charging: boolean;
  /** 0..1 */
  level: number;
}

export interface ScheduleInput {
  /** Settings frame cap (15, 30 or 60). */
  fpsCap: number;
  documentHidden: boolean;
  windowFocused: boolean;
  covered: boolean;
  panelsOpaque: boolean;
  pauseWhenUnfocused: boolean;
  prefersReducedMotion: boolean;
  respectReducedMotion: boolean;
  batterySaver: boolean;
  /** `null` while unknown or when the Battery Status API is unavailable. */
  battery: BatteryStatus | null;
}

export interface ScheduleDecision {
  /** Target frame rate while animating; 0 when paused. */
  fps: number;
  paused: BackgroundPauseReason | null;
  /**
   * The canvas is (or may be) on screen but must stay still: keep the last
   * frame, and draw one fresh still frame whenever it is invalidated (resize,
   * theme, preset). True while covered too: an overlay can close up to a cover
   * poll before the controller notices, and the canvas must not show a stale
   * theme or a resize-cleared buffer meanwhile. False only while hidden.
   */
  staticFrame: boolean;
}

/** Frame cap while running on battery with battery saver on. */
export const BATTERY_SAVER_FPS = 15;
/** At or below this level (and not charging) battery saver stops animating. */
export const LOW_BATTERY_LEVEL = 0.2;
const DEFAULT_FPS = 30;
const MAX_FPS = 60;

function sanitizeFps(fps: number): number {
  if (!Number.isFinite(fps) || fps <= 0) return DEFAULT_FPS;
  return Math.min(MAX_FPS, Math.round(fps));
}

function paused(reason: BackgroundPauseReason, staticFrame: boolean): ScheduleDecision {
  return { fps: 0, paused: reason, staticFrame };
}

/**
 * The scheduling policy. Reduced motion pauses ONLY when the user opted in
 * (`respectReducedMotion`); by default the background keeps animating even
 * with macOS Reduce Motion or Windows "Animation effects" off.
 */
export function decideSchedule(input: ScheduleInput): ScheduleDecision {
  if (input.documentHidden) return paused("hidden", false);
  // Covered: no animation, but invalidations still redraw one still frame so
  // the canvas is current the moment the overlay closes (cover polling is 1 Hz).
  if (input.covered) return paused("covered", true);
  if (input.panelsOpaque) return paused("opaque-panels", true);
  if (input.pauseWhenUnfocused && !input.windowFocused) return paused("unfocused", true);
  if (input.respectReducedMotion && input.prefersReducedMotion) {
    return paused("reduced-motion", true);
  }
  const cap = sanitizeFps(input.fpsCap);
  const battery = input.batterySaver ? input.battery : null;
  if (battery && !battery.charging) {
    if (battery.level <= LOW_BATTERY_LEVEL) return paused("low-battery", true);
    return { fps: Math.min(cap, BATTERY_SAVER_FPS), paused: null, staticFrame: false };
  }
  return { fps: cap, paused: null, staticFrame: false };
}

export interface FrameLoopTimers {
  requestAnimationFrame(callback: FrameRequestCallback): number;
  cancelAnimationFrame(handle: number): void;
  setTimeout(callback: () => void, ms: number): number;
  clearTimeout(handle: number): void;
}

const browserTimers: FrameLoopTimers = {
  requestAnimationFrame: (callback) => window.requestAnimationFrame(callback),
  cancelAnimationFrame: (handle) => window.cancelAnimationFrame(handle),
  setTimeout: (callback, ms) => window.setTimeout(callback, ms),
  clearTimeout: (handle) => window.clearTimeout(handle),
};

/** A frame is due this close to its slot (absorbs vsync jitter). */
const FRAME_SLACK_MS = 2;
/** Waits longer than this sleep on a timer instead of spinning rAF at display rate. */
const TIMER_SLEEP_THRESHOLD_MS = 20;
/** Wake this long before the slot so the following rAF lands on time. */
const TIMER_WAKE_EARLY_MS = 10;

/**
 * Capped animation loop. At the cap's slot it calls `onFrame(now)` from a
 * requestAnimationFrame callback, so DOM/GL writes land in the frame being
 * produced. Between slots it sleeps on a timer rather than waking at the
 * display's refresh rate, and when stopped it holds no callbacks at all.
 */
export class FrameLoop {
  private fps = 0;
  private rafHandle = 0;
  private timerHandle = 0;
  private lastFrameAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly onFrame: (now: number) => void,
    private readonly timers: FrameLoopTimers = browserTimers,
  ) {}

  get running(): boolean {
    return this.fps > 0;
  }

  get targetFps(): number {
    return this.fps;
  }

  /** Start, retarget, or (with 0) stop the loop. */
  setFps(fps: number): void {
    const next = Number.isFinite(fps) && fps > 0 ? fps : 0;
    if (next === this.fps) return;
    const wasRunning = this.fps > 0;
    this.fps = next;
    if (next === 0) {
      this.cancel();
      return;
    }
    if (!wasRunning) {
      this.lastFrameAt = Number.NEGATIVE_INFINITY;
      this.requestFrame();
    }
  }

  stop(): void {
    this.setFps(0);
  }

  private cancel(): void {
    if (this.rafHandle) this.timers.cancelAnimationFrame(this.rafHandle);
    if (this.timerHandle) this.timers.clearTimeout(this.timerHandle);
    this.rafHandle = 0;
    this.timerHandle = 0;
  }

  private requestFrame(): void {
    if (this.rafHandle || this.timerHandle) return;
    this.rafHandle = this.timers.requestAnimationFrame(this.tick);
  }

  private readonly tick = (now: number): void => {
    this.rafHandle = 0;
    if (this.fps <= 0) return;
    const interval = 1000 / this.fps;
    const elapsed = now - this.lastFrameAt;
    if (elapsed >= interval - FRAME_SLACK_MS) {
      // Keep a steady cadence; after a long gap (first frame, a stall) re-anchor.
      this.lastFrameAt = elapsed > interval * 2 ? now : this.lastFrameAt + interval;
      this.onFrame(now);
      if (this.fps <= 0) return;
    }
    const wait = this.lastFrameAt + interval - now;
    if (wait > TIMER_SLEEP_THRESHOLD_MS) {
      this.timerHandle = this.timers.setTimeout(() => {
        this.timerHandle = 0;
        if (this.fps > 0) this.requestFrame();
      }, wait - TIMER_WAKE_EARLY_MS);
      return;
    }
    this.requestFrame();
  };
}
