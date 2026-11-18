import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  emitAgentFxTransition,
  onAgentFxTransition,
  type AgentFxTransition,
} from "@/renderer/fx/agentState/transitions";
import {
  DEFAULT_FX_SETTINGS,
  useFxSettings,
  type SoundCue,
  type SoundSettings,
} from "@/renderer/fx/fxSettingsStore";
import { CUE_MIN_GAP_MS, type CueGate } from "./cuePolicy";
import { isSoundPackHandlingSounds, startSoundPack } from "./index";
import { createSoundPack } from "./soundPack";

function harness(settings: Partial<SoundSettings> = {}) {
  const state = {
    settings: { ...DEFAULT_FX_SETTINGS.sounds, enabled: true, ...settings },
    clock: 0,
    inFront: false,
    onScreen: new Set<string>(),
  };
  const gate: CueGate = { lastPlayedAt: null };
  const play = vi.fn<(cue: SoundCue, volume: number) => boolean>(() => true);
  const isAppInFront = vi.fn<() => boolean>(() => state.inFront);
  const isThreadOnScreen = vi.fn<(threadId: string) => boolean>((id) => state.onScreen.has(id));
  const pack = createSoundPack({
    subscribe: onAgentFxTransition,
    getSettings: () => state.settings,
    isAppInFront,
    isThreadOnScreen,
    play,
    gate,
    now: () => state.clock,
  });
  pack.start();
  return { state, gate, play, isAppInFront, isThreadOnScreen, pack };
}

const done = (threadId = "t1"): AgentFxTransition => ({ threadId, kind: "done" });

describe("sound pack", () => {
  let stops: (() => void)[] = [];

  beforeEach(() => {
    localStorage.clear();
    useFxSettings.getState().reset();
    stops = [];
  });

  afterEach(() => {
    for (const stop of stops) stop();
  });

  it("does nothing while switched off, without reading the window or the store", () => {
    const h = harness({ enabled: false });
    stops.push(h.pack.stop);
    emitAgentFxTransition(done());
    expect(h.play).not.toHaveBeenCalled();
    expect(h.isAppInFront).not.toHaveBeenCalled();
    expect(h.isThreadOnScreen).not.toHaveBeenCalled();
  });

  it("maps every transition to its own cue at the chosen volume", () => {
    const h = harness({ volume: 0.4 });
    stops.push(h.pack.stop);
    emitAgentFxTransition({ threadId: "a", kind: "done" });
    h.state.clock += CUE_MIN_GAP_MS;
    emitAgentFxTransition({ threadId: "b", kind: "error" });
    h.state.clock += CUE_MIN_GAP_MS;
    emitAgentFxTransition({ threadId: "c", kind: "attention" });
    expect(h.play.mock.calls).toEqual([
      ["done", 0.4],
      ["error", 0.4],
      ["attention", 0.4],
    ]);
  });

  it("collapses a burst of transitions into one cue per 1.5 s", () => {
    const h = harness();
    stops.push(h.pack.stop);
    emitAgentFxTransition(done("a"));
    h.state.clock += 400;
    emitAgentFxTransition({ threadId: "b", kind: "error" });
    h.state.clock += 400;
    emitAgentFxTransition(done("c"));
    expect(h.play).toHaveBeenCalledTimes(1);

    h.state.clock = CUE_MIN_GAP_MS;
    emitAgentFxTransition(done("d"));
    expect(h.play).toHaveBeenCalledTimes(2);
  });

  it("stays quiet for a thread on screen while the app is in front", () => {
    const h = harness();
    stops.push(h.pack.stop);
    h.state.inFront = true;
    h.state.onScreen.add("visible");

    expect(h.pack.handle(done("visible"))).toBe("on-screen");
    expect(h.pack.handle(done("hidden-thread"))).toBe("play");
    expect(h.play).toHaveBeenCalledTimes(1);

    // The same visible thread sounds once the window goes to the background.
    h.state.clock += CUE_MIN_GAP_MS;
    h.state.inFront = false;
    expect(h.pack.handle(done("visible"))).toBe("play");
  });

  it("plays for visible threads too with 'Also when the app is in front'", () => {
    const h = harness({ alsoInFront: true });
    stops.push(h.pack.stop);
    h.state.inFront = true;
    h.state.onScreen.add("visible");
    expect(h.pack.handle(done("visible"))).toBe("play");
  });

  it("skips switched-off cues without using the throttle slot", () => {
    const h = harness({ done: false });
    stops.push(h.pack.stop);
    expect(h.pack.handle(done())).toBe("cue-off");
    expect(h.pack.handle({ threadId: "t1", kind: "error" })).toBe("play");
  });

  it("stops listening when stopped", () => {
    const h = harness();
    h.pack.stop();
    emitAgentFxTransition(done());
    expect(h.play).not.toHaveBeenCalled();
  });
});

describe("startSoundPack", () => {
  beforeEach(() => {
    localStorage.clear();
    useFxSettings.getState().reset();
  });

  it("owns notification sounds only while it runs and is switched on", () => {
    expect(isSoundPackHandlingSounds()).toBe(false);
    const stop = startSoundPack();
    // Running but off (the default): upstream's notification sound stays in charge.
    expect(isSoundPackHandlingSounds()).toBe(false);
    useFxSettings.getState().setSounds({ enabled: true });
    expect(isSoundPackHandlingSounds()).toBe(true);
    stop();
    expect(isSoundPackHandlingSounds()).toBe(false);
    // A second stop is harmless.
    stop();
    expect(isSoundPackHandlingSounds()).toBe(false);
  });

  it("survives transitions when the device has no audio", () => {
    useFxSettings.getState().setSounds({ enabled: true });
    const stop = startSoundPack();
    expect(() => emitAgentFxTransition(done("no-audio"))).not.toThrow();
    stop();
  });
});
