/**
 * ViscosityCode status bar: agent state counts across loaded threads.
 *
 * Counts are derived once per `threads` array (streaming deltas land in the
 * runtime-item maps, not in that array) and read through selectors that
 * return numbers, so the status bar does not re-render while agents stream.
 */
import type { Thread } from "@/shared/contracts";
import { getStatusTone } from "@/renderer/components/providers/statusTone";

export type CountedThread = Pick<Thread, "id" | "status" | "done" | "archived"> &
  Partial<Pick<Thread, "attention">>;

export interface AgentStateCounts {
  /** Launching or mid-turn. */
  working: number;
  /** Waiting for the user: needs approval or a reply. */
  waiting: number;
  errors: number;
  /** Waiting thread ids in store order. */
  waitingIds: readonly string[];
  /** Errored thread ids in store order. */
  errorIds: readonly string[];
}

const EMPTY_IDS: readonly string[] = [];

export const EMPTY_AGENT_STATE_COUNTS: AgentStateCounts = {
  working: 0,
  waiting: 0,
  errors: 0,
  waitingIds: EMPTY_IDS,
  errorIds: EMPTY_IDS,
};

/** Archived and done threads are not counted; attention and errors win over working. */
export function countAgentStates(threads: readonly CountedThread[]): AgentStateCounts {
  let working = 0;
  const waitingIds: string[] = [];
  const errorIds: string[] = [];
  for (const thread of threads) {
    if (thread.archived) continue;
    const tone = getStatusTone(thread);
    if (tone === "working") working += 1;
    else if (tone === "attention") waitingIds.push(thread.id);
    else if (tone === "error") errorIds.push(thread.id);
  }
  if (working === 0 && waitingIds.length === 0 && errorIds.length === 0) {
    return EMPTY_AGENT_STATE_COUNTS;
  }
  return {
    working,
    waiting: waitingIds.length,
    errors: errorIds.length,
    waitingIds: waitingIds.length === 0 ? EMPTY_IDS : waitingIds,
    errorIds: errorIds.length === 0 ? EMPTY_IDS : errorIds,
  };
}

const countsCache = new WeakMap<readonly CountedThread[], AgentStateCounts>();

/** Memoized per `threads` array identity. */
export function getAgentStateCounts(threads: readonly CountedThread[]): AgentStateCounts {
  let counts = countsCache.get(threads);
  if (!counts) {
    counts = countAgentStates(threads);
    countsCache.set(threads, counts);
  }
  return counts;
}

interface ThreadsState {
  threads: readonly CountedThread[];
}

export function selectWorkingCount(state: ThreadsState): number {
  return getAgentStateCounts(state.threads).working;
}

export function selectWaitingCount(state: ThreadsState): number {
  return getAgentStateCounts(state.threads).waiting;
}

export function selectErrorCount(state: ThreadsState): number {
  return getAgentStateCounts(state.threads).errors;
}

/**
 * The thread a "waiting"/"errors" press should open: the first one, or the one
 * after `currentId` when that is already shown, wrapping around.
 */
export function nextThreadToOpen(ids: readonly string[], currentId: string | null): string | null {
  if (ids.length === 0) return null;
  const index = currentId ? ids.indexOf(currentId) : -1;
  return index === -1 ? ids[0]! : ids[(index + 1) % ids.length]!;
}
