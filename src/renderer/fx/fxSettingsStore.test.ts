import { beforeEach, describe, expect, it } from "vitest";
import { getFxEnergy, setFxEnergy } from "./energyBus";
import {
  DEFAULT_FX_SETTINGS,
  FX_SETTINGS_STORAGE_KEY,
  FX_SETTINGS_VERSION,
  MAX_PROJECT_BACKGROUNDS,
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

  it("ships the sound pack switched off, with every cue ready once it is on", () => {
    expect(DEFAULT_FX_SETTINGS.sounds).toEqual({
      enabled: false,
      volume: 0.6,
      alsoInFront: false,
      done: true,
      error: true,
      attention: true,
    });
    expect(DEFAULT_FX_SETTINGS.projectBackgrounds).toEqual({});
  });

  it("reads a version 1 document written before sounds and project backgrounds", () => {
    // Step 3/4 documents carry only these two groups; they must keep their choices.
    localStorage.setItem(
      FX_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        background: { preset: "aurora", intensity: 0.4 },
        effects: { typingGlow: false },
      }),
    );
    const read = readFxSettings();
    expect(FX_SETTINGS_VERSION).toBe(1);
    expect(read.background.preset).toBe("aurora");
    expect(read.background.intensity).toBe(0.4);
    expect(read.effects.typingGlow).toBe(false);
    expect(read.sounds).toEqual(DEFAULT_FX_SETTINGS.sounds);
    expect(read.projectBackgrounds).toEqual({});
  });

  it("repairs sound settings field by field", () => {
    const repaired = normalizeFxSettings({
      sounds: { enabled: true, volume: 7, alsoInFront: "yes", error: false },
    });
    expect(repaired.sounds).toEqual({
      enabled: true,
      volume: 1,
      alsoInFront: false,
      done: true,
      error: false,
      attention: true,
    });
    expect(normalizeFxSettings({ sounds: { volume: Number.NaN } }).sounds.volume).toBe(0.6);
    expect(normalizeFxSettings({ sounds: [] }).sounds).toEqual(DEFAULT_FX_SETTINGS.sounds);
  });

  it("keeps only valid, non-empty project background overrides", () => {
    const repaired = normalizeFxSettings({
      projectBackgrounds: {
        a: { preset: "particles", intensity: 3 },
        b: { preset: "lava" },
        c: { intensity: -1, extra: true },
        d: {},
        e: "aurora",
        "": { preset: "mesh" },
        ["x".repeat(600)]: { preset: "mesh" },
      },
    });
    expect(repaired.projectBackgrounds).toEqual({
      a: { preset: "particles", intensity: 1 },
      c: { intensity: 0 },
    });
    // Parsed JSON can carry a "__proto__" key; it never becomes an entry or a prototype.
    const hostile = normalizeFxSettings(
      JSON.parse('{"projectBackgrounds":{"__proto__":{"preset":"aurora"},"p":{"preset":"mesh"}}}'),
    ).projectBackgrounds;
    expect(Object.keys(hostile)).toEqual(["p"]);
    expect(Object.getPrototypeOf(hostile)).toBe(Object.prototype);
    expect(
      normalizeFxSettings({ projectBackgrounds: [{ preset: "mesh" }] }).projectBackgrounds,
    ).toEqual({});
  });

  it("bounds the number of stored project overrides", () => {
    const many: Record<string, unknown> = {};
    for (let index = 0; index < MAX_PROJECT_BACKGROUNDS + 25; index += 1) {
      many[`project-${index}`] = { intensity: 0.5 };
    }
    const kept = normalizeFxSettings({ projectBackgrounds: many }).projectBackgrounds;
    expect(Object.keys(kept)).toHaveLength(MAX_PROJECT_BACKGROUNDS);
  });

  it("makes room for a new project override at the cap instead of dropping it", () => {
    const store = useFxSettings.getState();
    for (let index = 0; index < MAX_PROJECT_BACKGROUNDS; index += 1) {
      store.setProjectBackground(`project-${index}`, { intensity: 0.5 });
    }
    store.setProjectBackground("newest", { preset: "aurora" });
    const kept = useFxSettings.getState().projectBackgrounds;
    expect(Object.keys(kept)).toHaveLength(MAX_PROJECT_BACKGROUNDS);
    expect(kept.newest).toEqual({ preset: "aurora" });
    expect(Object.hasOwn(kept, "project-0")).toBe(false);
    expect(Object.hasOwn(kept, "project-1")).toBe(true);
  });

  it("patches, clears and persists one project's background override", () => {
    const store = useFxSettings.getState();
    store.setProjectBackground("p1", { preset: "aurora" });
    store.setProjectBackground("p1", { intensity: 0.25 });
    store.setProjectBackground("p2", { intensity: 0.9 });
    expect(useFxSettings.getState().projectBackgrounds).toEqual({
      p1: { preset: "aurora", intensity: 0.25 },
      p2: { intensity: 0.9 },
    });
    expect(readFxSettings().projectBackgrounds.p1).toEqual({ preset: "aurora", intensity: 0.25 });

    // null falls back to the global value for that field; an empty override disappears.
    useFxSettings.getState().setProjectBackground("p1", { preset: null });
    expect(useFxSettings.getState().projectBackgrounds.p1).toEqual({ intensity: 0.25 });
    useFxSettings.getState().setProjectBackground("p1", { intensity: null });
    expect(useFxSettings.getState().projectBackgrounds).toEqual({ p2: { intensity: 0.9 } });

    useFxSettings.getState().clearProjectBackground("p2");
    expect(useFxSettings.getState().projectBackgrounds).toEqual({});
    expect(readFxSettings().projectBackgrounds).toEqual({});

    useFxSettings.getState().setProjectBackground("__proto__", { preset: "mesh" });
    expect(useFxSettings.getState().projectBackgrounds).toEqual({});
  });

  it("only replaces the settings group that changed", () => {
    const before = useFxSettings.getState();
    before.setSounds({ enabled: true, volume: 0.3 });
    const after = useFxSettings.getState();
    expect(after.sounds).toMatchObject({ enabled: true, volume: 0.3 });
    expect(after.background).toBe(before.background);
    expect(after.effects).toBe(before.effects);
    expect(after.projectBackgrounds).toBe(before.projectBackgrounds);
    expect(readFxSettings().sounds.enabled).toBe(true);
  });

  it("reset clears sounds and project overrides too", () => {
    useFxSettings.getState().setSounds({ enabled: true });
    useFxSettings.getState().setProjectBackground("p1", { preset: "particles" });
    useFxSettings.getState().reset();
    const { background, effects, sounds, projectBackgrounds } = useFxSettings.getState();
    expect({ background, effects, sounds, projectBackgrounds }).toEqual(DEFAULT_FX_SETTINGS);
  });

  it("clamps published energy", () => {
    setFxEnergy(3);
    expect(getFxEnergy()).toBe(1);
    setFxEnergy(Number.NaN);
    expect(getFxEnergy()).toBe(0);
  });
});
