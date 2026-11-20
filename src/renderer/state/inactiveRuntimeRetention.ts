// Modified for ViscosityCode (fork of Poracode). See FORK_CHANGES.md.
import type { AppStoreState } from "./slices/shared";
import { estimateCacheValueBytes } from "./browserMetadataCacheProjection";
import { isLightweightActive } from "@/renderer/viscosity/performance/lightweight"; // ViscosityCode:

// Admission estimates of retained UTF-16 content/objects, not private heap or
// native allocations. Active readers are exempt; canonical history stays on the host.
// Pending authorization requests are not evicted and are outside this budget.
const MAX_CACHED_THREAD_TRANSCRIPTS = 10;
export const MAX_INACTIVE_THREAD_ESTIMATED_BYTES = 16 * 1024 * 1024;
export const MAX_INACTIVE_RUNTIME_ESTIMATED_BYTES = 64 * 1024 * 1024;
// ViscosityCode: Lightweight keeps fewer and smaller inactive transcripts.
export const LIGHTWEIGHT_CACHED_THREAD_TRANSCRIPTS = 3;
export const LIGHTWEIGHT_INACTIVE_RUNTIME_ESTIMATED_BYTES = 16 * 1024 * 1024;
export const LIGHTWEIGHT_INACTIVE_THREAD_ESTIMATED_BYTES = 8 * 1024 * 1024;

/** Reuse weak, immutable-subtree estimates instead of serializing large outputs.
 * New reducer objects invalidate their estimate; unchanged items are measured once. */
export function estimateInactiveThreadRuntimeBytes(state: AppStoreState, threadId: string): number {
  return (
    estimateCacheValueBytes(state.runtimeItemIdsByThread[threadId]) +
    estimateCacheValueBytes(state.runtimeItemsByIdByThread[threadId]) +
    estimateCacheValueBytes(state.runtimeCompletedTurnsByThread[threadId]) +
    estimateCacheValueBytes(state.runtimeContextByThread[threadId]) +
    estimateCacheValueBytes(state.runtimeBackgroundTasksByThread[threadId]) +
    estimateCacheValueBytes(state.runtimeOpenTurnByThread[threadId])
  );
}

/** Oldest inactive windows leave first; current readers never enter this list. */
export function selectInactiveRuntimeEvictions(
  state: AppStoreState,
  inactiveThreadIds: ReadonlySet<string>,
): string[] {
  // ViscosityCode: Lightweight budgets; off keeps upstream limits (per-thread cap lives in chatRuntimePersister).
  const lightweight = isLightweightActive();
  const maxThreads = lightweight
    ? LIGHTWEIGHT_CACHED_THREAD_TRANSCRIPTS
    : MAX_CACHED_THREAD_TRANSCRIPTS;
  const maxBytes = lightweight
    ? LIGHTWEIGHT_INACTIVE_RUNTIME_ESTIMATED_BYTES
    : MAX_INACTIVE_RUNTIME_ESTIMATED_BYTES;
  const maxThreadBytes = lightweight
    ? LIGHTWEIGHT_INACTIVE_THREAD_ESTIMATED_BYTES
    : Number.POSITIVE_INFINITY;
  const sizes = new Map<string, number>();
  let estimatedBytes = 0;
  for (const threadId of inactiveThreadIds) {
    const bytes = estimateInactiveThreadRuntimeBytes(state, threadId);
    sizes.set(threadId, bytes);
    estimatedBytes += bytes;
  }
  const removed: string[] = [];
  let remaining = inactiveThreadIds.size;
  for (const threadId of inactiveThreadIds) {
    const bytes = sizes.get(threadId) ?? 0;
    // Once within budget, only a single window over the per-thread cap still leaves.
    if (remaining <= maxThreads && estimatedBytes <= maxBytes && bytes <= maxThreadBytes) continue;
    estimatedBytes -= bytes;
    remaining -= 1;
    removed.push(threadId);
  }
  return removed;
}
