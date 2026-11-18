import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_SMART_START_DOCUMENT,
  normalizeSmartStartDocument,
  readSmartStartDocument,
  selectAutoForProject,
  SMART_START_STORAGE_KEY,
  SMART_START_STORE_VERSION,
  useSmartStartStore,
  withRecentProvider,
} from "./smartStartStore";

function resetStore() {
  useSmartStartStore.setState({ ...DEFAULT_SMART_START_DOCUMENT });
}

describe("normalizeSmartStartDocument", () => {
  it("returns defaults for anything that is not a document", () => {
    for (const raw of [undefined, null, 3, "x", []]) {
      expect(normalizeSmartStartDocument(raw)).toEqual(DEFAULT_SMART_START_DOCUMENT);
    }
  });

  it("keeps valid fields and drops malformed entries", () => {
    expect(
      normalizeSmartStartDocument({
        autoByProject: { p1: true, p2: false, p3: "yes", "": true },
        preferences: { coding: ["a", "a", 4, "b"], quick: "nope", other: ["c"] },
        recentProviders: ["x", "", "y", "x"],
      }),
    ).toEqual({
      autoByProject: { p1: true, p2: false },
      preferences: { coding: ["a", "b"] },
      recentProviders: ["x", "y"],
    });
  });

  it("keeps a stored __proto__ project id as inert data", () => {
    const doc = normalizeSmartStartDocument(JSON.parse('{"autoByProject":{"__proto__":true}}'));
    expect(Object.hasOwn(doc.autoByProject, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(doc.autoByProject)).toBe(Object.prototype);
  });
});

describe("withRecentProvider", () => {
  it("moves the provider to the front without duplicates", () => {
    expect(withRecentProvider(["a", "b", "c"], "c")).toEqual(["c", "a", "b"]);
    expect(withRecentProvider(["a"], "")).toEqual(["a"]);
  });
});

describe("useSmartStartStore", () => {
  beforeEach(() => {
    localStorage.clear();
    resetStore();
  });
  afterEach(() => {
    localStorage.clear();
    resetStore();
  });

  it("remembers Auto per project and persists it", () => {
    useSmartStartStore.getState().setAuto("project-1", true);
    const state = useSmartStartStore.getState();
    expect(selectAutoForProject("project-1")(state)).toBe(true);
    expect(selectAutoForProject("project-2")(state)).toBe(false);
    expect(selectAutoForProject(undefined)(state)).toBe(false);
    expect(readSmartStartDocument().autoByProject).toEqual({ "project-1": true });
    const stored = JSON.parse(localStorage.getItem(SMART_START_STORAGE_KEY) ?? "{}") as {
      version?: number;
    };
    expect(stored.version).toBe(SMART_START_STORE_VERSION);
  });

  it("saves and clears a task kind's preference order", () => {
    const { setPreference } = useSmartStartStore.getState();
    setPreference("coding", ["b", "a", "b"]);
    expect(useSmartStartStore.getState().preferences).toEqual({ coding: ["b", "a"] });
    setPreference("coding", null);
    expect(useSmartStartStore.getState().preferences).toEqual({});
    expect(readSmartStartDocument().preferences).toEqual({});
  });

  it("records hand-picked providers most recent first", () => {
    const { recordProviderUse } = useSmartStartStore.getState();
    recordProviderUse("a");
    recordProviderUse("b");
    recordProviderUse("a");
    expect(useSmartStartStore.getState().recentProviders).toEqual(["a", "b"]);
  });

  it("ignores a stored document of another version", () => {
    localStorage.setItem(
      SMART_START_STORAGE_KEY,
      JSON.stringify({ version: 999, autoByProject: { p: true } }),
    );
    expect(readSmartStartDocument()).toEqual(DEFAULT_SMART_START_DOCUMENT);
  });

  it("survives unreadable storage", () => {
    localStorage.setItem(SMART_START_STORAGE_KEY, "{not json");
    expect(readSmartStartDocument()).toEqual(DEFAULT_SMART_START_DOCUMENT);
  });
});
