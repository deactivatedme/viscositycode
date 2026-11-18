/**
 * ViscosityCode Mission Control: a shared one-second clock for the elapsed
 * timers on running cards (fork of Poracode). One interval serves every
 * timer and stops when the last one unmounts; only the timer leaves re-render.
 * Like the activity tracker, it rests while the window is hidden and catches
 * up at once when the window shows again.
 */
import { useSyncExternalStore } from "react";

const SECOND_MS = 1000;

let current = Date.now();
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();

function isWindowHidden(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

function tick(): void {
  current = Date.now();
  for (const listener of listeners) listener();
}

function startTicking(): void {
  if (timer || isWindowHidden()) return;
  timer = setInterval(tick, SECOND_MS);
}

function stopTicking(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = undefined;
}

function onVisibilityChange(): void {
  if (isWindowHidden()) {
    stopTicking();
    return;
  }
  // Back in view: show the real elapsed time now, then tick again.
  if (!timer) {
    tick();
    startTicking();
  }
}

function subscribe(listener: () => void): () => void {
  const first = listeners.size === 0;
  listeners.add(listener);
  if (first) {
    current = Date.now();
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibilityChange);
    }
    startTicking();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    stopTicking();
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    }
  };
}

function getSnapshot(): number {
  return current;
}

/** Milliseconds since the epoch, refreshed every second while anything listens and the window shows. */
export function useSecondClock(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Compact age: "45s", "12m", "3h", "2d". */
export function formatAge(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
