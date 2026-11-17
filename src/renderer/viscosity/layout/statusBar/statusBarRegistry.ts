/**
 * ViscosityCode status bar registry (fork of Poracode).
 *
 * The status bar along the bottom of the main window renders whatever is
 * registered here, so later fork steps add an item with one
 * `registerStatusBarItem` call instead of editing the bar. Items render their
 * own content (and return null to hide); they must subscribe with narrow,
 * primitive selectors so the bar never re-renders on streaming deltas.
 */
import { type ComponentType, useSyncExternalStore } from "react";

export type StatusBarAlign = "left" | "right";

export interface StatusBarItemDefinition {
  /** Stable id; registering the same id again replaces the item. */
  id: string;
  align: StatusBarAlign;
  /** Ascending sort key within its side (left items read left to right, right items too). */
  order: number;
  component: ComponentType;
}

export interface StatusBarItem extends StatusBarItemDefinition {
  /** Unique per registration; use as the React key. */
  key: string;
}

const STATUS_ITEM_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,63}$/i;

export function isValidStatusBarItemId(id: unknown): id is string {
  return typeof id === "string" && STATUS_ITEM_ID_PATTERN.test(id);
}

const ALIGN_RANK: Record<StatusBarAlign, number> = { left: 0, right: 1 };

export function compareStatusBarItems(a: StatusBarItem, b: StatusBarItem): number {
  return (
    ALIGN_RANK[a.align] - ALIGN_RANK[b.align] ||
    a.order - b.order ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

let registrationCounter = 0;
const itemsById = new Map<string, StatusBarItem>();
const listeners = new Set<() => void>();
const EMPTY_ITEMS: readonly StatusBarItem[] = [];
let snapshot: readonly StatusBarItem[] = EMPTY_ITEMS;

function publish(): void {
  snapshot =
    itemsById.size === 0 ? EMPTY_ITEMS : [...itemsById.values()].sort(compareStatusBarItems);
  for (const listener of listeners) listener();
}

function normalize(definition: StatusBarItemDefinition): StatusBarItem {
  if (!isValidStatusBarItemId(definition.id)) {
    throw new Error(`Invalid status bar item id: ${String(definition.id)}`);
  }
  if (definition.align !== "left" && definition.align !== "right") {
    throw new Error(`Status bar item "${definition.id}" needs align "left" or "right".`);
  }
  if (!Number.isFinite(definition.order)) {
    throw new Error(`Status bar item "${definition.id}" needs a finite order.`);
  }
  registrationCounter += 1;
  return {
    key: `${definition.id}#${registrationCounter}`,
    id: definition.id,
    align: definition.align,
    order: definition.order,
    component: definition.component,
  };
}

/**
 * Add (or replace, by id) a status bar item. Returns an unregister function
 * that only removes this exact registration, so a stale cleanup (HMR, a later
 * re-registration) never drops its replacement.
 */
export function registerStatusBarItem(definition: StatusBarItemDefinition): () => void {
  const item = normalize(definition);
  itemsById.set(item.id, item);
  publish();
  return () => {
    if (itemsById.get(item.id) !== item) return;
    itemsById.delete(item.id);
    publish();
  };
}

/** Sorted items: left side by order, then right side by order. Stable between changes. */
export function getStatusBarItems(): readonly StatusBarItem[] {
  return snapshot;
}

export function subscribeStatusBarItems(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useStatusBarItems(): readonly StatusBarItem[] {
  return useSyncExternalStore(subscribeStatusBarItems, getStatusBarItems, getStatusBarItems);
}

/** Test helper: drop every registration. */
export function clearStatusBarRegistry(): void {
  if (itemsById.size === 0) return;
  itemsById.clear();
  publish();
}
