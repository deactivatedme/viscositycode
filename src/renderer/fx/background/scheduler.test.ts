import { describe, expect, it } from "vitest";
import {
  BATTERY_SAVER_FPS,
  decideSchedule,
  FrameLoop,
  LOW_BATTERY_LEVEL,
  type FrameLoopTimers,
  type ScheduleInput,
} from "./scheduler";

const live: ScheduleInput = {
  fpsCap: 30,
  documentHidden: false,
  windowFocused: true,
  covered: false,
  panelsOpaque: false,
  pauseWhenUnfocused: true,
  prefersReducedMotion: false,
  respectReducedMotion: false,
  batterySaver: true,
  battery: { charging: true, level: 1 },
};

describe("decideSchedule", () => {
  it("animates at the settings cap when nothing pauses it", () => {
    expect(decideSchedule(live)).toEqual({ fps: 30, paused: null, staticFrame: false });
    expect(decideSchedule({ ...live, fpsCap: 60 }).fps).toBe(60);
    expect(decideSchedule({ ...live, fpsCap: 15 }).fps).toBe(15);
  });

  it("falls back to 30 fps for an invalid cap and never exceeds 60", () => {
    expect(decideSchedule({ ...live, fpsCap: Number.NaN }).fps).toBe(30);
    expect(decideSchedule({ ...live, fpsCap: 0 }).fps).toBe(30);
    expect(decideSchedule({ ...live, fpsCap: 240 }).fps).toBe(60);
  });

  it("pauses without drawing while the window is hidden or minimised", () => {
    expect(decideSchedule({ ...live, documentHidden: true })).toEqual({
      fps: 0,
      paused: "hidden",
      staticFrame: false,
    });
  });

  it("hidden wins over every other reason", () => {
    const everything: ScheduleInput = {
      ...live,
      documentHidden: true,
      covered: true,
      panelsOpaque: true,
      windowFocused: false,
      prefersReducedMotion: true,
      respectReducedMotion: true,
      battery: { charging: false, level: 0.05 },
    };
    expect(decideSchedule(everything).paused).toBe("hidden");
  });

  it("stops animating under a full-window overlay but keeps the still frame current", () => {
    // The overlay can close up to one cover poll before the controller sees it,
    // so a theme/preset/resize under it must still redraw the canvas once.
    expect(decideSchedule({ ...live, covered: true })).toEqual({
      fps: 0,
      paused: "covered",
      staticFrame: true,
    });
  });

  it("keeps a still frame when panels are fully opaque", () => {
    expect(decideSchedule({ ...live, panelsOpaque: true })).toEqual({
      fps: 0,
      paused: "opaque-panels",
      staticFrame: true,
    });
  });

  it("pauses when unfocused only if the user asked for it", () => {
    expect(decideSchedule({ ...live, windowFocused: false })).toEqual({
      fps: 0,
      paused: "unfocused",
      staticFrame: true,
    });
    expect(decideSchedule({ ...live, windowFocused: false, pauseWhenUnfocused: false })).toEqual({
      fps: 30,
      paused: null,
      staticFrame: false,
    });
  });

  it("keeps animating under OS reduced motion by default (owner override)", () => {
    expect(decideSchedule({ ...live, prefersReducedMotion: true })).toEqual({
      fps: 30,
      paused: null,
      staticFrame: false,
    });
  });

  it("renders a static frame under reduced motion when the user opts in", () => {
    expect(
      decideSchedule({ ...live, prefersReducedMotion: true, respectReducedMotion: true }),
    ).toEqual({ fps: 0, paused: "reduced-motion", staticFrame: true });
    // Opting in has no effect while the OS does not ask for reduced motion.
    expect(decideSchedule({ ...live, respectReducedMotion: true }).paused).toBeNull();
  });

  it("caps at 15 fps on battery", () => {
    const onBattery = { ...live, battery: { charging: false, level: 0.8 } };
    expect(decideSchedule(onBattery)).toEqual({
      fps: BATTERY_SAVER_FPS,
      paused: null,
      staticFrame: false,
    });
    // A lower user cap is kept.
    expect(decideSchedule({ ...onBattery, fpsCap: 15 }).fps).toBe(15);
    expect(decideSchedule({ ...onBattery, fpsCap: 60 }).fps).toBe(15);
  });

  it("stops on a low battery that is not charging, keeping one static frame", () => {
    const low = { ...live, battery: { charging: false, level: LOW_BATTERY_LEVEL } };
    expect(decideSchedule(low)).toEqual({ fps: 0, paused: "low-battery", staticFrame: true });
    expect(decideSchedule({ ...low, battery: { charging: true, level: 0.05 } }).fps).toBe(30);
    expect(decideSchedule({ ...low, battery: { charging: false, level: 0.21 } }).fps).toBe(15);
  });

  it("ignores the battery when battery saver is off or the API is unavailable", () => {
    const low = { ...live, battery: { charging: false, level: 0.05 } };
    expect(decideSchedule({ ...low, batterySaver: false })).toEqual({
      fps: 30,
      paused: null,
      staticFrame: false,
    });
    expect(decideSchedule({ ...live, battery: null }).fps).toBe(30);
  });

  it("orders pause reasons: covered, opaque, unfocused, reduced motion, battery", () => {
    const all: ScheduleInput = {
      ...live,
      covered: true,
      panelsOpaque: true,
      windowFocused: false,
      prefersReducedMotion: true,
      respectReducedMotion: true,
      battery: { charging: false, level: 0.1 },
    };
    expect(decideSchedule(all).paused).toBe("covered");
    expect(decideSchedule({ ...all, covered: false }).paused).toBe("opaque-panels");
    expect(decideSchedule({ ...all, covered: false, panelsOpaque: false }).paused).toBe(
      "unfocused",
    );
    expect(
      decideSchedule({ ...all, covered: false, panelsOpaque: false, windowFocused: true }).paused,
    ).toBe("reduced-motion");
    expect(
      decideSchedule({
        ...all,
        covered: false,
        panelsOpaque: false,
        windowFocused: true,
        respectReducedMotion: false,
      }).paused,
    ).toBe("low-battery");
  });
});

/** Manual clock: rAF fires on 60 Hz vsync boundaries, timers at their due time. */
function createManualTimers() {
  let now = 0;
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
  function advance(ms: number) {
    const end = now + ms;
    while (now < end) {
      now = Math.min(end, (Math.floor(now / vsync + 1e-9) + 1) * vsync);
      for (const [id, entry] of [...timeouts]) {
        if (entry.at <= now) {
          timeouts.delete(id);
          entry.callback();
        }
      }
      const due = [...frames];
      frames.clear();
      for (const [, callback] of due) callback(now);
    }
  }
  return {
    timers,
    advance,
    pending: () => ({ frames: frames.size, timeouts: timeouts.size }),
  };
}

describe("FrameLoop", () => {
  it("renders at the target rate and sleeps on a timer between slots", () => {
    const clock = createManualTimers();
    const frames: number[] = [];
    const loop = new FrameLoop((now) => frames.push(now), clock.timers);
    loop.setFps(30);
    clock.advance(2000);
    expect(frames.length).toBeGreaterThanOrEqual(58);
    expect(frames.length).toBeLessThanOrEqual(62);

    frames.length = 0;
    loop.setFps(15);
    clock.advance(2000);
    expect(frames.length).toBeGreaterThanOrEqual(28);
    expect(frames.length).toBeLessThanOrEqual(32);
  });

  it("holds no callbacks once stopped", () => {
    const clock = createManualTimers();
    let count = 0;
    const loop = new FrameLoop(() => {
      count += 1;
    }, clock.timers);
    loop.setFps(60);
    clock.advance(100);
    loop.stop();
    const stoppedAt = count;
    expect(loop.running).toBe(false);
    expect(clock.pending()).toEqual({ frames: 0, timeouts: 0 });
    clock.advance(1000);
    expect(count).toBe(stoppedAt);
  });

  it("can be stopped from inside a frame", () => {
    const clock = createManualTimers();
    let count = 0;
    const loop = new FrameLoop(() => {
      count += 1;
      if (count === 3) loop.stop();
    }, clock.timers);
    loop.setFps(60);
    clock.advance(1000);
    expect(count).toBe(3);
    expect(clock.pending()).toEqual({ frames: 0, timeouts: 0 });
  });
});
