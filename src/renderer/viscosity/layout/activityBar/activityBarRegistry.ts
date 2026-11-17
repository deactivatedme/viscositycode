/**
 * ViscosityCode activity bar registry (fork of Poracode).
 *
 * The activity bar (Cursor-style, far left of the main window) renders whatever
 * is registered here, so later fork steps (Bots, Mission control, …) add their
 * entry with one `registerActivityBarItem` call instead of editing the bar.
 *
 * An item is either a *view* (it owns a left-sidebar view and switches the
 * sidebar to it) or an *action* (it runs a command such as opening Search).
 * Optional hooks feed per-item state. Each registration gets its own
 * `StateProbe` component that calls exactly that registration's hooks, so the
 * hooks a mounted component calls never change (rules of hooks) and the bar
 * stays free of item-specific code.
 */
import type { MessageDescriptor } from "@lingui/core";
import { type ComponentType, type ReactNode, useSyncExternalStore } from "react";

export type ActivityBarPosition = "top" | "bottom";

/** A count (rendered, capped at 99+) or an unread dot. */
export type ActivityBarBadge = number | "dot";

export type ActivityBarIcon = ComponentType<{ className?: string }>;

export interface ActivitySidebarViewProps {
  /** False while the sidebar is collapsed or the window is hidden. */
  visible: boolean;
}

/**
 * Marker for a view the sidebar host renders itself (the built-in Agents list
 * is upstream's own sidebar content, so it cannot live in the registry).
 */
export const ACTIVITY_HOST_VIEW = "host" as const;

export type ActivitySidebarView =
  | ComponentType<ActivitySidebarViewProps>
  | typeof ACTIVITY_HOST_VIEW;

export interface ActivityBarItemDefinition {
  /** Stable id, also persisted as the remembered sidebar view. */
  id: string;
  label: MessageDescriptor;
  icon: ActivityBarIcon;
  /** Ascending sort key within its position group. */
  order: number;
  /** Defaults to "top". */
  position?: ActivityBarPosition;
  /** Left-sidebar view shown while this item is active. Exclusive with `action`. */
  view?: ActivitySidebarView;
  /** Trailing content for the view's title row (actions, root label, …). */
  viewHeaderAccessory?: ComponentType;
  /** Command run on press. Exclusive with `view`. */
  action?: () => void;
  /**
   * Action items only: pressing again undoes the press (show/hide a panel), so
   * the button exposes its `useIsActive` state as `aria-pressed`. View items
   * always report the shown view through `aria-current` instead.
   */
  toggle?: boolean;
  /** Warm a lazily loaded surface on hover/focus. */
  onPreload?: () => void;
  /** Badge shown on the icon; return null for none. */
  useBadge?: () => ActivityBarBadge | null;
  /** Active state for action items (a view item is active while it is the shown view). */
  useIsActive?: () => boolean;
  /** Hide the item while this returns false (e.g. a capability is unavailable). */
  useIsAvailable?: () => boolean;
}

/** Live per-item state read through the item's hooks. */
export interface ActivityBarItemState {
  available: boolean;
  /** Action items only; a view item is active while it is the shown view. */
  active: boolean;
  badge: ActivityBarBadge | null;
}

export type ActivityBarItemStateProbe = ComponentType<{
  render: (state: ActivityBarItemState) => ReactNode;
}>;

export interface ActivityBarItem {
  /** Unique per registration; use as the React key. */
  key: string;
  id: string;
  label: MessageDescriptor;
  icon: ActivityBarIcon;
  order: number;
  position: ActivityBarPosition;
  view: ActivitySidebarView | null;
  viewHeaderAccessory: ComponentType | null;
  action: (() => void) | null;
  /** Action items only: exposes the active state as `aria-pressed`. */
  toggle: boolean;
  onPreload: (() => void) | null;
  /** Calls this registration's state hooks and renders `render(state)`. */
  StateProbe: ActivityBarItemStateProbe;
}

const ACTIVITY_ITEM_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,63}$/i;

function useNoBadge(): ActivityBarBadge | null {
  return null;
}

function useNotActive(): boolean {
  return false;
}

function useAlwaysAvailable(): boolean {
  return true;
}

function createStateProbe(definition: ActivityBarItemDefinition): ActivityBarItemStateProbe {
  // Captured once per registration: a mounted probe always calls the same hooks.
  const useIsAvailable = definition.useIsAvailable ?? useAlwaysAvailable;
  const useIsActive = definition.useIsActive ?? useNotActive;
  const useBadge = definition.useBadge ?? useNoBadge;
  function ActivityBarItemStateProbe(props: {
    render: (state: ActivityBarItemState) => ReactNode;
  }) {
    const available = useIsAvailable();
    const active = useIsActive();
    const badge = useBadge();
    return props.render({ available, active, badge });
  }
  return ActivityBarItemStateProbe;
}

export function isValidActivityItemId(id: unknown): id is string {
  return typeof id === "string" && ACTIVITY_ITEM_ID_PATTERN.test(id);
}

export function isActivityViewItem(
  item: ActivityBarItem,
): item is ActivityBarItem & { view: ActivitySidebarView } {
  return item.view !== null;
}

/**
 * Display form of a badge: null when there is nothing to show, "" for a dot,
 * otherwise the count capped at "99+".
 */
export function formatActivityBarBadge(badge: ActivityBarBadge | null): string | null {
  if (badge === null) return null;
  if (badge === "dot") return "";
  if (!Number.isFinite(badge) || badge < 1) return null;
  return badge > 99 ? "99+" : String(Math.floor(badge));
}

const POSITION_RANK: Record<ActivityBarPosition, number> = { top: 0, bottom: 1 };

export function compareActivityBarItems(a: ActivityBarItem, b: ActivityBarItem): number {
  return (
    POSITION_RANK[a.position] - POSITION_RANK[b.position] ||
    a.order - b.order ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

let registrationCounter = 0;
const itemsById = new Map<string, ActivityBarItem>();
const listeners = new Set<() => void>();
const EMPTY_ITEMS: readonly ActivityBarItem[] = [];
let snapshot: readonly ActivityBarItem[] = EMPTY_ITEMS;

function publish(): void {
  snapshot =
    itemsById.size === 0 ? EMPTY_ITEMS : [...itemsById.values()].sort(compareActivityBarItems);
  for (const listener of listeners) listener();
}

function normalize(definition: ActivityBarItemDefinition): ActivityBarItem {
  if (!isValidActivityItemId(definition.id)) {
    throw new Error(`Invalid activity bar item id: ${String(definition.id)}`);
  }
  const hasView = definition.view !== undefined;
  const hasAction = definition.action !== undefined;
  if (hasView === hasAction) {
    throw new Error(`Activity bar item "${definition.id}" needs exactly one of view or action.`);
  }
  if (hasView && definition.toggle) {
    throw new Error(`Activity bar item "${definition.id}" is a view; only actions can toggle.`);
  }
  if (!Number.isFinite(definition.order)) {
    throw new Error(`Activity bar item "${definition.id}" needs a finite order.`);
  }
  registrationCounter += 1;
  return {
    key: `${definition.id}#${registrationCounter}`,
    id: definition.id,
    label: definition.label,
    icon: definition.icon,
    order: definition.order,
    position: definition.position ?? "top",
    view: definition.view ?? null,
    viewHeaderAccessory: definition.viewHeaderAccessory ?? null,
    action: definition.action ?? null,
    toggle: definition.toggle === true,
    onPreload: definition.onPreload ?? null,
    StateProbe: createStateProbe(definition),
  };
}

/**
 * Add (or replace, by id) an activity bar item. Returns an unregister function
 * that only removes this exact registration, so a stale cleanup (HMR, a later
 * re-registration) never drops its replacement.
 */
export function registerActivityBarItem(definition: ActivityBarItemDefinition): () => void {
  const item = normalize(definition);
  itemsById.set(item.id, item);
  publish();
  return () => {
    if (itemsById.get(item.id) !== item) return;
    itemsById.delete(item.id);
    publish();
  };
}

/** Sorted items: top group by order, then bottom group by order. Stable between changes. */
export function getActivityBarItems(): readonly ActivityBarItem[] {
  return snapshot;
}

export function getActivityBarItem(id: string): ActivityBarItem | undefined {
  return itemsById.get(id);
}

export function subscribeActivityBarItems(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useActivityBarItems(): readonly ActivityBarItem[] {
  return useSyncExternalStore(subscribeActivityBarItems, getActivityBarItems, getActivityBarItems);
}

/** Test helper: drop every registration. */
export function clearActivityBarRegistry(): void {
  if (itemsById.size === 0) return;
  itemsById.clear();
  publish();
}
