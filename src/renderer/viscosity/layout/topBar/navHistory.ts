/**
 * ViscosityCode: back/forward history of focused threads for the desktop
 * shell's nav controls. In memory only (never persisted), capped at
 * NAV_HISTORY_CAP entries. Threads that can no longer be opened (deleted or
 * archived) are skipped. Navigation goes through `activateThreadTab`, so it
 * follows the same rules as every other fork link.
 */
import { useSyncExternalStore } from "react";
import { selectFocusedThreadId } from "@/renderer/hooks/uiSelectors";
import { useAppStore } from "@/renderer/state/appStore";
import { isOpenableThread } from "../tabs/openTabsStore";
import { activateThreadTab } from "../tabs/tabActions";

export const NAV_HISTORY_CAP = 50;

let entries: string[] = [];
let index = -1;
// Focus left entries[index] for a draft/home (no thread): Back returns to it.
let detached = false;
let version = 0;
const listeners = new Set<() => void>();

function publish(): void {
  version += 1;
  for (const listener of listeners) listener();
}

/** Record a newly focused thread; a new navigation drops the forward stack. */
export function recordNavFocus(threadId: string | null): void {
  if (!threadId || entries[index] === threadId) {
    // Keep the forward stack: a brief null focus must not destroy history.
    const nextDetached = !threadId && index !== -1;
    if (nextDetached !== detached) {
      detached = nextDetached;
      publish();
    }
    return;
  }
  entries = [...entries.slice(0, index + 1), threadId].slice(-NAV_HISTORY_CAP);
  index = entries.length - 1;
  detached = false;
  publish();
}

function findOpenable(step: -1 | 1): number {
  // From a draft, Back reopens the thread just left and there is nothing forward.
  if (detached && step === 1) return -1;
  const start = detached ? index : index + step;
  for (let at = start; at >= 0 && at < entries.length; at += step) {
    if (isOpenableThread(entries[at]!)) return at;
  }
  return -1;
}

function go(step: -1 | 1): void {
  const target = findOpenable(step);
  if (target === -1) return;
  index = target;
  detached = false;
  publish();
  // Focus lands on entries[index], so the focus subscription records nothing.
  activateThreadTab(entries[index]!);
}

export function navigateBack(): void {
  go(-1);
}

export function navigateForward(): void {
  go(1);
}

export function canNavigateBack(): boolean {
  return findOpenable(-1) !== -1;
}

export function canNavigateForward(): boolean {
  return findOpenable(1) !== -1;
}

/** Feed the history from the focused thread. Returns the unsubscribe. */
export function startNavHistory(): () => void {
  recordNavFocus(selectFocusedThreadId(useAppStore.getState()));
  return useAppStore.subscribe((state, previous) => {
    const focused = selectFocusedThreadId(state);
    if (focused !== selectFocusedThreadId(previous)) recordNavFocus(focused);
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getVersion(): number {
  return version;
}

/** Back/forward availability; re-checked when the history or the threads change. */
export function useNavHistoryState(): { canBack: boolean; canForward: boolean } {
  useSyncExternalStore(subscribe, getVersion, getVersion);
  // Booleans, so thread updates re-render only when an answer flips.
  const canBack = useAppStore(() => canNavigateBack());
  const canForward = useAppStore(() => canNavigateForward());
  return { canBack, canForward };
}

/** Test helper. */
export function resetNavHistory(): void {
  entries = [];
  index = -1;
  detached = false;
  publish();
}
