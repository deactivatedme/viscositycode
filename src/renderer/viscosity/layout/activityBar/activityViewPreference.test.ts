import { msg } from "@lingui/core/macro";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSidebarOverlayStore } from "@/renderer/state/sidebarOverlayStore";
import {
  ACTIVITY_HOST_VIEW,
  type ActivityBarItem,
  clearActivityBarRegistry,
  getActivityBarItem,
  getActivityBarItems,
  registerActivityBarItem,
} from "./activityBarRegistry";
import {
  ACTIVITY_VIEW_STORAGE_KEY,
  DEFAULT_ACTIVITY_VIEW_ID,
  decideActivityViewPress,
  getActiveActivityViewId,
  pressActivityItem,
  readStoredActivityView,
  resolveActivityViewId,
  useActivityViewStore,
  writeStoredActivityView,
} from "./activityViewPreference";

function Icon() {
  return null;
}

function registerView(id: string, order: number) {
  registerActivityBarItem({ id, label: msg`View`, icon: Icon, order, view: ACTIVITY_HOST_VIEW });
}

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

beforeEach(() => {
  localStorage.clear();
  useActivityViewStore.setState({ requestedViewId: DEFAULT_ACTIVITY_VIEW_ID });
  useSidebarOverlayStore.setState({
    isCollapsed: false,
    userCollapsed: false,
    isAutoCollapsed: false,
    isNarrow: false,
    closingOverlay: false,
  });
});

afterEach(() => {
  clearActivityBarRegistry();
});

describe("stored activity view preference", () => {
  it("round-trips a view id under the versioned key", () => {
    writeStoredActivityView("explorer");
    expect(localStorage.getItem(ACTIVITY_VIEW_STORAGE_KEY)).toBe("explorer");
    expect(readStoredActivityView()).toBe("explorer");
  });

  it("ignores missing and malformed stored values", () => {
    expect(readStoredActivityView()).toBeNull();
    localStorage.setItem(ACTIVITY_VIEW_STORAGE_KEY, "not a view id!");
    expect(readStoredActivityView()).toBeNull();
    localStorage.setItem(ACTIVITY_VIEW_STORAGE_KEY, "x".repeat(65));
    expect(readStoredActivityView()).toBeNull();
  });

  it("never writes a malformed id", () => {
    writeStoredActivityView("bad id");
    expect(localStorage.getItem(ACTIVITY_VIEW_STORAGE_KEY)).toBeNull();
  });

  it("survives storage that throws or is unavailable", () => {
    expect(readStoredActivityView(throwingStorage())).toBeNull();
    expect(() => writeStoredActivityView("explorer", throwingStorage())).not.toThrow();
    expect(readStoredActivityView(null)).toBeNull();
    expect(() => writeStoredActivityView("explorer", null)).not.toThrow();
  });

  it("persists a view change made through the store, once", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    useActivityViewStore.getState().setRequestedViewId("explorer");
    useActivityViewStore.getState().setRequestedViewId("explorer");
    expect(useActivityViewStore.getState().requestedViewId).toBe("explorer");
    expect(setItem).toHaveBeenCalledExactlyOnceWith(ACTIVITY_VIEW_STORAGE_KEY, "explorer");
    setItem.mockRestore();
  });
});

describe("resolveActivityViewId", () => {
  it("falls back to Agents until the requested view is registered", () => {
    registerView("agents", 100);
    expect(resolveActivityViewId("bots", getActivityBarItems())).toBe(DEFAULT_ACTIVITY_VIEW_ID);
    registerView("bots", 150);
    expect(resolveActivityViewId("bots", getActivityBarItems())).toBe("bots");
    expect(resolveActivityViewId(null, getActivityBarItems())).toBe(DEFAULT_ACTIVITY_VIEW_ID);
  });

  it("never resolves to an action item", () => {
    registerActivityBarItem({
      id: "search",
      label: msg`Search`,
      icon: Icon,
      order: 300,
      action: () => {},
    });
    expect(resolveActivityViewId("search", getActivityBarItems())).toBe(DEFAULT_ACTIVITY_VIEW_ID);
  });
});

describe("decideActivityViewPress", () => {
  it("expands on the pressed view when collapsed", () => {
    expect(
      decideActivityViewPress({
        pressedViewId: "explorer",
        activeViewId: "agents",
        sidebarCollapsed: true,
      }),
    ).toEqual({ nextViewId: "explorer", sidebar: "expand" });
  });

  it("collapses when the shown view is pressed again", () => {
    expect(
      decideActivityViewPress({
        pressedViewId: "agents",
        activeViewId: "agents",
        sidebarCollapsed: false,
      }),
    ).toEqual({ nextViewId: "agents", sidebar: "collapse" });
  });

  it("switches views and keeps the sidebar open", () => {
    expect(
      decideActivityViewPress({
        pressedViewId: "explorer",
        activeViewId: "agents",
        sidebarCollapsed: false,
      }),
    ).toEqual({ nextViewId: "explorer", sidebar: "keep" });
  });
});

describe("pressActivityItem", () => {
  function registered(id: string): ActivityBarItem {
    const item = getActivityBarItem(id);
    if (!item) throw new Error(`missing ${id}`);
    return item;
  }

  it("follows Cursor's switch / collapse / expand behaviour", () => {
    registerView("agents", 100);
    registerView("explorer", 200);

    pressActivityItem(registered("explorer"));
    expect(getActiveActivityViewId()).toBe("explorer");
    expect(useSidebarOverlayStore.getState().isCollapsed).toBe(false);
    expect(localStorage.getItem(ACTIVITY_VIEW_STORAGE_KEY)).toBe("explorer");

    pressActivityItem(registered("explorer"));
    expect(useSidebarOverlayStore.getState().isCollapsed).toBe(true);
    expect(getActiveActivityViewId()).toBe("explorer");

    pressActivityItem(registered("agents"));
    expect(useSidebarOverlayStore.getState().isCollapsed).toBe(false);
    expect(getActiveActivityViewId()).toBe("agents");
  });

  it("runs an action item without touching the view or the sidebar", () => {
    const action = vi.fn<() => void>();
    registerView("agents", 100);
    registerActivityBarItem({ id: "search", label: msg`Search`, icon: Icon, order: 300, action });

    pressActivityItem(registered("search"));
    expect(action).toHaveBeenCalledTimes(1);
    expect(getActiveActivityViewId()).toBe("agents");
    expect(useSidebarOverlayStore.getState().isCollapsed).toBe(false);
  });
});
