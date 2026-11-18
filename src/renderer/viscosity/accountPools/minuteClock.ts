/**
 * ViscosityCode: a shared minute clock for account pool displays (fork of
 * Poracode). Usage windows reset on the minute at best, so reading "now" once a
 * minute keeps reset countdowns and exhausted states honest without a timer
 * per component or an impure `Date.now()` in render.
 */
import { useSyncExternalStore } from "react";

const MINUTE_MS = 60_000;

let current = Date.now();
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();

function tick(): void {
  current = Date.now();
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!timer) {
    current = Date.now();
    timer = setInterval(tick, MINUTE_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

function getSnapshot(): number {
  return current;
}

/** Milliseconds since the epoch, refreshed once a minute while anything listens. */
export function useMinuteClock(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
