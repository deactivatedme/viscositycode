/** Environment variable a supervising shell sets to its own pid. */
export const PARENT_PID_ENV = "PORACODE_PARENT_PID";
const POLL_INTERVAL_MS = 1_000;

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the pid exists but belongs to another user.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * When `PORACODE_PARENT_PID` names a process, call `onParentExit` once within
 * about one poll interval after that process is gone, so a server whose
 * supervising shell crashed or was force-quit drains through the normal
 * shutdown path instead of keeping the owner lease as an orphan. Unset, empty,
 * non-integer, `<= 1` (init adopts orphans) or own-pid values are ignored.
 * Returns a stop function. The poll timer is unref'd and never keeps the
 * process alive.
 *
 * shortcut: a pid reused within one poll interval reads as alive; upgrade to a
 * pidfd/kqueue exit watch if a parent ever restarts that fast.
 */
export function watchParentPid(
  env: NodeJS.ProcessEnv,
  onParentExit: (pid: number) => void,
  options: { readonly intervalMs?: number; readonly isAlive?: (pid: number) => boolean } = {},
): () => void {
  const raw = env[PARENT_PID_ENV]?.trim();
  if (!raw || !/^\d+$/u.test(raw)) return () => undefined;
  const pid = Number(raw);
  if (!Number.isSafeInteger(pid) || pid <= 1 || pid === process.pid) return () => undefined;
  const isAlive = options.isAlive ?? isProcessAlive;
  const timer = setInterval(() => {
    if (isAlive(pid)) return;
    clearInterval(timer);
    onParentExit(pid);
  }, options.intervalMs ?? POLL_INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}
