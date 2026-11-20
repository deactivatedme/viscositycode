/**
 * ViscosityCode right sidebar (fork of Poracode): upstream's right panel
 * (Changes, Files, Notes, Usage, Browser, … with its own tab icons) is the
 * right sidebar. The left sidebar holds chats; these actions back the
 * tab-strip toggle and the right-sidebar shortcuts. Every one reuses an
 * upstream panel action, so the right panel owns no new state.
 *
 * The "show" actions only ever reveal a tab: unlike the panel's own icons
 * they never close a tab that is already showing, and a tab docked in the
 * bottom row is pulled back first (as the panel's icons do).
 */
import { isHomeProjectId } from "@/shared/homeScope";
import {
  closeAllPanels,
  dismissRightOverlay,
  showFilesPanel,
  showGitReviewPanel,
  toggleBrowserPanel,
  undockPanelTab,
} from "@/renderer/actions/panelActions";
import { showTerminalPanel } from "@/renderer/actions/terminalActions";
import { usePanelStore, type RightPanelTab } from "@/renderer/state/panelStore";
import {
  selectBrowserPanelAvailable,
  useRemoteServersStore,
} from "@/renderer/state/remoteServersStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { resolveActivityCommandScope } from "@/renderer/viscosity/layout/activityBar/builtinActivityItems";
import { isViscosityShellActive } from "@/renderer/viscosity/shellFlag";
import { exitZenMode, isZenModeActive } from "@/renderer/viscosity/zen/zenModeStore";

/** The right sidebar tabs the shortcuts jump to. */
export type RightSidebarTab = "git" | "files" | "notes" | "usage" | "browser";

// Mirrored by the always-mounted tab-strip toggle from upstream's
// `usePanelVisibility().sidePanelOpen`, so commands outside React read the
// same answer the panel uses instead of re-deriving its rules.
let openSnapshot = false;

export function isRightSidebarOpen(): boolean {
  return openSnapshot;
}

export function setRightSidebarOpenSnapshot(open: boolean): void {
  openSnapshot = open;
}

function terminalOnRight(): boolean {
  return useSharedSettings.getState().terminalPosition === "right";
}

function browserAvailable(): boolean {
  return selectBrowserPanelAvailable(useRemoteServersStore.getState());
}

/** A project scope with a repository (Changes and Files need one; Home has none). */
function repoScope(): ReturnType<typeof resolveActivityCommandScope> {
  const scope = resolveActivityCommandScope();
  return scope && !isHomeProjectId(scope.projectId) ? scope : null;
}

export function isBrowserOffered(): boolean {
  return isViscosityShellActive() && browserAvailable();
}

/** Show the browser tab; unlike the panel's Browser icon, it leaves an open browser open. */
export function showBrowser(): void {
  if (!isBrowserOffered()) return;
  const panel = usePanelStore.getState();
  if (panel.browserPanelOpen && panel.rightPanelTab === "browser") return;
  // Closed or behind another tab: the toggle opens it and brings it to the front.
  toggleBrowserPanel();
}

/** Hide the right sidebar the way the pane header's launcher does. */
export function hideRightSidebar(): void {
  // A right-docked terminal is part of the right panel; a bottom one is not and survives.
  if (terminalOnRight()) dismissRightOverlay();
  else closeAllPanels();
}

/** Open the right sidebar on `tab`. Changes and Files fall back to Usage without a project. */
export function showRightSidebarTab(tab: RightSidebarTab): void {
  if (!isViscosityShellActive()) return;
  // Zen hides the right sidebar, so showing a tab leaves Zen first.
  if (isZenModeActive()) exitZenMode();
  switch (tab) {
    case "git":
    case "files": {
      const scope = repoScope();
      if (!scope) {
        showRightSidebarTab("usage");
        return;
      }
      undockPanelTab(tab);
      if (tab === "git") showGitReviewPanel(scope.projectId, scope.worktreePath, scope.threadId);
      else showFilesPanel(scope.projectId, scope.worktreePath);
      return;
    }
    case "notes":
      undockPanelTab("notes");
      usePanelStore.getState().openNotesPanel();
      return;
    case "usage":
      undockPanelTab("usage");
      usePanelStore.getState().openUsagePanel();
      return;
    case "browser":
      undockPanelTab("browser");
      showBrowser();
      return;
  }
}

/**
 * Which tab reopening the sidebar shows: the last one, when it can show here;
 * a bottom terminal and temporary tabs (thread info, subagent, side chat,
 * devices, ports) reopen on Changes; without a project, on Usage.
 */
export function resolveReopenTab(
  tab: RightPanelTab,
  env: { terminalOnRight: boolean; hasRepoScope: boolean; browserAvailable: boolean },
): RightSidebarTab | "terminal" {
  const fallback = env.hasRepoScope ? "git" : "usage";
  switch (tab) {
    case "git":
    case "files":
      return env.hasRepoScope ? tab : "usage";
    case "notes":
    case "usage":
      return tab;
    case "browser":
      return env.browserAvailable ? "browser" : fallback;
    case "terminal":
      return env.terminalOnRight && env.hasRepoScope ? "terminal" : fallback;
    default:
      return fallback;
  }
}

/** The tab-strip button and its shortcut: hide an open right sidebar, else reopen its last tab. */
export function toggleRightSidebar(): void {
  if (!isViscosityShellActive()) return;
  if (isZenModeActive()) {
    // Zen hides an open sidebar (the button shows it closed): leaving Zen reveals it.
    exitZenMode();
    if (isRightSidebarOpen()) return;
  } else if (isRightSidebarOpen()) {
    hideRightSidebar();
    return;
  }
  const scope = repoScope();
  const tab = resolveReopenTab(usePanelStore.getState().rightPanelTab, {
    terminalOnRight: terminalOnRight(),
    hasRepoScope: scope !== null,
    browserAvailable: browserAvailable(),
  });
  if (tab === "terminal") {
    if (scope) showTerminalPanel(scope.projectId, scope.worktreePath);
    return;
  }
  showRightSidebarTab(tab);
}
