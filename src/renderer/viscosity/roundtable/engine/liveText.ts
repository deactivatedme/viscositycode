/**
 * ViscosityCode Roundtable engine: live partial text of running turns.
 *
 * Never persisted. Updates are throttled per turn to at most 8 per second, so
 * the one component that previews a live turn re-renders at most that often
 * and nothing else re-renders on streaming deltas. Lightweight mode slows
 * that to 2 per second, since each update re-parses the growing markdown.
 */
import { create } from "zustand";
import { isLightweightActive } from "@/renderer/viscosity/performance/lightweight";

export const LIVE_TEXT_INTERVAL_MS = 125;
export const LIGHTWEIGHT_LIVE_TEXT_INTERVAL_MS = 500;

interface LiveTextState {
  textByTurn: Record<string, string>;
}

export const useRoundtableLiveText = create<LiveTextState>()(() => ({ textByTurn: {} }));

export function liveTurnKey(sessionId: string, turnId: string): string {
  return `${sessionId}\u0000${turnId}`;
}

interface Pending {
  lastAt: number;
  text: string;
  timer: ReturnType<typeof setTimeout> | undefined;
}

const pending = new Map<string, Pending>();

function write(key: string, text: string | undefined): void {
  useRoundtableLiveText.setState((state) => {
    if (text === undefined) {
      if (!(key in state.textByTurn)) return state;
      const { [key]: _removed, ...textByTurn } = state.textByTurn;
      return { textByTurn };
    }
    if (state.textByTurn[key] === text) return state;
    return { textByTurn: { ...state.textByTurn, [key]: text } };
  });
}

/** Publishes a running turn's text so far (throttled to ≤ 8 Hz per turn, 2 Hz when lightweight). */
export function setLiveTurnText(
  sessionId: string,
  turnId: string,
  text: string,
  now = Date.now(),
): void {
  const key = liveTurnKey(sessionId, turnId);
  const entry = pending.get(key) ?? { lastAt: 0, text: "", timer: undefined };
  entry.text = text;
  pending.set(key, entry);
  if (entry.timer !== undefined) return;
  const interval = isLightweightActive()
    ? LIGHTWEIGHT_LIVE_TEXT_INTERVAL_MS
    : LIVE_TEXT_INTERVAL_MS;
  const wait = entry.lastAt + interval - now;
  if (wait <= 0) {
    entry.lastAt = now;
    write(key, text);
    return;
  }
  entry.timer = setTimeout(() => {
    entry.timer = undefined;
    entry.lastAt = Date.now();
    if (pending.get(key) === entry) write(key, entry.text);
  }, wait);
}

/** Drops a turn's live text (the turn ended; its final text is in the session). */
export function clearLiveTurnText(sessionId: string, turnId: string): void {
  const key = liveTurnKey(sessionId, turnId);
  const entry = pending.get(key);
  if (entry?.timer !== undefined) clearTimeout(entry.timer);
  pending.delete(key);
  write(key, undefined);
}

/** Drops every live text of a session. */
export function clearSessionLiveText(sessionId: string): void {
  const prefix = `${sessionId}\u0000`;
  for (const key of [...pending.keys()]) {
    if (!key.startsWith(prefix)) continue;
    const entry = pending.get(key);
    if (entry?.timer !== undefined) clearTimeout(entry.timer);
    pending.delete(key);
  }
  useRoundtableLiveText.setState((state) => {
    const keys = Object.keys(state.textByTurn).filter((key) => key.startsWith(prefix));
    if (keys.length === 0) return state;
    const textByTurn = { ...state.textByTurn };
    for (const key of keys) delete textByTurn[key];
    return { textByTurn };
  });
}
