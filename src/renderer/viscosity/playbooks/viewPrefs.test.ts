import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PLAYBOOK_VIEW_PREFS,
  getPlaybookViewPrefs,
  PLAYBOOK_VIEW_PREFS_EVENT,
  PLAYBOOK_VIEW_PREFS_STORAGE_KEY,
  readPlaybookViewPrefs,
  setPlaybookViewPrefs,
  subscribePlaybookViewPrefs,
  usePlaybookViewPrefsStore,
} from "./viewPrefs";

afterEach(() => {
  localStorage.clear();
  usePlaybookViewPrefsStore.setState(DEFAULT_PLAYBOOK_VIEW_PREFS);
});

describe("playbook view preferences", () => {
  it("defaults playbook themes off and the animation on when nothing was stored", () => {
    expect(readPlaybookViewPrefs()).toEqual({
      themeOverride: false,
      switchAnimation: true,
      crtScanlines: false,
    });
  });

  it("keeps a stored choice either way over the off default (documents written before it)", () => {
    for (const themeOverride of [true, false]) {
      localStorage.setItem(
        PLAYBOOK_VIEW_PREFS_STORAGE_KEY,
        JSON.stringify({ version: 1, themeOverride, switchAnimation: true, crtScanlines: false }),
      );
      expect(readPlaybookViewPrefs().themeOverride).toBe(themeOverride);
    }
  });

  it("falls back to defaults for malformed JSON, foreign versions and wrong types", () => {
    localStorage.setItem(PLAYBOOK_VIEW_PREFS_STORAGE_KEY, "{not json");
    expect(readPlaybookViewPrefs()).toEqual(DEFAULT_PLAYBOOK_VIEW_PREFS);
    localStorage.setItem(
      PLAYBOOK_VIEW_PREFS_STORAGE_KEY,
      JSON.stringify({ version: 2, themeOverride: false }),
    );
    expect(readPlaybookViewPrefs()).toEqual(DEFAULT_PLAYBOOK_VIEW_PREFS);
    localStorage.setItem(
      PLAYBOOK_VIEW_PREFS_STORAGE_KEY,
      JSON.stringify({ version: 1, themeOverride: "no", switchAnimation: false }),
    );
    expect(readPlaybookViewPrefs()).toEqual({
      ...DEFAULT_PLAYBOOK_VIEW_PREFS,
      switchAnimation: false,
    });
  });

  it("persists a change under the v1 key, notifies subscribers and fires the window event", () => {
    const listener = vi.fn<(prefs: unknown) => void>();
    const event = vi.fn<() => void>();
    window.addEventListener(PLAYBOOK_VIEW_PREFS_EVENT, event);
    const unsubscribe = subscribePlaybookViewPrefs(listener);
    setPlaybookViewPrefs({ themeOverride: true });
    expect(getPlaybookViewPrefs().themeOverride).toBe(true);
    expect(JSON.parse(localStorage.getItem(PLAYBOOK_VIEW_PREFS_STORAGE_KEY) ?? "{}")).toEqual({
      version: 1,
      themeOverride: true,
      switchAnimation: true,
      crtScanlines: false,
    });
    expect(listener).toHaveBeenCalledWith({
      themeOverride: true,
      switchAnimation: true,
      crtScanlines: false,
    });
    expect(event).toHaveBeenCalledTimes(1);
    expect(readPlaybookViewPrefs().themeOverride).toBe(true);
    unsubscribe();
    window.removeEventListener(PLAYBOOK_VIEW_PREFS_EVENT, event);
  });

  it("keeps the retired animation and CRT switches when the theme switch changes", () => {
    localStorage.setItem(
      PLAYBOOK_VIEW_PREFS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        themeOverride: false,
        switchAnimation: false,
        crtScanlines: true,
      }),
    );
    usePlaybookViewPrefsStore.setState(readPlaybookViewPrefs());
    setPlaybookViewPrefs({ themeOverride: true });
    expect(JSON.parse(localStorage.getItem(PLAYBOOK_VIEW_PREFS_STORAGE_KEY) ?? "{}")).toEqual({
      version: 1,
      themeOverride: true,
      switchAnimation: false,
      crtScanlines: true,
    });
  });
});
