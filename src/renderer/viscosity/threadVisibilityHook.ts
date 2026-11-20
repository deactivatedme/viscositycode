/**
 * ViscosityCode: the fork's "is this thread on screen?" answer for upstream's
 * notifications. Import-free on purpose: upstream `notifications.ts` imports
 * it, and the fork registers the real predicate (`isThreadOnScreen`) only
 * where the desktop shell runs, so compact/PWA, thread windows and the
 * extension keep upstream's pane check.
 */
type ThreadOnScreen = (threadId: string) => boolean;

let override: ThreadOnScreen | null = null;

/** Register the fork's predicate; returns the unregister. */
export function setThreadOnScreenOverride(predicate: ThreadOnScreen): () => void {
  override = predicate;
  return () => {
    if (override === predicate) override = null;
  };
}

/** The fork's answer, or undefined when no override is registered. */
export function threadOnScreenOverride(threadId: string): boolean | undefined {
  return override?.(threadId);
}
