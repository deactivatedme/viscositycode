/**
 * ViscosityCode: which left-sidebar view the activity bar shows, remembered
 * per viewer in localStorage (a client view preference, never host state).
 */
import { create } from "zustand";
import {
  collapseSidebar,
  expandSidebar,
  useSidebarOverlayStore,
} from "@/renderer/state/sidebarOverlayStore";
import {
  type ActivityBarItem,
  getActivityBarItems,
  isActivityViewItem,
  isValidActivityItemId,
  useActivityBarItems,
} from "./activityBarRegistry";

export const ACTIVITY_VIEW_STORAGE_KEY = "viscosity:activity-view:v1";
/** The built-in Agents view (upstream's projects/threads sidebar). */
export const DEFAULT_ACTIVITY_VIEW_ID = "agents";

type ReadableStorage = Pick<Storage, "getItem">;
type WritableStorage = Pick<Storage, "setItem">;

function defaultStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** The remembered view id, or null when absent, malformed, or storage is blocked. */
export function readStoredActivityView(
  storage: ReadableStorage | null = defaultStorage(),
): string | null {
  if (!storage) return null;
  try {
    const value = storage.getItem(ACTIVITY_VIEW_STORAGE_KEY);
    return isValidActivityItemId(value) ? value : null;
  } catch {
    return null;
  }
}

export function writeStoredActivityView(
  viewId: string,
  storage: WritableStorage | null = defaultStorage(),
): void {
  if (!storage || !isValidActivityItemId(viewId)) return;
  try {
    storage.setItem(ACTIVITY_VIEW_STORAGE_KEY, viewId);
  } catch {
    // Best-effort view preference (private mode, quota, blocked site data).
  }
}

/**
 * The view to show for a requested id: the request when it names a registered
 * view, else the default Agents view. The request itself is kept, so a view
 * registered later (e.g. by a lazily loaded feature) is restored once it lands.
 */
export function resolveActivityViewId(
  requestedId: string | null,
  items: readonly ActivityBarItem[],
): string {
  if (requestedId !== null) {
    const requested = items.find((item) => item.id === requestedId);
    if (requested && isActivityViewItem(requested)) return requested.id;
  }
  return DEFAULT_ACTIVITY_VIEW_ID;
}

export type ActivityViewPressDecision = {
  nextViewId: string;
  sidebar: "expand" | "collapse" | "keep";
};

/**
 * Cursor behaviour: pressing the shown view's item toggles the sidebar closed;
 * pressing any view item while collapsed opens the sidebar on that view;
 * pressing another view item switches views and leaves the sidebar open.
 */
export function decideActivityViewPress(input: {
  pressedViewId: string;
  activeViewId: string;
  sidebarCollapsed: boolean;
}): ActivityViewPressDecision {
  if (input.sidebarCollapsed) {
    return { nextViewId: input.pressedViewId, sidebar: "expand" };
  }
  if (input.pressedViewId === input.activeViewId) {
    return { nextViewId: input.activeViewId, sidebar: "collapse" };
  }
  return { nextViewId: input.pressedViewId, sidebar: "keep" };
}

interface ActivityViewState {
  /** The user's choice; may name a view that is not registered (yet). */
  requestedViewId: string;
  setRequestedViewId: (viewId: string) => void;
}

export const useActivityViewStore = create<ActivityViewState>()((set, get) => ({
  requestedViewId: readStoredActivityView() ?? DEFAULT_ACTIVITY_VIEW_ID,
  setRequestedViewId: (viewId) => {
    if (!isValidActivityItemId(viewId) || get().requestedViewId === viewId) return;
    set({ requestedViewId: viewId });
    writeStoredActivityView(viewId);
  },
}));

export function getActiveActivityViewId(): string {
  return resolveActivityViewId(
    useActivityViewStore.getState().requestedViewId,
    getActivityBarItems(),
  );
}

export function useActiveActivityViewId(): string {
  const requestedViewId = useActivityViewStore((state) => state.requestedViewId);
  const items = useActivityBarItems();
  return resolveActivityViewId(requestedViewId, items);
}

/** Activate a registered item: switch/toggle its sidebar view, or run its action. */
export function pressActivityItem(item: ActivityBarItem): void {
  if (!isActivityViewItem(item)) {
    item.action?.();
    return;
  }
  const decision = decideActivityViewPress({
    pressedViewId: item.id,
    activeViewId: getActiveActivityViewId(),
    sidebarCollapsed: useSidebarOverlayStore.getState().isCollapsed,
  });
  useActivityViewStore.getState().setRequestedViewId(decision.nextViewId);
  if (decision.sidebar === "collapse") collapseSidebar();
  else if (decision.sidebar === "expand") expandSidebar();
}
