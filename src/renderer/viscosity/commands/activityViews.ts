/**
 * ViscosityCode: "show" actions for the activity bar surfaces, for the
 * palette and keybindings. Unlike pressing an activity bar button, these only
 * ever reveal a surface: they never collapse the sidebar or close a panel
 * that is already showing what was asked for.
 */
import { openGitReview, toggleBrowserPanel } from "@/renderer/actions/panelActions";
import { usePanelStore } from "@/renderer/state/panelStore";
import {
  selectBrowserPanelAvailable,
  useRemoteServersStore,
} from "@/renderer/state/remoteServersStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
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
 * (`BUILTIN_ACTIVITY_ITEM_IDS`, `BOTS_ACTIVITY_ITEM_ID`); a test keeps them in
 * sync without pulling the Bots UI into the command registry's imports.
 */
export const ACTIVITY_ITEM_IDS = {
  agents: "agents",
  explorer: "explorer",
  bots: "bots",
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

export function isSourceControlOffered(): boolean {
  return isViscosityShellActive() && resolveActivityCommandScope() !== null;
}

/** The git review panel already shows this project/worktree in the right panel. */
function isSourceControlPanelShowing(scope: { projectId: string; worktreePath?: string }): boolean {
  if (useSharedSettings.getState().gitReviewMode !== "panel") return false;
  const panel = usePanelStore.getState();
  const context = panel.gitReviewContext;
  return (
    context !== null &&
    panel.gitReviewAsPanel &&
    panel.rightPanelTab === "git" &&
    context.projectId === scope.projectId &&
    context.worktreePath === scope.worktreePath
  );
}

/**
 * Show git review for the focused thread's project (the Source Control
 * button's scope), as a panel or a page per the user's git setting. Unlike
 * the button, it leaves an already showing panel open.
 */
export function showSourceControl(): void {
  if (!isViscosityShellActive()) return;
  const scope = resolveActivityCommandScope();
  if (!scope || isSourceControlPanelShowing(scope)) return;
  openGitReview(scope.projectId, scope.worktreePath, scope.threadId);
}

function browserAvailable(): boolean {
  return selectBrowserPanelAvailable(useRemoteServersStore.getState());
}

export function isBrowserOffered(): boolean {
  return isViscosityShellActive() && browserAvailable();
}

/** Show the browser panel; unlike the Browser button, it leaves an open panel open. */
export function showBrowser(): void {
  if (!isBrowserOffered()) return;
  const panel = usePanelStore.getState();
  if (panel.browserPanelOpen && panel.rightPanelTab === "browser") return;
  // Closed or behind another tab: the toggle opens it and brings it to the front.
  toggleBrowserPanel();
}
