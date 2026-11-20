/**
 * ViscosityCode: "show" actions for the left sidebar's views, for the palette
 * and keybindings. Unlike pressing an activity bar button, these only ever
 * reveal a view: they never collapse the sidebar.
 */
import { expandSidebar, useSidebarOverlayStore } from "@/renderer/state/sidebarOverlayStore";
import {
  getActivityBarItem,
  isActivityViewItem,
} from "@/renderer/viscosity/layout/activityBar/activityBarRegistry";
import { resolveActivityCommandScope } from "@/renderer/viscosity/layout/activityBar/builtinActivityItems";
import { useActivityViewStore } from "@/renderer/viscosity/layout/activityBar/activityViewPreference";
import { isViscosityShellActive } from "@/renderer/viscosity/shellFlag";

/**
 * Activity bar item ids the commands target. They mirror the registered ids
 * (`BUILTIN_ACTIVITY_ITEM_IDS`); a test keeps them in sync.
 */
export const ACTIVITY_ITEM_IDS = {
  agents: "agents",
} as const;

/** True when `id` is a registered sidebar view in this window's desktop shell. */
export function isActivityViewOffered(id: string): boolean {
  if (!isViscosityShellActive()) return false;
  const item = getActivityBarItem(id);
  return item !== undefined && isActivityViewItem(item);
}

/** Switch the left sidebar to a view, expanding a collapsed sidebar; never collapses it. */
export function showActivityView(id: string): void {
  if (!isActivityViewOffered(id)) return;
  useActivityViewStore.getState().setRequestedViewId(id);
  if (useSidebarOverlayStore.getState().isCollapsed) expandSidebar();
}

/** Changes and Explorer need a project to show (the right sidebar's git and files tabs). */
export function isSourceControlOffered(): boolean {
  return isViscosityShellActive() && resolveActivityCommandScope() !== null;
}
