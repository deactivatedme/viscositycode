import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AppView, Project, Thread } from "@/shared/contracts";
import { useAppStore } from "@/renderer/state/appStore";
import { OPEN_TABS_STORAGE_KEY } from "./openTabsModel";
import {
  closeOpenTab,
  getRenderableTabIds,
  readStoredOpenTabs,
  startOpenTabsSync,
  useOpenTabsStore,
  writeStoredOpenTabs,
} from "./openTabsStore";

function thread(id: string, overrides: Partial<Thread> = {}): Thread {
  return {
    id,
    projectId: "p1",
    title: id,
    status: "idle",
    archived: false,
    done: false,
    ...overrides,
  } as Thread;
}

const PROJECT = { id: "p1", name: "Project" } as Project;

function throwingStorage(): Storage {
  return {
    getItem: () => {
      throw new Error("SecurityError");
    },
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
  } as unknown as Storage;
}

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  } as unknown as Storage;
}

function setApp(input: { threads: Thread[]; panes?: [string, ...string[]] }) {
  const view: AppView = input.panes ? { kind: "thread", panes: input.panes } : { kind: "home" };
  useAppStore.setState({
    threads: input.threads,
    projects: [PROJECT],
    view,
    focusedPaneId: null,
  });
}

let stopSync: (() => void) | null = null;

beforeEach(() => {
  useOpenTabsStore.setState({ ids: [] });
  setApp({ threads: [] });
});

afterEach(() => {
  stopSync?.();
  stopSync = null;
});

describe("open tabs storage", () => {
  it("reads and writes the versioned key", () => {
    const storage = memoryStorage();
    writeStoredOpenTabs(["a", "b"], storage);
    expect(storage.getItem(OPEN_TABS_STORAGE_KEY)).toBe('{"ids":["a","b"]}');
    expect(readStoredOpenTabs(storage)).toEqual(["a", "b"]);
  });

  it("degrades to an empty in-memory list when storage throws or is missing", () => {
    expect(readStoredOpenTabs(throwingStorage())).toEqual([]);
    expect(() => writeStoredOpenTabs(["a"], throwingStorage())).not.toThrow();
    expect(readStoredOpenTabs(null)).toEqual([]);
    expect(() => writeStoredOpenTabs(["a"], null)).not.toThrow();
  });

  it("persists store changes to local storage", () => {
    useOpenTabsStore.setState({ ids: ["x"] });
    expect(window.localStorage.getItem(OPEN_TABS_STORAGE_KEY)).toBe('{"ids":["x"]}');
  });
});

describe("startOpenTabsSync", () => {
  it("adds visible threads, keeps closed ones closed while on screen, and drops archived ones", () => {
    setApp({ threads: [thread("a"), thread("b")], panes: ["a"] });
    stopSync = startOpenTabsSync();
    expect(useOpenTabsStore.getState().ids).toEqual(["a"]);

    setApp({ threads: [thread("a"), thread("b")], panes: ["a", "b"] });
    expect(useOpenTabsStore.getState().ids).toEqual(["a", "b"]);

    closeOpenTab("b");
    setApp({ threads: [thread("a"), thread("b", { title: "renamed" })], panes: ["a", "b"] });
    expect(useOpenTabsStore.getState().ids).toEqual(["a"]);

    // "a" is archived; "b" is still the same on-screen visit, so it stays closed.
    const threads = [thread("a", { archived: true }), thread("b"), thread("c")];
    setApp({ threads, panes: ["b"] });
    expect(useOpenTabsStore.getState().ids).toEqual([]);

    setApp({ threads, panes: ["c"] });
    expect(useOpenTabsStore.getState().ids).toEqual(["c"]);

    // A new visit to "b" opens its tab again.
    setApp({ threads, panes: ["b"] });
    expect(useOpenTabsStore.getState().ids).toEqual(["c", "b"]);
  });

  it("stops following the app store after unsubscribe", () => {
    setApp({ threads: [thread("a"), thread("b")], panes: ["a"] });
    const stop = startOpenTabsSync();
    stop();
    setApp({ threads: [thread("a"), thread("b")], panes: ["b"] });
    expect(useOpenTabsStore.getState().ids).toEqual(["a"]);
  });

  it("renders only tabs whose thread is loaded", () => {
    useOpenTabsStore.setState({ ids: ["a", "gone", "b"] });
    setApp({ threads: [thread("a"), thread("b", { archived: true })] });
    expect(getRenderableTabIds()).toEqual(["a"]);
  });
});
