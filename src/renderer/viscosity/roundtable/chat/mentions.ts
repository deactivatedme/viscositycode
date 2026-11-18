/**
 * ViscosityCode: `@model` / `@bot` mentions in a chat composer.
 *
 * Mention items reuse upstream's crew-mention path: picking one inserts the
 * plain text `@<label> `. On submit the text is matched back against the same
 * targets; a message that mentions any of them is posted to an open-pattern
 * Roundtable instead of the current thread (see `mentionRouting.ts`). Pure
 * functions only, so routing is testable without a composer.
 */
import type { BotProfile } from "../../bots/api";
import type { ReadyAgentBrain } from "../api";
import { botSeatCandidates, modelSeatCandidates, type SeatCandidate } from "./participants";

/** Mention list stays short: the default model and the next two per provider. */
export const MAX_MODEL_MENTIONS_PER_PROVIDER = 3;

export interface RoundtableMentionTarget {
  /** Participant id used for seating and `postToRoundtable` mentions. */
  id: string;
  /** Inserted as `@<label>`. */
  label: string;
  kind: SeatCandidate["kind"];
  candidate: SeatCandidate;
}

function normalizeSpaces(value: string): string {
  return value.replace(/ /gu, " ");
}

/** Bots first (named teammates), then ready models; a label is offered once. */
export function buildRoundtableMentionTargets(
  brains: readonly ReadyAgentBrain[],
  bots: readonly BotProfile[],
): RoundtableMentionTarget[] {
  const seen = new Set<string>();
  const targets: RoundtableMentionTarget[] = [];
  const candidates = [
    ...botSeatCandidates(bots),
    ...modelSeatCandidates(brains, { maxModelsPerBrain: MAX_MODEL_MENTIONS_PER_PROVIDER }),
  ];
  for (const candidate of candidates) {
    const label = normalizeSpaces(candidate.label).trim();
    const key = label.toLowerCase();
    if (!label || seen.has(key)) continue;
    seen.add(key);
    targets.push({ id: candidate.id, label, kind: candidate.kind, candidate });
  }
  return targets;
}

const WORD_CHAR = /[\p{L}\p{N}_]/u;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/**
 * Targets mentioned as `@<label>` in `text`, in order of first appearance.
 * A mention needs a non-word character (or the edge of the text) on both
 * sides, so `me@host` or `@Bot2` never match `@Bot`. Longer labels win, so
 * `@Claude · Sonnet 4.5` is never also read as `@Claude · Sonnet`.
 */
export function findRoundtableMentions(
  text: string,
  targets: readonly RoundtableMentionTarget[],
): RoundtableMentionTarget[] {
  if (targets.length === 0 || !text.includes("@")) return [];
  const haystack = normalizeSpaces(text);
  const taken: Array<readonly [number, number]> = [];
  const firstIndexById = new Map<string, { index: number; target: RoundtableMentionTarget }>();
  const byLength = [...targets].sort((a, b) => b.label.length - a.label.length);
  for (const target of byLength) {
    const pattern = new RegExp(`@${escapeRegExp(normalizeSpaces(target.label))}`, "giu");
    for (const match of haystack.matchAll(pattern)) {
      const start = match.index;
      const end = start + match[0].length;
      const before = start > 0 ? haystack[start - 1] : undefined;
      const after = end < haystack.length ? haystack[end] : undefined;
      if (before !== undefined && WORD_CHAR.test(before)) continue;
      if (after !== undefined && WORD_CHAR.test(after)) continue;
      if (taken.some(([from, to]) => start < to && end > from)) continue;
      taken.push([start, end]);
      const existing = firstIndexById.get(target.id);
      if (!existing || start < existing.index)
        firstIndexById.set(target.id, { index: start, target });
    }
  }
  return [...firstIndexById.values()]
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.target);
}
