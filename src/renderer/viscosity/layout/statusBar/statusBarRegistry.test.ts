import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearStatusBarRegistry,
  getStatusBarItems,
  isValidStatusBarItemId,
  registerStatusBarItem,
  subscribeStatusBarItems,
} from "./statusBarRegistry";

function Item() {
  return null;
}

afterEach(() => {
  clearStatusBarRegistry();
});

describe("statusBarRegistry", () => {
  it("sorts left items before right items, each by order then id", () => {
    registerStatusBarItem({ id: "right.b", align: "right", order: 10, component: Item });
    registerStatusBarItem({ id: "left.late", align: "left", order: 50, component: Item });
    registerStatusBarItem({ id: "right.a", align: "right", order: 10, component: Item });
    registerStatusBarItem({ id: "left.early", align: "left", order: 5, component: Item });
    expect(getStatusBarItems().map((item) => item.id)).toEqual([
      "left.early",
      "left.late",
      "right.a",
      "right.b",
    ]);
  });

  it("replaces an item registered again under the same id", () => {
    registerStatusBarItem({ id: "x", align: "left", order: 1, component: Item });
    registerStatusBarItem({ id: "x", align: "right", order: 2, component: Item });
    const items = getStatusBarItems();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: "x", align: "right", order: 2 });
  });

  it("gives each registration its own key and ignores stale unregisters", () => {
    const first = registerStatusBarItem({ id: "x", align: "left", order: 1, component: Item });
    const firstKey = getStatusBarItems()[0]!.key;
    const second = registerStatusBarItem({ id: "x", align: "left", order: 1, component: Item });
    expect(getStatusBarItems()[0]!.key).not.toBe(firstKey);
    first();
    expect(getStatusBarItems()).toHaveLength(1);
    second();
    expect(getStatusBarItems()).toEqual([]);
  });

  it("keeps the snapshot stable between changes and notifies subscribers", () => {
    const listener = vi.fn<() => void>();
    const unsubscribe = subscribeStatusBarItems(listener);
    registerStatusBarItem({ id: "x", align: "left", order: 1, component: Item });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getStatusBarItems()).toBe(getStatusBarItems());
    unsubscribe();
    registerStatusBarItem({ id: "y", align: "left", order: 2, component: Item });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid definitions", () => {
    expect(isValidStatusBarItemId("agents.waiting")).toBe(true);
    expect(isValidStatusBarItemId("")).toBe(false);
    expect(isValidStatusBarItemId("has space")).toBe(false);
    expect(() =>
      registerStatusBarItem({ id: "bad id", align: "left", order: 1, component: Item }),
    ).toThrow("Invalid status bar item id");
    expect(() =>
      registerStatusBarItem({
        id: "x",
        align: "center" as "left",
        order: 1,
        component: Item,
      }),
    ).toThrow('needs align "left" or "right"');
    expect(() =>
      registerStatusBarItem({ id: "x", align: "left", order: Number.NaN, component: Item }),
    ).toThrow("needs a finite order");
    expect(getStatusBarItems()).toEqual([]);
  });
});
