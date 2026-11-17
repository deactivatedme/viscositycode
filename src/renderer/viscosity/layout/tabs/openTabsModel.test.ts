import { describe, expect, it } from "vitest";
import {
  INITIAL_OPEN_TABS_SYNC_STATE,
  MAX_OPEN_TABS,
  OPEN_TABS_STORAGE_KEY,
  type OpenTabsSnapshot,
  type TabThreadInfo,
  addOpenTabs,
  parseStoredOpenTabs,
  pruneOpenTabs,
  removeOpenTab,
  resolveNextTabAfterClose,
  selectRenderableTabs,
  serializeOpenTabs,
  stepOpenTabsSync,
} from "./openTabsModel";

function threadMap(
  entries: Record<string, Partial<TabThreadInfo>>,
): ReadonlyMap<string, TabThreadInfo> {
  return new Map(
    Object.entries(entries).map(([id, info]) => [
      id,
      { archived: false, projectId: "p1", ...info } satisfies TabThreadInfo,
    ]),
  );
}

function snapshot(
  visiblePaneIds: readonly string[],
  threads: ReadonlyMap<string, TabThreadInfo>,
  projectIds: readonly string[] = ["p1"],
): OpenTabsSnapshot {
  return { visiblePaneIds, threads, projectIds: new Set(projectIds) };
}

describe("open tabs storage format", () => {
  it("uses a versioned key", () => {
    expect(OPEN_TABS_STORAGE_KEY).toBe("viscosity:open-tabs:v1");
  });

  it("round-trips ids", () => {
    expect(parseStoredOpenTabs(serializeOpenTabs(["a", "b"]))).toEqual(["a", "b"]);
  });

  it("reads malformed or foreign values as empty", () => {
    expect(parseStoredOpenTabs(null)).toEqual([]);
    expect(parseStoredOpenTabs("")).toEqual([]);
    expect(parseStoredOpenTabs("{not json")).toEqual([]);
    expect(parseStoredOpenTabs("[]")).toEqual([]);
    expect(parseStoredOpenTabs('{"ids":"a"}')).toEqual([]);
    expect(parseStoredOpenTabs('{"tabs":["a"]}')).toEqual([]);
  });

  it("drops non-string, empty and duplicate ids and keeps the newest past the cap", () => {
    expect(parseStoredOpenTabs('{"ids":["a",1,"",null,"b","a"]}')).toEqual(["a", "b"]);
    const many = Array.from({ length: MAX_OPEN_TABS + 5 }, (_, index) => `t${index}`);
    const parsed = parseStoredOpenTabs(serializeOpenTabs(many));
    expect(parsed).toHaveLength(MAX_OPEN_TABS);
    expect(parsed[0]).toBe("t5");
    expect(parsed.at(-1)).toBe(`t${MAX_OPEN_TABS + 4}`);
  });
});

describe("addOpenTabs / removeOpenTab", () => {
  it("appends new ids in order and ignores known or empty ones", () => {
    expect(addOpenTabs(["a"], ["b", "a", "", "c", "b"])).toEqual(["a", "b", "c"]);
  });

  it("returns the same list when nothing is added or removed", () => {
    const current = ["a", "b"];
    expect(addOpenTabs(current, ["a"])).toBe(current);
    expect(removeOpenTab(current, "z")).toBe(current);
  });

  it("removes one id", () => {
    expect(removeOpenTab(["a", "b", "c"], "b")).toEqual(["a", "c"]);
  });

  it("drops the oldest unprotected tabs past the cap", () => {
    expect(addOpenTabs(["a", "b", "c"], ["d"], { max: 3, protectedIds: new Set(["a"]) })).toEqual([
      "a",
      "c",
      "d",
    ]);
  });
});

describe("pruneOpenTabs", () => {
  const projectIds = new Set(["p1"]);

  it("drops archived threads", () => {
    expect(
      pruneOpenTabs(["a", "b"], {
        threads: threadMap({ a: {}, b: { archived: true } }),
        previouslyKnown: new Map(),
        projectIds,
      }),
    ).toEqual(["a"]);
  });

  it("drops a known thread that disappeared while its project is loaded (deleted)", () => {
    expect(
      pruneOpenTabs(["a", "b"], {
        threads: threadMap({ a: {} }),
        previouslyKnown: new Map([
          ["a", "p1"],
          ["b", "p1"],
        ]),
        projectIds,
      }),
    ).toEqual(["a"]);
  });

  it("keeps tabs whose thread was never seen or whose project went away with it", () => {
    const current = ["unseen", "offline"];
    expect(
      pruneOpenTabs(current, {
        threads: threadMap({}),
        previouslyKnown: new Map([["offline", "p-remote"]]),
        projectIds,
      }),
    ).toBe(current);
  });
});

describe("selectRenderableTabs", () => {
  it("shows only loaded, unarchived threads", () => {
    expect(
      selectRenderableTabs(["a", "b", "missing"], threadMap({ a: {}, b: { archived: true } })),
    ).toEqual(["a"]);
  });
});

describe("resolveNextTabAfterClose", () => {
  it("prefers the tab to the right, then the left", () => {
    expect(resolveNextTabAfterClose(["a", "b", "c"], "b", ["b"])).toBe("c");
    expect(resolveNextTabAfterClose(["a", "b", "c"], "c", ["c"])).toBe("b");
  });

  it("skips threads already shown in another pane", () => {
    expect(resolveNextTabAfterClose(["a", "b", "c", "d"], "b", ["b", "c"])).toBe("d");
    expect(resolveNextTabAfterClose(["a", "b", "c"], "c", ["a", "b", "c"])).toBeNull();
  });

  it("returns null for the last tab or an unknown id", () => {
    expect(resolveNextTabAfterClose(["a"], "a", ["a"])).toBeNull();
    expect(resolveNextTabAfterClose(["a"], "z", [])).toBeNull();
  });
});

describe("stepOpenTabsSync", () => {
  it("auto-adds threads that become visible in the panes", () => {
    const threads = threadMap({ a: {}, b: {} });
    const first = stepOpenTabsSync([], INITIAL_OPEN_TABS_SYNC_STATE, snapshot(["a"], threads));
    expect(first.tabs).toEqual(["a"]);
    const second = stepOpenTabsSync(first.tabs, first.sync, snapshot(["a", "b"], threads));
    expect(second.tabs).toEqual(["a", "b"]);
  });

  it("ignores draft panes, unknown and archived threads", () => {
    const threads = threadMap({ a: {}, old: { archived: true } });
    const result = stepOpenTabsSync(
      [],
      INITIAL_OPEN_TABS_SYNC_STATE,
      snapshot(["draft:p1", "old", "a", "unloaded"], threads),
    );
    expect(result.tabs).toEqual(["a"]);
  });

  it("does not reopen a closed tab while its thread stays on screen, but does on a new visit", () => {
    const threads = threadMap({ a: {}, b: {} });
    const opened = stepOpenTabsSync([], INITIAL_OPEN_TABS_SYNC_STATE, snapshot(["a"], threads));
    const closed = removeOpenTab(opened.tabs, "a");
    const stillVisible = stepOpenTabsSync(closed, opened.sync, snapshot(["a"], threads));
    expect(stillVisible.tabs).toEqual([]);
    const away = stepOpenTabsSync(stillVisible.tabs, stillVisible.sync, snapshot(["b"], threads));
    expect(away.tabs).toEqual(["b"]);
    const back = stepOpenTabsSync(away.tabs, away.sync, snapshot(["a"], threads));
    expect(back.tabs).toEqual(["b", "a"]);
  });

  it("drops tabs of archived and deleted threads", () => {
    const before = threadMap({ a: {}, b: {}, c: {} });
    const opened = stepOpenTabsSync(
      [],
      INITIAL_OPEN_TABS_SYNC_STATE,
      snapshot(["a", "b", "c"], before),
    );
    const after = threadMap({ a: {}, b: { archived: true } });
    const result = stepOpenTabsSync(opened.tabs, opened.sync, snapshot(["a"], after));
    expect(result.tabs).toEqual(["a"]);
  });

  it("keeps the list identity when nothing changes", () => {
    const threads = threadMap({ a: {} });
    const opened = stepOpenTabsSync([], INITIAL_OPEN_TABS_SYNC_STATE, snapshot(["a"], threads));
    const again = stepOpenTabsSync(opened.tabs, opened.sync, snapshot(["a"], threads));
    expect(again.tabs).toBe(opened.tabs);
  });
});
