/**
 * ViscosityCode: the window/OS signals the background scheduler reacts to —
 * visibility, focus, reduced motion, battery and full-window overlays. Each
 * change calls `onChange` once; the controller then re-runs `decideSchedule`.
 *
 * Visibility and focus follow upstream's animation policy: `document.hidden`
 * plus `html[data-app-hidden]` / `html[data-app-unfocused]`, which
 * uiAnimationActivity.ts maintains for every always-on animation.
 */
import type { BatteryStatus } from "./scheduler";

export interface BackgroundEnvironmentSnapshot {
  documentHidden: boolean;
  windowFocused: boolean;
  prefersReducedMotion: boolean;
  battery: BatteryStatus | null;
  covered: boolean;
}

interface BatteryManagerLike extends EventTarget {
  charging: boolean;
  level: number;
}

type NavigatorWithBattery = Navigator & { getBattery?: () => Promise<BatteryManagerLike> };

/** How often to look for a full-window overlay while the background is live. */
export const COVER_POLL_MS = 1000;

const OPAQUE_ALPHA = 0.999;

/** True when a computed `background-color` string has no transparency. */
export function isOpaqueCssColor(value: string): boolean {
  const text = value.trim().toLowerCase();
  if (!text || text === "transparent") return false;
  const slash = text.match(/\/\s*([\d.]+)(%?)\s*\)$/);
  if (slash) {
    const alpha = Number.parseFloat(slash[1] ?? "1") / (slash[2] ? 100 : 1);
    return alpha >= OPAQUE_ALPHA;
  }
  const legacy = text.match(/^rgba\(([^)]*)\)$/);
  if (legacy) {
    const alpha = Number.parseFloat((legacy[1] ?? "").split(",")[3] ?? "1");
    return !Number.isFinite(alpha) || alpha >= OPAQUE_ALPHA;
  }
  return true;
}

/**
 * Whether an opaque full-window overlay (OverlayShell `mode="fixed"`:
 * Settings, Git review, Pull requests, …) is fully shown over the app.
 * Pane-scoped overlays are `absolute` and do not count.
 */
export function isWindowCoveredByOverlay(doc: Document = document): boolean {
  const surfaces = doc.querySelectorAll<HTMLElement>(
    "[data-overlay-surface][data-overlay-visible]",
  );
  for (const surface of surfaces) {
    if (!surface.classList.contains("fixed")) continue;
    try {
      if (isOpaqueCssColor(getComputedStyle(surface).backgroundColor)) return true;
    } catch {
      // Treat an unreadable style as not covering.
    }
  }
  return false;
}

export interface BackgroundEnvironmentOptions {
  root?: HTMLElement;
  coverCheck?: () => boolean;
}

export class BackgroundEnvironment {
  private readonly root: HTMLElement;
  private readonly coverCheck: () => boolean;
  private readonly attributeObserver: MutationObserver | null;
  private readonly motionQuery: MediaQueryList | null;
  private battery: BatteryManagerLike | null = null;
  private batteryStatus: BatteryStatus | null = null;
  private blurred = false;
  private covered = false;
  private coverTimer = 0;
  private disposed = false;

  constructor(
    private readonly onChange: () => void,
    options: BackgroundEnvironmentOptions = {},
  ) {
    this.root = options.root ?? document.documentElement;
    this.coverCheck = options.coverCheck ?? (() => isWindowCoveredByOverlay(document));
    this.blurred = typeof document.hasFocus === "function" ? !document.hasFocus() : false;

    document.addEventListener("visibilitychange", this.handleChange);
    window.addEventListener("focus", this.handleFocus);
    window.addEventListener("blur", this.handleBlur);

    this.attributeObserver =
      typeof MutationObserver === "undefined" ? null : new MutationObserver(this.handleChange);
    this.attributeObserver?.observe(this.root, {
      attributes: true,
      attributeFilter: ["data-app-hidden", "data-app-unfocused"],
    });

    this.motionQuery =
      typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-reduced-motion: reduce)")
        : null;
    this.motionQuery?.addEventListener?.("change", this.handleChange);

    this.watchBattery();
  }

  snapshot(): BackgroundEnvironmentSnapshot {
    const root = this.root;
    return {
      documentHidden: document.visibilityState === "hidden" || root.hasAttribute("data-app-hidden"),
      windowFocused: !this.blurred && !root.hasAttribute("data-app-unfocused"),
      prefersReducedMotion: this.motionQuery?.matches ?? false,
      battery: this.batteryStatus,
      covered: this.covered,
    };
  }

  /**
   * Poll for a covering overlay only while it matters (the background is
   * animating, or paused because it is covered). Off, it holds no timer.
   */
  setCoverPolling(active: boolean): void {
    if (this.disposed) return;
    if (!active) {
      if (this.coverTimer) window.clearInterval(this.coverTimer);
      this.coverTimer = 0;
      return;
    }
    if (this.coverTimer) return;
    this.coverTimer = window.setInterval(this.pollCover, COVER_POLL_MS);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    document.removeEventListener("visibilitychange", this.handleChange);
    window.removeEventListener("focus", this.handleFocus);
    window.removeEventListener("blur", this.handleBlur);
    this.attributeObserver?.disconnect();
    this.motionQuery?.removeEventListener?.("change", this.handleChange);
    if (this.coverTimer) window.clearInterval(this.coverTimer);
    this.coverTimer = 0;
    this.battery?.removeEventListener("chargingchange", this.handleBattery);
    this.battery?.removeEventListener("levelchange", this.handleBattery);
    this.battery = null;
  }

  private readonly handleChange = (): void => {
    if (!this.disposed) this.onChange();
  };

  private readonly handleFocus = (): void => {
    this.blurred = false;
    this.handleChange();
  };

  private readonly handleBlur = (): void => {
    // Focus moving into an embedded frame (browser panel, MCP app card) also
    // blurs this window, but the app is still the active one: hasFocus() stays
    // true then (it counts focused descendants), as uiAnimationActivity assumes.
    this.blurred = typeof document.hasFocus === "function" ? !document.hasFocus() : true;
    this.handleChange();
  };

  private readonly pollCover = (): void => {
    const covered = this.coverCheck();
    if (covered === this.covered) return;
    this.covered = covered;
    this.handleChange();
  };

  private readonly handleBattery = (): void => {
    const battery = this.battery;
    if (!battery) return;
    this.batteryStatus = { charging: battery.charging, level: battery.level };
    this.handleChange();
  };

  private watchBattery(): void {
    const nav = (typeof navigator === "undefined" ? undefined : navigator) as
      | NavigatorWithBattery
      | undefined;
    if (typeof nav?.getBattery !== "function") return;
    nav
      .getBattery()
      .then((battery) => {
        if (this.disposed) return;
        this.battery = battery;
        battery.addEventListener("chargingchange", this.handleBattery);
        battery.addEventListener("levelchange", this.handleBattery);
        this.handleBattery();
      })
      .catch(() => {
        // No battery information: treat as plugged in.
      });
  }
}
