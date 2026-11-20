/**
 * ViscosityCode open-thread tabs store (fork of Poracode).
 *
 * Holds the ids of the threads open as tabs in the main window. It is a
 * per-device client view preference (ARCHITECTURE_NOTES §8.6), persisted in
 * this renderer's local storage under {@link OPEN_TABS_STORAGE_KEY}; the host
 * settings and the persisted pane layout are never touched. Unreadable or
 * blocked storage degrades to an in-memory list.
 */
import { create } from "zustand";
import { useShallow } from "zustand/shallow";
import type { Project } from "@/shared/contracts";
import { useAppStore } from "@/renderer/state/appStore";
import { getThreadMap } from "@/renderer/state/useThread";
import {
  INITIAL_OPEN_TABS_SYNC_STATE,
  OPEN_TABS_STORAGE_KEY,
  type OpenTabsSnapshot,
  parseStoredOpenTabs,
  removeOpenTab,
  selectRenderableTabs,
  serializeOpenTabs,
  stepOpenTabsSync,
} from "./openTabsModel";

type TabsStorage = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): TabsStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    // Storage can be blocked (sandboxed or privacy-restricted contexts).
    return null;
  }
}

export function readStoredOpenTabs(
  storage: TabsStorage | null = defaultStorage(),
): readonly string[] {
  try {
    return parseStoredOpenTabs(storage?.getItem(OPEN_TABS_STORAGE_KEY));
  } catch {
    return parseStoredOpenTabs(null);
  }
}

export function writeStoredOpenTabs(
  ids: readonly string[],
  storage: TabsStorage | null = defaultStorage(),
): void {
  try {
    storage?.setItem(OPEN_TABS_STORAGE_KEY, serializeOpenTabs(ids));
  } catch {
    // Quota or blocked storage: keep the in-memory list for this session.
  }
}

interface OpenTabsState {
  ids: readonly string[];
}

export const useOpenTabsStore = create<OpenTabsState>()(() => ({
  ids: readStoredOpenTabs(),
}));

useOpenTabsStore.subscribe((state, previous) => {
  if (state.ids !== previous.ids) writeStoredOpenTabs(state.ids);
});

export function setOpenTabIds(ids: readonly string[]): void {
  if (useOpenTabsStore.getState().ids === ids) return;
  useOpenTabsStore.setState({ ids });
}

export function closeOpenTab(threadId: string): void {
  setOpenTabIds(removeOpenTab(useOpenTabsStore.getState().ids, threadId));
}

type AppState = ReturnType<typeof useAppStore.getState>;

const projectIdSetCache = new WeakMap<readonly Project[], ReadonlySet<string>>();

function getProjectIdSet(projects: readonly Project[]): ReadonlySet<string> {
  let ids = projectIdSetCache.get(projects);
  if (!ids) {
    ids = new Set(projects.map((project) => project.id));
    projectIdSetCache.set(projects, ids);
  }
  return ids;
}

const NO_PANES: readonly string[] = [];

export function openTabsSnapshot(state: AppState): OpenTabsSnapshot {
  return {
    visiblePaneIds: state.view.kind === "thread" ? state.view.panes : NO_PANES,
    threads: getThreadMap(state.threads),
    projectIds: getProjectIdSet(state.projects),
  };
}

/**
 * Keep the tab list in step with the app store, outside React: open a tab for
 * every thread that appears on screen and drop archived or deleted ones.
 * Returns the unsubscribe.
 */
export function startOpenTabsSync(): () => void {
  let sync = INITIAL_OPEN_TABS_SYNC_STATE;
  const run = (state: AppState) => {
    const result = stepOpenTabsSync(useOpenTabsStore.getState().ids, sync, openTabsSnapshot(state));
    sync = result.sync;
    setOpenTabIds(result.tabs);
  };
  run(useAppStore.getState());
  return useAppStore.subscribe((state, previous) => {
    if (
      state.view === previous.view &&
      state.threads === previous.threads &&
      state.projects === previous.projects
    ) {
      return;
    }
    run(state);
  });
}

/** Non-subscribing read of the tabs the strip currently shows. */
export function getRenderableTabIds(): readonly string[] {
  return selectRenderableTabs(
    useOpenTabsStore.getState().ids,
    getThreadMap(useAppStore.getState().threads),
  );
}

/** Tabs the strip shows. Re-renders only when that id list changes. */
export function useRenderableTabIds(): readonly string[] {
  const ids = useOpenTabsStore((state) => state.ids);
  return useAppStore(useShallow((state) => selectRenderableTabs(ids, getThreadMap(state.threads))));
}

/**
 * A thread can be opened only while it is loaded and not archived, so no fork
 * link (Mission Control, status bar, Roundtable) brings a deleted chat back.
 */
function isOpenable(threads: AppState["threads"], threadId: string | undefined): boolean {
  if (!threadId) return false;
  const thread = getThreadMap(threads).get(threadId);
  return thread !== undefined && !thread.archived;
}

/** Non-subscribing: whether `threadId` is a live (loaded, not archived) thread. */
export function isOpenableThread(threadId: string): boolean {
  return isOpenable(useAppStore.getState().threads, threadId);
}

/** Whether `threadId` is a live thread; re-renders only when that answer changes. */
export function useIsOpenableThread(threadId: string | undefined): boolean {
  return useAppStore((state) => isOpenable(state.threads, threadId));
}

/** The ids in `threadIds` that are live threads (a stable list while that set holds). */
export function useOpenableThreadIds(threadIds: readonly string[]): readonly string[] {
  return useAppStore(
    useShallow((state) => threadIds.filter((threadId) => isOpenable(state.threads, threadId))),
  );
}
