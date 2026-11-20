// ViscosityCode: the built-in activity bar items (Step 2 checklist).
import { describe, expect, it } from "vitest";
import { getActivityBarItems, isActivityViewItem } from "./activityBarRegistry";
import { DEFAULT_ACTIVITY_VIEW_ID, resolveActivityViewId } from "./activityViewPreference";
import { BUILTIN_ACTIVITY_ITEM_IDS, registerBuiltinActivityItems } from "./builtinActivityItems";

describe("built-in activity bar items", () => {
  it("registers Chats, Search, Playbooks, Subscriptions and Cloud agents once, without Settings", () => {
    registerBuiltinActivityItems();
    registerBuiltinActivityItems();
    const items = getActivityBarItems();

    expect(items.map((item) => [item.id, item.position, item.order])).toEqual([
      [BUILTIN_ACTIVITY_ITEM_IDS.search, "top", 90],
      [BUILTIN_ACTIVITY_ITEM_IDS.agents, "top", 100],
      [BUILTIN_ACTIVITY_ITEM_IDS.playbooks, "top", 120],
      [BUILTIN_ACTIVITY_ITEM_IDS.subscriptions, "bottom", 100],
      [BUILTIN_ACTIVITY_ITEM_IDS.cloudAgents, "bottom", 110],
    ]);
    // The sidebar profile row owns Settings now.
    expect(items.map((item) => item.id)).not.toContain("settings");
    expect(items.filter(isActivityViewItem).map((item) => item.id)).toEqual(["agents"]);
    expect(items.filter((item) => item.toggle)).toEqual([]);
  });

  it("opens Agents for a view saved before Explorer left the sidebar (pre-upgrade)", () => {
    registerBuiltinActivityItems();
    // `viscosity:activity-view:v1` may still hold "explorer" from an older build.
    expect(resolveActivityViewId("explorer", getActivityBarItems())).toBe(DEFAULT_ACTIVITY_VIEW_ID);
  });
});
