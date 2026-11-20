import { beforeEach, describe, expect, it } from "vitest";
import {
  FX_SETTINGS_STORAGE_KEY,
  readLightweightMode,
  usePerformanceSettings,
} from "./performanceSettingsStore";

/** A document written by a build that still had Settings → Effects. */
const PRE_UPGRADE_V1 = {
  version: 1,
  background: {
    enabled: false,
    preset: "aurora",
    intensity: 0.3,
    fpsCap: 60,
    panelOpacity: 0.5,
    panelBlur: 12,
    pauseWhenUnfocused: false,
    respectReducedMotion: true,
    batterySaver: false,
  },
  effects: {
    enabled: true,
    thinkingGlow: false,
    streamingEnergy: true,
    toolIndicator: true,
    attentionColor: false,
    errorFlash: true,
    completionAnimation: false,
    typingGlow: true,
  },
  sounds: {
    enabled: true,
    volume: 0.2,
    alsoInFront: true,
    done: true,
    error: false,
    attention: true,
  },
  projectBackgrounds: { "project-1": { preset: "particles", intensity: 0.4 } },
  performance: { lightweight: "off" },
  motion: { enabled: false, blur: null },
};

function stored(): Record<string, unknown> {
  return JSON.parse(localStorage.getItem(FX_SETTINGS_STORAGE_KEY) ?? "null") as Record<
    string,
    unknown
  >;
}

describe("performanceSettingsStore", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("reads Lightweight from a pre-upgrade v1 document and keeps its other groups on write", () => {
    localStorage.setItem(FX_SETTINGS_STORAGE_KEY, JSON.stringify(PRE_UPGRADE_V1));
    expect(readLightweightMode()).toBe("off");

    usePerformanceSettings.getState().setLightweight("on");

    const { performance, ...rest } = stored();
    const { performance: _old, ...expectedRest } = PRE_UPGRADE_V1;
    expect(performance).toEqual({ lightweight: "on" });
    expect(rest).toEqual(expectedRest);
    expect(readLightweightMode()).toBe("on");
  });

  it.each([
    ["a missing document", null],
    ["a malformed document", "{not json"],
    ["a foreign version", JSON.stringify({ ...PRE_UPGRADE_V1, version: 2 })],
    ["an unknown mode", JSON.stringify({ version: 1, performance: { lightweight: "max" } })],
  ])("reads Auto from %s", (_label, raw) => {
    if (raw !== null) localStorage.setItem(FX_SETTINGS_STORAGE_KEY, raw);
    expect(readLightweightMode()).toBe("auto");
  });

  it("replaces a foreign-version document with a fresh v1 one", () => {
    localStorage.setItem(FX_SETTINGS_STORAGE_KEY, JSON.stringify({ version: 2, other: true }));
    usePerformanceSettings.getState().setLightweight("off");
    expect(stored()).toEqual({ version: 1, performance: { lightweight: "off" } });
  });
});
