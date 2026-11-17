// ViscosityCode: the built-in activity bar items (Step 2 checklist).
import { describe, expect, it } from "vitest";
import { getActivityBarItems, isActivityViewItem } from "./activityBarRegistry";
import { BUILTIN_ACTIVITY_ITEM_IDS, registerBuiltinActivityItems } from "./builtinActivityItems";

describe("built-in activity bar items", () => {
  it("registers Agents, Explorer, Search, Source Control, Browser and Settings once", () => {
    registerBuiltinActivityItems();
    registerBuiltinActivityItems();
    const items = getActivityBarItems();

    expect(items.map((item) => [item.id, item.position])).toEqual([
      [BUILTIN_ACTIVITY_ITEM_IDS.agents, "top"],
      [BUILTIN_ACTIVITY_ITEM_IDS.explorer, "top"],
      [BUILTIN_ACTIVITY_ITEM_IDS.search, "top"],
      [BUILTIN_ACTIVITY_ITEM_IDS.sourceControl, "top"],
      [BUILTIN_ACTIVITY_ITEM_IDS.browser, "top"],
      [BUILTIN_ACTIVITY_ITEM_IDS.settings, "bottom"],
    ]);
    expect(items.filter(isActivityViewItem).map((item) => item.id)).toEqual(["agents", "explorer"]);
  });

  it("marks only the show/hide panels as toggle buttons", () => {
    registerBuiltinActivityItems();
    expect(
      getActivityBarItems()
        .filter((item) => item.toggle)
        .map((item) => item.id),
    ).toEqual([BUILTIN_ACTIVITY_ITEM_IDS.sourceControl, BUILTIN_ACTIVITY_ITEM_IDS.browser]);
  });
});
