/**
 * ViscosityCode: the "tools running" count published by the agent-state
 * monitor. A plain external store, so the status bar item re-renders only
 * when the number changes, never on streaming deltas.
 */

let count = 0;
const listeners = new Set<() => void>();

export function getToolsRunningCount(): number {
  return count;
}

export function setToolsRunningCount(next: number): void {
  const value = Number.isFinite(next) && next > 0 ? Math.floor(next) : 0;
  if (value === count) return;
  count = value;
  for (const listener of listeners) listener();
}

export function subscribeToolsRunning(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
