/**
 * ViscosityCode Roundtable engine: when a reloaded window may resume.
 *
 * The saved sessions load from this desktop's database, usually before the
 * host's thread catalog reaches the window. Resuming then would find none of
 * the participants' threads and fail every in-flight turn as "removed", so
 * the resume waits until the threads the sessions use are listed (or a
 * timeout passes: a thread that never appears really is gone). Pure apart
 * from the timer; the live thread source is passed in.
 */
import type { RoundtableSession } from "../types";

/** How long a reload waits for the participants' threads before resuming anyway. */
export const RESUME_THREAD_WAIT_MS = 30_000;

export interface ThreadPresenceSource {
  has(threadId: string): boolean;
  /** Calls `listener` whenever the set of threads may have changed; returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
}

/** Threads that the sessions a reload resumes (running, or paused with turns in flight) talk to. */
export function threadIdsToResume(sessions: readonly RoundtableSession[]): string[] {
  const ids = new Set<string>();
  for (const session of sessions) {
    if (session.status !== "running" && session.status !== "paused") continue;
    for (const threadId of Object.values(session.threadIds)) ids.add(threadId);
  }
  return [...ids];
}

/** Resolves once every thread is listed, or after `timeoutMs`. Never rejects. */
export function waitForThreads(
  threadIds: readonly string[],
  source: ThreadPresenceSource,
  timeoutMs = RESUME_THREAD_WAIT_MS,
): Promise<void> {
  const allListed = () => threadIds.every((threadId) => source.has(threadId));
  if (allListed()) return Promise.resolve();
  return new Promise((resolve) => {
    let unsubscribe: () => void = () => {};
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      unsubscribe();
      if (timer !== undefined) clearTimeout(timer);
      resolve();
    };
    unsubscribe = source.subscribe(() => {
      if (allListed()) finish();
    });
    timer = setTimeout(finish, timeoutMs);
    // The threads may have arrived between the first check and the subscription.
    if (allListed()) finish();
  });
}
