/**
 * ViscosityCode Roundtable UI: @mention handles for participants.
 *
 * A handle is a short, unique, typeable slug of the participant's label
 * ("Claude · Opus" → `claude-opus`). The composer inserts `@handle` into the
 * message and sends the participant ids it finds as `mentions`.
 */
import {
  matchMentions,
  mentionHandles as assignMentionHandles,
  mentionSpans,
  type MentionCandidate,
} from "../engine/verdicts";
import type { ParticipantProfile } from "../types";

/** Handles that also remember each label, so `extractMentions` accepts names too. */
class ParticipantHandles extends Map<string, string> {
  readonly labels = new Map<string, string>();
}

/** Participant id → unique handle (without the "@"), in participant order. */
export function mentionHandles(
  participants: readonly Pick<ParticipantProfile, "id" | "label">[],
): Map<string, string> {
  const handles = new ParticipantHandles(assignMentionHandles(participants));
  for (const participant of participants) handles.labels.set(participant.id, participant.label);
  return handles;
}

function mentionCandidates(handles: ReadonlyMap<string, string>): MentionCandidate[] {
  const labels = handles instanceof ParticipantHandles ? handles.labels : undefined;
  return [...handles].map(([id, handle]) => ({ id, handle, label: labels?.get(id) ?? "" }));
}

/**
 * Participant ids mentioned in `text`, in first-mention order, without
 * repeats: by handle, and for handles from `mentionHandles` also by label or
 * an unambiguous provider or model name (`matchMentions`).
 */
export function extractMentions(text: string, handles: ReadonlyMap<string, string>): string[] {
  return matchMentions(text, mentionCandidates(handles));
}

/** Append `@handle ` to a draft, adding a separating space when needed. */
export function insertMention(text: string, handle: string): string {
  const token = `@${handle} `;
  if (text.length === 0) return token;
  return /\s$/.test(text) ? `${text}${token}` : `${text} ${token}`;
}

/**
 * Remove every mention of the participant with `handle` (and one following
 * space) from a draft. With `handles` from `mentionHandles` that includes the
 * label and short names `extractMentions` reads, so the participant is no
 * longer mentioned afterwards.
 */
export function removeMention(
  text: string,
  handle: string,
  handles: ReadonlyMap<string, string> = new Map([[handle, handle]]),
): string {
  const id = [...handles].find(([, value]) => value === handle)?.[0];
  let result = text;
  for (const span of mentionSpans(text, mentionCandidates(handles)).toReversed()) {
    if (span.id !== id) continue;
    const end = result[span.end] === " " ? span.end + 1 : span.end;
    result = result.slice(0, span.start) + result.slice(end);
  }
  return result;
}
