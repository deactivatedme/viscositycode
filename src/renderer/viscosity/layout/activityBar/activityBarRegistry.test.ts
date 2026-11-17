import { msg } from "@lingui/core/macro";
import { act, render, screen } from "@testing-library/react";
import { createElement, useSyncExternalStore } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ACTIVITY_HOST_VIEW,
  type ActivityBarItemDefinition,
  type ActivityBarItemState,
  clearActivityBarRegistry,
  formatActivityBarBadge,
  getActivityBarItem,
  getActivityBarItems,
  isActivityViewItem,
  registerActivityBarItem,
  subscribeActivityBarItems,
} from "./activityBarRegistry";

function Icon() {
  return null;
}

type Extra = Partial<Omit<ActivityBarItemDefinition, "id" | "view" | "action">>;

function item(id: string, extra: Extra = {}): ActivityBarItemDefinition {
  return { id, label: msg`Item`, icon: Icon, order: 100, action: () => {}, ...extra };
}

function viewItem(id: string, extra: Extra = {}): ActivityBarItemDefinition {
  return { id, label: msg`View`, icon: Icon, order: 100, view: ACTIVITY_HOST_VIEW, ...extra };
}

afterEach(() => {
  clearActivityBarRegistry();
});

describe("activity bar registry", () => {
  it("sorts the top group by order before the bottom group", () => {
    registerActivityBarItem(item("settings", { order: 10, position: "bottom" }));
    registerActivityBarItem(item("search", { order: 300 }));
    registerActivityBarItem(viewItem("agents", { order: 100 }));
    registerActivityBarItem(item("bots", { order: 150 }));

    expect(getActivityBarItems().map((entry) => entry.id)).toEqual([
      "agents",
      "bots",
      "search",
      "settings",
    ]);
  });

  it("breaks order ties by id so the bar is deterministic", () => {
    registerActivityBarItem(item("zeta", { order: 1 }));
    registerActivityBarItem(item("alpha", { order: 1 }));
    expect(getActivityBarItems().map((entry) => entry.id)).toEqual(["alpha", "zeta"]);
  });

  it("replaces an item registered again under the same id with a new React key", () => {
    registerActivityBarItem(item("bots", { order: 150 }));
    const firstKey = getActivityBarItem("bots")?.key;
    registerActivityBarItem(item("bots", { order: 160 }));

    expect(getActivityBarItems()).toHaveLength(1);
    expect(getActivityBarItem("bots")?.order).toBe(160);
    expect(getActivityBarItem("bots")?.key).not.toBe(firstKey);
  });

  it("keeps a replacement when the replaced registration's cleanup runs late", () => {
    const unregisterFirst = registerActivityBarItem(item("bots", { order: 150 }));
    const unregisterSecond = registerActivityBarItem(item("bots", { order: 160 }));

    unregisterFirst();
    expect(getActivityBarItem("bots")?.order).toBe(160);

    unregisterSecond();
    expect(getActivityBarItem("bots")).toBeUndefined();
  });

  it("notifies subscribers and keeps the snapshot stable between changes", () => {
    const listener = vi.fn<() => void>();
    const unsubscribe = subscribeActivityBarItems(listener);
    registerActivityBarItem(item("search"));
    expect(listener).toHaveBeenCalledTimes(1);

    const snapshot = getActivityBarItems();
    expect(getActivityBarItems()).toBe(snapshot);

    unsubscribe();
    registerActivityBarItem(item("browser"));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("normalizes defaults and distinguishes view items from action items", () => {
    registerActivityBarItem(item("search"));
    registerActivityBarItem(viewItem("explorer"));

    const search = getActivityBarItem("search")!;
    expect(search.position).toBe("top");
    expect(search.view).toBeNull();
    expect(search.toggle).toBe(false);
    expect(isActivityViewItem(search)).toBe(false);
    expect(isActivityViewItem(getActivityBarItem("explorer")!)).toBe(true);
  });

  it("rejects malformed definitions", () => {
    expect(() => registerActivityBarItem(item(""))).toThrow(/Invalid activity bar item id/);
    expect(() => registerActivityBarItem(item("has space"))).toThrow(/Invalid/);
    expect(() => registerActivityBarItem({ ...item("both"), view: ACTIVITY_HOST_VIEW })).toThrow(
      /exactly one of view or action/,
    );
    expect(() =>
      registerActivityBarItem({ id: "neither", label: msg`Neither`, icon: Icon, order: 1 }),
    ).toThrow(/exactly one of view or action/);
    expect(() => registerActivityBarItem(viewItem("toggling-view", { toggle: true }))).toThrow(
      /only actions can toggle/,
    );
    expect(() => registerActivityBarItem(item("nan", { order: Number.NaN }))).toThrow(
      /finite order/,
    );
    expect(getActivityBarItems()).toHaveLength(0);
  });

  it("keeps the toggle flag of action items", () => {
    registerActivityBarItem(item("browser", { toggle: true }));
    expect(getActivityBarItem("browser")?.toggle).toBe(true);
  });

  it("feeds each registration's own hooks through its state probe", () => {
    let badge: number | null = 3;
    const listeners = new Set<() => void>();
    function useBadge() {
      // A real hook call, to prove the probe runs hooks in render.
      return useSyncValue(() => badge, listeners);
    }
    registerActivityBarItem(
      item("bots", { useBadge, useIsActive: () => true, useIsAvailable: () => true }),
    );
    registerActivityBarItem(item("plain"));

    const seen: Record<string, ActivityBarItemState> = {};
    for (const entry of getActivityBarItems()) {
      render(
        createElement(entry.StateProbe, {
          render: (state: ActivityBarItemState) => {
            seen[entry.id] = state;
            return createElement("span", null, entry.id);
          },
        }),
      );
    }
    expect(screen.getByText("bots")).toBeInTheDocument();
    expect(seen.bots).toEqual({ available: true, active: true, badge: 3 });
    expect(seen.plain).toEqual({ available: true, active: false, badge: null });

    act(() => {
      badge = 7;
      for (const listener of listeners) listener();
    });
    expect(seen.bots?.badge).toBe(7);
  });
});

describe("formatActivityBarBadge", () => {
  it("formats counts, dots and empty badges", () => {
    expect(formatActivityBarBadge(null)).toBeNull();
    expect(formatActivityBarBadge(0)).toBeNull();
    expect(formatActivityBarBadge(-2)).toBeNull();
    expect(formatActivityBarBadge(Number.NaN)).toBeNull();
    expect(formatActivityBarBadge("dot")).toBe("");
    expect(formatActivityBarBadge(4)).toBe("4");
    expect(formatActivityBarBadge(99)).toBe("99");
    expect(formatActivityBarBadge(100)).toBe("99+");
  });
});

// Minimal external-store hook so the probe test exercises a genuine hook.
function useSyncValue<T>(get: () => T, listeners: Set<() => void>): T {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    get,
    get,
  );
}
