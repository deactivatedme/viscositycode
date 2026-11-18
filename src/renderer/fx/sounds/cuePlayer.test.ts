import { describe, expect, it, vi } from "vitest";
import { SOUND_CUES } from "@/renderer/fx/fxSettingsStore";
import { CUE_TONES, cueDuration } from "./cues";
import {
  createCuePlayer,
  IDLE_SUSPEND_MS,
  MAX_CUE_GAIN,
  MAX_WAKE_DELAY_MS,
  volumeToGain,
} from "./cuePlayer";

class FakeParam {
  readonly events: [string, number, number][] = [];
  setValueAtTime(value: number, time: number) {
    this.events.push(["set", value, time]);
    return this;
  }
  exponentialRampToValueAtTime(value: number, time: number) {
    this.events.push(["exp", value, time]);
    return this;
  }
}

class FakeNode {
  readonly connections: unknown[] = [];
  disconnected = false;
  connect(target: unknown) {
    this.connections.push(target);
    return target;
  }
  disconnect() {
    this.disconnected = true;
  }
}

class FakeGain extends FakeNode {
  readonly gain = new FakeParam();
}

class FakeOscillator extends FakeNode {
  type = "sine";
  readonly frequency = new FakeParam();
  startAt: number | null = null;
  stopAt: number | null = null;
  private onEnded: (() => void) | null = null;
  addEventListener(_type: string, listener: () => void) {
    this.onEnded = listener;
  }
  start(time: number) {
    this.startAt = time;
  }
  stop(time: number) {
    this.stopAt = time;
  }
  end() {
    this.onEnded?.();
  }
}

class FakeContext {
  state: AudioContextState = "running";
  currentTime = 5;
  readonly destination = new FakeNode();
  readonly oscillators: FakeOscillator[] = [];
  readonly gains: FakeGain[] = [];
  readonly resume = vi.fn<() => Promise<void>>(async () => {
    this.state = "running";
  });
  readonly suspend = vi.fn<() => Promise<void>>(async () => {
    this.state = "suspended";
  });
  readonly close = vi.fn<() => Promise<void>>(async () => {
    this.state = "closed";
  });
  createGain() {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  }
  createOscillator() {
    const oscillator = new FakeOscillator();
    this.oscillators.push(oscillator);
    return oscillator;
  }
}

function setup(context: FakeContext | null = new FakeContext(), clock = { now: 0 }) {
  const createContext = vi.fn<() => AudioContext | null>(
    () => context as unknown as AudioContext | null,
  );
  const timers: { ms: number; callback: () => void; cleared: boolean }[] = [];
  const player = createCuePlayer({
    createContext,
    setTimer: (callback, ms) => {
      const timer = { ms, callback, cleared: false };
      timers.push(timer);
      return timer as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: (handle) => {
      (handle as unknown as { cleared: boolean }).cleared = true;
    },
    now: () => clock.now,
  });
  return { context, createContext, player, timers, clock };
}

describe("cue tones", () => {
  it("keeps every cue short and soft enough never to clip", () => {
    for (const cue of SOUND_CUES) {
      expect(cueDuration(cue)).toBeGreaterThan(0.2);
      expect(cueDuration(cue)).toBeLessThan(1);
      const peak = CUE_TONES[cue].reduce((sum, tone) => sum + tone.level, 0);
      expect(peak * MAX_CUE_GAIN).toBeLessThan(1);
    }
  });

  it("gives each cue its own contour", () => {
    const contour = (cue: (typeof SOUND_CUES)[number]) => {
      const main = CUE_TONES[cue].filter((tone) => tone.level >= 0.2);
      return main.map((tone) => `${tone.wave}:${tone.frequency}`).join(">");
    };
    const contours = new Set(SOUND_CUES.map(contour));
    expect(contours.size).toBe(SOUND_CUES.length);
    const [first, second] = CUE_TONES.done.filter((tone) => tone.level >= 0.2);
    expect(second!.frequency).toBeGreaterThan(first!.frequency); // done rises
    const [low, lower] = CUE_TONES.error;
    expect(lower!.frequency).toBeLessThan(low!.frequency); // error falls
    const taps = CUE_TONES.attention;
    expect(new Set(taps.map((tone) => tone.frequency)).size).toBe(1); // attention repeats
  });
});

describe("volumeToGain", () => {
  it("maps the slider on a perceptual curve and clamps bad input", () => {
    expect(volumeToGain(0)).toBe(0);
    expect(volumeToGain(1)).toBe(MAX_CUE_GAIN);
    expect(volumeToGain(0.5)).toBeCloseTo(MAX_CUE_GAIN / 4);
    expect(volumeToGain(4)).toBe(MAX_CUE_GAIN);
    expect(volumeToGain(Number.NaN)).toBe(0);
  });
});

describe("createCuePlayer", () => {
  it("creates no audio context until the first cue", () => {
    const { createContext, player } = setup();
    expect(createContext).not.toHaveBeenCalled();
    player.play("done", 0.6);
    expect(createContext).toHaveBeenCalledTimes(1);
    player.play("error", 0.6);
    expect(createContext).toHaveBeenCalledTimes(1);
  });

  it("schedules one enveloped oscillator per tone into a master gain", () => {
    const { context, player } = setup();
    expect(player.play("done", 0.5)).toBe(true);
    const tones = CUE_TONES.done;
    expect(context!.oscillators).toHaveLength(tones.length);
    const master = context!.gains[0]!;
    expect(master.connections).toEqual([context!.destination]);
    expect(master.gain.events[0]?.[1]).toBeCloseTo(volumeToGain(0.5));
    context!.oscillators.forEach((oscillator, index) => {
      const tone = tones[index]!;
      expect(oscillator.type).toBe(tone.wave);
      expect(oscillator.frequency.events[0]?.[1]).toBe(tone.frequency);
      expect(oscillator.startAt).toBeGreaterThan(context!.currentTime);
      expect(oscillator.stopAt).toBeGreaterThan(oscillator.startAt!);
    });

    // Nodes release themselves; the master goes once the last tone ends.
    for (const oscillator of context!.oscillators) oscillator.end();
    expect(context!.oscillators.every((oscillator) => oscillator.disconnected)).toBe(true);
    expect(master.disconnected).toBe(true);
  });

  it("makes no sound at volume 0", () => {
    const { createContext, player } = setup();
    expect(player.play("attention", 0)).toBe(false);
    expect(createContext).not.toHaveBeenCalled();
  });

  it("reports no audio without retrying on every cue", () => {
    const { createContext, player } = setup(null);
    expect(player.play("done", 1)).toBe(false);
    expect(player.play("error", 1)).toBe(false);
    expect(createContext).toHaveBeenCalledTimes(1);
  });

  it("suspends an idle context and wakes it for the next cue", async () => {
    const { context, player, timers } = setup();
    player.play("attention", 1);
    const idle = timers.at(-1)!;
    expect(idle.ms).toBeCloseTo((cueDuration("attention") + 0.02) * 1000 + IDLE_SUSPEND_MS);
    idle.callback();
    await vi.waitFor(() => expect(context!.state).toBe("suspended"));

    const before = context!.oscillators.length;
    expect(player.play("done", 1)).toBe(true);
    await vi.waitFor(() =>
      expect(context!.oscillators.length).toBe(before + CUE_TONES.done.length),
    );
    expect(context!.resume).toHaveBeenCalledTimes(1);
  });

  it("drops cues while a sleeping context will not wake, instead of playing them all later", async () => {
    const context = new FakeContext();
    context.state = "suspended";
    let wake: () => void = () => undefined;
    // A browser holds the context asleep until the user interacts with the page.
    context.resume.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          wake = () => {
            context.state = "running";
            resolve();
          };
        }),
    );
    const { player, clock } = setup(context);
    expect(player.play("done", 1)).toBe(true);
    expect(player.play("error", 1)).toBe(false);
    expect(player.play("attention", 1)).toBe(false);
    await vi.waitFor(() => expect(context.resume).toHaveBeenCalledTimes(1));

    clock.now += MAX_WAKE_DELAY_MS + 1;
    wake();
    // Let the whole wake-up chain settle (a macrotask runs after every microtask).
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(context.state).toBe("running");
    expect(context.oscillators).toHaveLength(0);

    // Awake now: the next cue plays at once.
    expect(player.play("done", 1)).toBe(true);
    expect(context.oscillators).toHaveLength(CUE_TONES.done.length);
  });

  it("cancels the idle suspend when another cue starts", () => {
    const { context, player, timers } = setup();
    player.play("done", 1);
    const first = timers.at(-1)!;
    player.play("error", 1);
    expect(first.cleared).toBe(true);
    expect(context!.suspend).not.toHaveBeenCalled();
  });

  it("closes the context on dispose and can play again later", () => {
    const { context, createContext, player } = setup();
    player.play("done", 1);
    player.dispose();
    expect(context!.close).toHaveBeenCalledTimes(1);
    player.play("done", 1);
    expect(createContext).toHaveBeenCalledTimes(2);
  });
});
