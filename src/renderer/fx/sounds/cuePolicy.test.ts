import { describe, expect, it } from "vitest";
import { DEFAULT_FX_SETTINGS, type SoundSettings } from "@/renderer/fx/fxSettingsStore";
import { CUE_MIN_GAP_MS, type CueGate, type CueSituation, decideCue } from "./cuePolicy";

const ON: SoundSettings = { ...DEFAULT_FX_SETTINGS.sounds, enabled: true };
const AWAY: CueSituation = { appInFront: false, threadOnScreen: false };

function fresh(): CueGate {
  return { lastPlayedAt: null };
}

describe("decideCue", () => {
  it("stays silent with the default settings (the pack ships off)", () => {
    expect(decideCue(DEFAULT_FX_SETTINGS.sounds, "done", AWAY, fresh(), 0)).toBe("pack-off");
  });

  it("respects each cue's own switch and a zero volume", () => {
    expect(decideCue({ ...ON, error: false }, "error", AWAY, fresh(), 0)).toBe("cue-off");
    expect(decideCue({ ...ON, error: false }, "done", AWAY, fresh(), 0)).toBe("play");
    expect(decideCue({ ...ON, volume: 0 }, "attention", AWAY, fresh(), 0)).toBe("muted");
  });

  it.each([
    { appInFront: false, threadOnScreen: false, expected: "play" },
    { appInFront: false, threadOnScreen: true, expected: "play" },
    { appInFront: true, threadOnScreen: false, expected: "play" },
    { appInFront: true, threadOnScreen: true, expected: "on-screen" },
  ] as const)(
    "plays only when the user is not already looking (in front: $appInFront, on screen: $threadOnScreen)",
    ({ appInFront, threadOnScreen, expected }) => {
      expect(decideCue(ON, "done", { appInFront, threadOnScreen }, fresh(), 0)).toBe(expected);
    },
  );

  it("plays for an on-screen thread in front when 'Also when the app is in front' is on", () => {
    const situation = { appInFront: true, threadOnScreen: true };
    expect(decideCue({ ...ON, alsoInFront: true }, "attention", situation, fresh(), 0)).toBe(
      "play",
    );
  });

  it("allows at most one cue per gap, whatever the kind", () => {
    const gate: CueGate = { lastPlayedAt: 10_000 };
    expect(decideCue(ON, "error", AWAY, gate, 10_000 + CUE_MIN_GAP_MS - 1)).toBe("throttled");
    expect(decideCue(ON, "attention", AWAY, gate, 10_000 + 1)).toBe("throttled");
    expect(decideCue(ON, "done", AWAY, gate, 10_000 + CUE_MIN_GAP_MS)).toBe("play");
    expect(CUE_MIN_GAP_MS).toBe(1500);
  });

  it("checks visibility before the throttle, so a skipped cue does not use a slot", () => {
    const gate: CueGate = { lastPlayedAt: 0 };
    const looking = { appInFront: true, threadOnScreen: true };
    expect(decideCue(ON, "done", looking, gate, 100)).toBe("on-screen");
    expect(gate.lastPlayedAt).toBe(0);
  });
});
