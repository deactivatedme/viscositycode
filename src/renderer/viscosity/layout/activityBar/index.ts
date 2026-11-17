/**
 * ViscosityCode activity bar public API. Later fork steps (Bots, Mission
 * control, …) add their entry with `registerActivityBarItem` and need nothing
 * else from this folder.
 */
export {
  ACTIVITY_HOST_VIEW,
  type ActivityBarBadge,
  type ActivityBarIcon,
  type ActivityBarItem,
  type ActivityBarItemDefinition,
  type ActivityBarPosition,
  type ActivitySidebarView,
  type ActivitySidebarViewProps,
  getActivityBarItem,
  getActivityBarItems,
  registerActivityBarItem,
  subscribeActivityBarItems,
  useActivityBarItems,
} from "./activityBarRegistry";
export {
  ACTIVITY_VIEW_STORAGE_KEY,
  DEFAULT_ACTIVITY_VIEW_ID,
  getActiveActivityViewId,
  pressActivityItem,
  useActiveActivityViewId,
  useActivityViewStore,
} from "./activityViewPreference";
export { useActivityBarActive } from "./activityBarHost";
