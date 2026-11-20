/**
 * ViscosityCode: the "N tools running" count across every turn-active chat
 * thread, visible or not.
 *
 * It subscribes to the app store OUTSIDE React and is strictly read-only.
 * Streaming deltas only replace the item map, so they return at the first
 * reference check; a thread's turn is rescanned only when its item list or
 * structural version moves.
 */
import type { AppStoreState } from "@/renderer/state/appStore";
import { getThreadMap } from "@/renderer/state/useThread";
import { deriveThreadActivity, getTurnActiveThreadIds } from "./derive";

export type ToolsMonitorState = Pick<
  AppStoreState,
  | "threads"
  | "runtimeItemIdsByThread"
  | "runtimeItemsByIdByThread"
  | "runtimeStructuralVersionByThread"
>;

export interface ToolsMonitorStore {
  getState(): ToolsMonitorState;
  subscribe(listener: (state: ToolsMonitorState) => void): () => void;
}

interface CachedCount {
  signature: string;
  tools: number;
}

/** Publish the running tool count now and on every relevant change; returns the stop. */
export function startToolsRunningMonitor(
  store: ToolsMonitorStore,
  setToolsRunning: (count: number) => void,
): () => void {
  let cache = new Map<string, CachedCount>();
  let last: ToolsMonitorState | null = null;

  function sync(state: ToolsMonitorState): void {
    if (
      last &&
      state.threads === last.threads &&
      state.runtimeItemIdsByThread === last.runtimeItemIdsByThread &&
      state.runtimeStructuralVersionByThread === last.runtimeStructuralVersionByThread
    ) {
      return;
    }
    last = state;
    const threadMap = getThreadMap(state.threads);
    const next = new Map<string, CachedCount>();
    let total = 0;
    for (const id of getTurnActiveThreadIds(state.threads)) {
      // Terminal (PTY) threads expose no runtime items.
      if (threadMap.get(id)?.presentationMode === "terminal") continue;
      const itemIds = state.runtimeItemIdsByThread[id];
      const signature = `${state.runtimeStructuralVersionByThread[id] ?? 0}|${itemIds?.length ?? 0}`;
      let entry = cache.get(id);
      if (entry?.signature !== signature) {
        const tools = deriveThreadActivity(
          itemIds,
          state.runtimeItemsByIdByThread[id],
        ).runningTools;
        entry = { signature, tools };
      }
      next.set(id, entry);
      total += entry.tools;
    }
    cache = next;
    setToolsRunning(total);
  }

  sync(store.getState());
  const unsubscribe = store.subscribe(sync);
  return () => {
    unsubscribe();
    setToolsRunning(0);
  };
}
