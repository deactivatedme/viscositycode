/**
 * ViscosityCode Roundtable UI: pure helpers for the side-by-side comparison
 * (the "compare" pattern) — column progress, answer durations and the
 * proportional scroll sync between columns. No React, no store.
 */
import type { CompareAnswer } from "../api";
import type { RoundtableTurn } from "../types";

/** How many columns finished (answered or failed) out of all. */
export function compareProgress(answers: readonly CompareAnswer[]): {
  settled: number;
  answered: number;
  total: number;
} {
  let settled = 0;
  let answered = 0;
  for (const { turn } of answers) {
    if (turn?.status === "done") answered += 1;
    if (turn?.status === "done" || turn?.status === "failed") settled += 1;
  }
  return { settled, answered, total: answers.length };
}

/**
 * Milliseconds an answer took (or has taken so far, while it runs); null
 * before it started or when its times are missing.
 */
export function answerDurationMs(
  turn: Pick<RoundtableTurn, "status" | "startedAt" | "endedAt"> | undefined,
  now: number,
): number | null {
  if (!turn || turn.startedAt === undefined) return null;
  const running = turn.status === "running" || turn.status === "waiting-approval";
  const end = running ? now : turn.endedAt;
  if (end === undefined) return null;
  return Math.max(0, end - turn.startedAt);
}

export interface ScrollMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

/**
 * The target's scroll position at the same relative place as the source's,
 * so answers of different lengths reach their ends together.
 */
export function syncedScrollTop(
  source: ScrollMetrics,
  target: Pick<ScrollMetrics, "scrollHeight" | "clientHeight">,
): number {
  const sourceRange = source.scrollHeight - source.clientHeight;
  const targetRange = target.scrollHeight - target.clientHeight;
  if (sourceRange <= 0 || targetRange <= 0) return 0;
  const ratio = Math.min(1, Math.max(0, source.scrollTop / sourceRange));
  return Math.round(ratio * targetRange);
}

/** Marks a column's scroll body; the sync finds the columns by it. */
export const COMPARE_BODY_ATTRIBUTE = "data-vc-rt-compare-body";

/**
 * Keeps every column's scroll body at the same relative position as the one
 * the user scrolls (wheel, keyboard, scrollbar or touch). The column the user
 * last pointed at, touched or focused leads; scroll events of the others are
 * the sync's own writes and are ignored, so the columns never feed back into
 * each other. Runs outside React (no re-renders); returns the cleanup.
 */
export function installScrollSync(container: HTMLElement): () => void {
  let leader: HTMLElement | null = null;
  const bodyOf = (target: EventTarget | null): HTMLElement | null =>
    target instanceof Element ? target.closest<HTMLElement>(`[${COMPARE_BODY_ATTRIBUTE}]`) : null;
  const claim = (event: Event) => {
    const body = bodyOf(event.target);
    if (body) leader = body;
  };
  const onScroll = (event: Event) => {
    const source = event.target;
    if (!(source instanceof HTMLElement) || !source.hasAttribute(COMPARE_BODY_ATTRIBUTE)) return;
    if (leader && leader !== source && leader.isConnected) return;
    leader = source;
    for (const body of container.querySelectorAll<HTMLElement>(`[${COMPARE_BODY_ATTRIBUTE}]`)) {
      if (body === source) continue;
      const next = syncedScrollTop(source, body);
      if (Math.abs(body.scrollTop - next) >= 1) body.scrollTop = next;
    }
  };
  const claimEvents = [
    "pointerover",
    "pointerdown",
    "wheel",
    "touchstart",
    "focusin",
    "keydown",
  ] as const;
  for (const type of claimEvents) {
    container.addEventListener(type, claim, { capture: true, passive: true });
  }
  // Scroll does not bubble, but a capturing listener on an ancestor still sees it.
  container.addEventListener("scroll", onScroll, { capture: true, passive: true });
  return () => {
    for (const type of claimEvents) container.removeEventListener(type, claim, { capture: true });
    container.removeEventListener("scroll", onScroll, { capture: true });
  };
}
