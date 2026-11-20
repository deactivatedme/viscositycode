/**
 * ViscosityCode: which mounted playbook picker the palette commands act on.
 *
 * Each composer chip registers under its pane key (the thread id, or the
 * draft pane id). Commands resolve the focused pane the way the command
 * registry does and fall back to the only mounted picker.
 */
import { useSyncExternalStore } from "react";
import { resolveActivePaneId } from "@/renderer/actions/currentProject";
import { useAppStore } from "@/renderer/state/appStore";
import type { ThreadConfig } from "@/shared/contracts";

export interface PlaybookTarget {
  openPicker: () => void;
  /** Apply a catalog playbook by id, or turn the playbook off with null. */
  apply: (playbookId: string | null) => void;
}

const targets = new Map<string, PlaybookTarget>();

export function registerPlaybookTarget(key: string, target: PlaybookTarget): () => void {
  targets.set(key, target);
  return () => {
    if (targets.get(key) === target) targets.delete(key);
  };
}

function focusedPaneKey(): string | undefined {
  const app = useAppStore.getState();
  if (app.view.kind === "thread") return resolveActivePaneId(app.view.panes, app.focusedPaneId);
  if (app.view.kind === "draft") return `draft:${app.view.projectId}`;
  return undefined;
}

export function activePlaybookTarget(): PlaybookTarget | undefined {
  const key = focusedPaneKey();
  const exact = key ? targets.get(key) : undefined;
  if (exact) return exact;
  return targets.size === 1 ? targets.values().next().value : undefined;
}

/** A mounted picker's current playbook (null or undefined: none), by pane key. */
export interface PanePlaybook {
  playbook: ThreadConfig["playbook"];
}

const panePlaybooks = new Map<string, PanePlaybook>();
const paneListeners = new Set<() => void>();

function notifyPanes(): void {
  for (const listener of paneListeners) listener();
}

export function registerPanePlaybook(key: string, playbook: ThreadConfig["playbook"]): () => void {
  const entry: PanePlaybook = { playbook };
  panePlaybooks.set(key, entry);
  notifyPanes();
  return () => {
    if (panePlaybooks.get(key) !== entry) return;
    panePlaybooks.delete(key);
    notifyPanes();
  };
}

function subscribePanes(listener: () => void): () => void {
  paneListeners.add(listener);
  return () => paneListeners.delete(listener);
}

/** The picker mounted for `key`, or undefined when none is. */
export function usePanePlaybook(key: string | undefined): PanePlaybook | undefined {
  return useSyncExternalStore(
    subscribePanes,
    () => (key ? panePlaybooks.get(key) : undefined),
    () => undefined,
  );
}
