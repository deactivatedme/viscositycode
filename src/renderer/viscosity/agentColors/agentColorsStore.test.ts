import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AGENT_COLORS_STORAGE_KEY,
  DEFAULT_AGENT_COLORS_PREFS,
  normalizeAgentColorsPrefs,
  readAgentColorsPrefs,
  useAgentColors,
} from "./agentColorsStore";

function stored(): unknown {
  const raw = localStorage.getItem(AGENT_COLORS_STORAGE_KEY);
  return raw ? JSON.parse(raw) : null;
}

describe("agent colours store", () => {
  beforeEach(() => {
    localStorage.clear();
    useAgentColors.getState().reset();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("defaults to coloured panes with automatic colours", () => {
    expect(DEFAULT_AGENT_COLORS_PREFS).toEqual({ enabled: true, colors: {} });
    expect(readAgentColorsPrefs()).toEqual(DEFAULT_AGENT_COLORS_PREFS);
  });

  it("persists picks, resets and the switch under a versioned key", () => {
    const store = useAgentColors.getState();
    store.setColor("agent-a", "pink");
    store.setColor("agent-b", "teal");
    expect(stored()).toEqual({
      version: 1,
      enabled: true,
      colors: { "agent-a": "pink", "agent-b": "teal" },
    });
    expect(readAgentColorsPrefs().colors).toEqual({ "agent-a": "pink", "agent-b": "teal" });

    useAgentColors.getState().resetColor("agent-a");
    useAgentColors.getState().setEnabled(false);
    expect(useAgentColors.getState().colors).toEqual({ "agent-b": "teal" });
    expect(readAgentColorsPrefs()).toEqual({ enabled: false, colors: { "agent-b": "teal" } });
  });

  it("skips writes that change nothing", () => {
    useAgentColors.getState().setColor("agent-a", "pink");
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    useAgentColors.getState().setColor("agent-a", "pink");
    useAgentColors.getState().resetColor("agent-unpicked");
    useAgentColors.getState().setEnabled(true);
    expect(setItem).not.toHaveBeenCalled();
  });

  it("ignores documents from another version and unreadable storage", () => {
    localStorage.setItem(
      AGENT_COLORS_STORAGE_KEY,
      JSON.stringify({ version: 2, enabled: false, colors: { "agent-a": "pink" } }),
    );
    expect(readAgentColorsPrefs()).toEqual(DEFAULT_AGENT_COLORS_PREFS);

    localStorage.setItem(AGENT_COLORS_STORAGE_KEY, "{not json");
    expect(readAgentColorsPrefs()).toEqual(DEFAULT_AGENT_COLORS_PREFS);

    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readAgentColorsPrefs()).toEqual(DEFAULT_AGENT_COLORS_PREFS);
  });

  it("keeps working in memory when storage refuses writes", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => useAgentColors.getState().setColor("agent-a", "violet")).not.toThrow();
    expect(useAgentColors.getState().colors).toEqual({ "agent-a": "violet" });
  });

  it("repairs malformed documents entry by entry", () => {
    expect(
      normalizeAgentColorsPrefs({
        enabled: "yes",
        colors: { "agent-a": "pink", "agent-b": "#ff0000", "": "teal", "agent-c": 4 },
      }),
    ).toEqual({ enabled: true, colors: { "agent-a": "pink" } });
    expect(normalizeAgentColorsPrefs({ enabled: false, colors: ["pink"] })).toEqual({
      enabled: false,
      colors: {},
    });
    expect(normalizeAgentColorsPrefs(null)).toEqual(DEFAULT_AGENT_COLORS_PREFS);
  });

  it("bounds what a corrupted document can hold", () => {
    const colors: Record<string, string> = {};
    for (let index = 0; index < 400; index += 1) colors[`agent-${index}`] = "blue";
    colors["x".repeat(201)] = "blue";
    const normalized = normalizeAgentColorsPrefs({ enabled: true, colors });
    expect(Object.keys(normalized.colors)).toHaveLength(256);
    expect(normalized.colors["x".repeat(201)]).toBeUndefined();
  });

  it("refuses to store an empty kind", () => {
    useAgentColors.getState().setColor("", "pink");
    expect(useAgentColors.getState().colors).toEqual({});
    expect(stored()).toBeNull();
  });
});
