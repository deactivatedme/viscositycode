/**
 * ViscosityCode built-in activity bar items. Each one reuses an existing
 * upstream surface (sidebar, file tree, command palette, git panel, browser
 * panel, Settings); nothing here owns new behaviour.
 *
 * Order leaves gaps so later fork steps can slot items between them (for
 * example Bots after Agents, Mission control after Explorer).
 */
import { msg } from "@lingui/core/macro";
import { lazy } from "react";
import { Files, GitBranch, Globe, MessagesSquare, Search, Settings2 } from "lucide-react";
import { isHomeProject } from "@/shared/homeScope";
import { openGitReview, openSettings, toggleBrowserPanel } from "@/renderer/actions/panelActions";
import { getCurrentProjectId } from "@/renderer/actions/currentProject";
import { useCommandPaletteStore } from "@/renderer/commands/commandPaletteStore";
import { DeferredSettingsOverlay } from "@/renderer/deferredFeatures";
import { selectFocusedThreadId } from "@/renderer/hooks/uiSelectors";
import { useAppStore } from "@/renderer/state/appStore";
import { useIsPanelTabVisible } from "@/renderer/state/panelDockSelectors";
import { usePanelStore } from "@/renderer/state/panelStore";
import {
  selectBrowserPanelAvailable,
  useRemoteServersStore,
} from "@/renderer/state/remoteServersStore";
import { getThreadMap } from "@/renderer/state/useThread";
import { ACTIVITY_HOST_VIEW, registerActivityBarItem } from "./activityBarRegistry";
import { DEFAULT_ACTIVITY_VIEW_ID } from "./activityViewPreference";
import { ExplorerHeaderAccessory } from "./ExplorerHeaderAccessory";

export const BUILTIN_ACTIVITY_ITEM_IDS = {
  agents: DEFAULT_ACTIVITY_VIEW_ID,
  explorer: "explorer",
  search: "search",
  sourceControl: "source-control",
  browser: "browser",
  settings: "settings",
} as const;

const ExplorerSidebarView = lazy(() =>
  import("./ExplorerSidebarView").then((module) => ({ default: module.ExplorerSidebarView })),
);

/** Project/worktree/thread the activity bar commands act on (focused thread first). */
export function resolveActivityCommandScope(): {
  projectId: string;
  worktreePath?: string;
  threadId?: string;
} | null {
  const state = useAppStore.getState();
  const threadId = selectFocusedThreadId(state);
  const thread = threadId ? getThreadMap(state.threads).get(threadId) : undefined;
  if (thread) {
    return {
      projectId: thread.projectId,
      ...(thread.worktreePath ? { worktreePath: thread.worktreePath } : {}),
      threadId: thread.id,
    };
  }
  const projectId =
    getCurrentProjectId() ?? state.projects.find((project) => !isHomeProject(project))?.id;
  return projectId ? { projectId } : null;
}

function openSearch(): void {
  useCommandPaletteStore.getState().open();
}

function useSearchOpen(): boolean {
  return useCommandPaletteStore((state) => state.isOpen);
}

/** Same toggle as the "Open Git Review" command: panel or page per the user's git setting. */
function toggleSourceControl(): void {
  const scope = resolveActivityCommandScope();
  if (!scope) return;
  openGitReview(scope.projectId, scope.worktreePath, scope.threadId);
}

function useSourceControlOpen(): boolean {
  const panelOpen = usePanelStore(
    (state) => state.gitReviewContext !== null && state.gitReviewAsPanel,
  );
  const pageOpen = usePanelStore((state) => state.gitOverlayOpen);
  const onScreen = useIsPanelTabVisible("git");
  return pageOpen || (panelOpen && onScreen);
}

function useHasProjects(): boolean {
  return useAppStore((state) => state.projects.some((project) => !isHomeProject(project)));
}

function useBrowserVisible(): boolean {
  const open = usePanelStore((state) => state.browserPanelOpen);
  const onScreen = useIsPanelTabVisible("browser");
  return open && onScreen;
}

function useBrowserAvailable(): boolean {
  return useRemoteServersStore(selectBrowserPanelAvailable);
}

function useSettingsOpen(): boolean {
  return usePanelStore((state) => state.settingsOpen);
}

function prewarmSettings(): void {
  void DeferredSettingsOverlay.preload();
}

let registered = false;

/** Idempotent: registers the built-in items once per renderer. */
export function registerBuiltinActivityItems(): void {
  if (registered) return;
  registered = true;
  registerActivityBarItem({
    id: BUILTIN_ACTIVITY_ITEM_IDS.agents,
    label: msg`Agents`,
    icon: MessagesSquare,
    order: 100,
    view: ACTIVITY_HOST_VIEW,
  });
  registerActivityBarItem({
    id: BUILTIN_ACTIVITY_ITEM_IDS.explorer,
    label: msg`Explorer`,
    icon: Files,
    order: 200,
    view: ExplorerSidebarView,
    viewHeaderAccessory: ExplorerHeaderAccessory,
  });
  registerActivityBarItem({
    id: BUILTIN_ACTIVITY_ITEM_IDS.search,
    label: msg`Search`,
    icon: Search,
    order: 300,
    action: openSearch,
    useIsActive: useSearchOpen,
  });
  registerActivityBarItem({
    id: BUILTIN_ACTIVITY_ITEM_IDS.sourceControl,
    label: msg`Source Control`,
    icon: GitBranch,
    order: 400,
    action: toggleSourceControl,
    toggle: true,
    useIsActive: useSourceControlOpen,
    useIsAvailable: useHasProjects,
  });
  registerActivityBarItem({
    id: BUILTIN_ACTIVITY_ITEM_IDS.browser,
    label: msg`Browser`,
    icon: Globe,
    order: 500,
    action: toggleBrowserPanel,
    toggle: true,
    useIsActive: useBrowserVisible,
    useIsAvailable: useBrowserAvailable,
  });
  registerActivityBarItem({
    id: BUILTIN_ACTIVITY_ITEM_IDS.settings,
    label: msg`Settings`,
    icon: Settings2,
    order: 1000,
    position: "bottom",
    action: openSettings,
    onPreload: prewarmSettings,
    useIsActive: useSettingsOpen,
  });
}
