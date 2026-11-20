/**
 * ViscosityCode: `@model` mentions in a chat composer.
 *
 * Mention items reuse upstream's crew-mention path: picking one inserts the
 * plain text `@<label> `. On submit the text is matched back against the same
 * targets; a message that mentions any of them is posted to an open-pattern
 * Roundtable instead of the current thread (see `mentionRouting.ts`). Pure
 * functions only, so routing is testable without a composer.
 */
import type { ReadyAgentBrain } from "../api";
import { matchMentions } from "../engine/verdicts";
import { modelSeatCandidates, type SeatCandidate } from "./participants";

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

/** Ready models; a label is offered once. */
export function buildRoundtableMentionTargets(
  brains: readonly ReadyAgentBrain[],
): RoundtableMentionTarget[] {
  const seen = new Set<string>();
  const targets: RoundtableMentionTarget[] = [];
  const candidates = modelSeatCandidates(brains, {
    maxModelsPerBrain: MAX_MODEL_MENTIONS_PER_PROVIDER,
  });
  for (const candidate of candidates) {
    const label = normalizeSpaces(candidate.label).trim();
    const key = label.toLowerCase();
    if (!label || seen.has(key)) continue;
    seen.add(key);
    targets.push({ id: candidate.id, label, kind: candidate.kind, candidate });
  }
  return targets;
}

/**
 * Targets mentioned in `text`, in order of first appearance, by the inserted
 * `@<label>` only, any case (`matchMentions`). Short provider or model names
 * stay out: a mention moves the message out of this chat, and words like
 * `@default` or `@qwen-code` turn up in ordinary messages. A mention needs a
 * boundary on both sides, so `me@host` or `@Model2` never match `@Model`, and the
 * longest label wins.
 */
export function findRoundtableMentions(
  text: string,
  targets: readonly RoundtableMentionTarget[],
): RoundtableMentionTarget[] {
  const byId = new Map(targets.map((target) => [target.id, target]));
  return matchMentions(text, targets, { aliases: false }).map((id) => byId.get(id)!);
}
