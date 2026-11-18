import { beforeEach, describe, expect, it } from "vitest";
import { getFxEnergy, setFxEnergy } from "./energyBus";
import {
  DEFAULT_FX_SETTINGS,
  FX_SETTINGS_STORAGE_KEY,
  normalizeFxSettings,
  readFxSettings,
  useFxSettings,
} from "./fxSettingsStore";

describe("fx settings", () => {
  beforeEach(() => {
    localStorage.clear();
    useFxSettings.getState().reset();
  });

  it("defaults keep the background animating even under reduced motion", () => {
    expect(DEFAULT_FX_SETTINGS.background.enabled).toBe(true);
    expect(DEFAULT_FX_SETTINGS.background.respectReducedMotion).toBe(false);
    expect(DEFAULT_FX_SETTINGS.background.fpsCap).toBe(30);
  });

  it("defaults show the background clearly through readable panels", () => {
    expect(DEFAULT_FX_SETTINGS.background.intensity).toBe(0.7);
    expect(DEFAULT_FX_SETTINGS.background.panelOpacity).toBe(0.78);
    expect(DEFAULT_FX_SETTINGS.background.panelBlur).toBe(20);
    // Never below the readability floor the settings clamp enforces.
    expect(normalizeFxSettings(undefined).background.panelOpacity).toBeGreaterThanOrEqual(0.4);
  });

  it("clamps and repairs malformed documents field by field", () => {
    const repaired = normalizeFxSettings({
      background: { intensity: 4, preset: "lava", fpsCap: 120, panelBlur: -3, enabled: "yes" },
      effects: { errorFlash: false },
    });
    expect(repaired.background.intensity).toBe(1);
    expect(repaired.background.preset).toBe("mesh");
    expect(repaired.background.fpsCap).toBe(30);
    expect(repaired.background.panelBlur).toBe(0);
    expect(repaired.background.enabled).toBe(true);
    expect(repaired.effects.errorFlash).toBe(false);
    expect(repaired.effects.thinkingGlow).toBe(true);
  });

  it("persists changes and ignores documents from another version", () => {
    useFxSettings.getState().setBackground({ preset: "aurora", intensity: 0.2 });
    expect(readFxSettings().background.preset).toBe("aurora");

    localStorage.setItem(
      FX_SETTINGS_STORAGE_KEY,
      JSON.stringify({ version: 99, background: { preset: "particles" } }),
    );
    expect(readFxSettings().background.preset).toBe("mesh");
  });

  it("falls back to defaults when storage is unreadable", () => {
    localStorage.setItem(FX_SETTINGS_STORAGE_KEY, "{not json");
    expect(readFxSettings()).toEqual(DEFAULT_FX_SETTINGS);
  });

  it("clamps published energy", () => {
    setFxEnergy(3);
    expect(getFxEnergy()).toBe(1);
    setFxEnergy(Number.NaN);
    expect(getFxEnergy()).toBe(0);
  });
});
