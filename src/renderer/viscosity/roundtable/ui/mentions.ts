/**
 * ViscosityCode Roundtable UI: @mention handles for participants.
 *
 * A handle is a short, unique, typeable slug of the participant's label
 * ("Claude · Opus" → `claude-opus`). The composer inserts `@handle` into the
 * message and sends the participant ids it finds as `mentions`.
 */
import type { ParticipantProfile } from "../types";

// "@" starts a mention only at a word boundary, so "me@host" is not one.
const HANDLE_PATTERN = /(?<![\p{L}\p{N}_.@-])@([\p{L}\p{N}][\p{L}\p{N}_-]*)/gu;

function slugify(label: string): string {
  const slug = label
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "participant";
}

/** Participant id → unique handle (without the "@"), in participant order. */
export function mentionHandles(
  participants: readonly Pick<ParticipantProfile, "id" | "label">[],
): Map<string, string> {
  const handles = new Map<string, string>();
  const taken = new Set<string>();
  for (const participant of participants) {
    const base = slugify(participant.label);
    let handle = base;
    for (let suffix = 2; taken.has(handle); suffix += 1) handle = `${base}-${suffix}`;
    taken.add(handle);
    handles.set(participant.id, handle);
  }
  return handles;
}

/** Participant ids mentioned in `text`, in first-mention order, without repeats. */
export function extractMentions(text: string, handles: ReadonlyMap<string, string>): string[] {
  const idByHandle = new Map<string, string>();
  for (const [id, handle] of handles) idByHandle.set(handle.toLowerCase(), id);
  const ids: string[] = [];
  for (const match of text.matchAll(HANDLE_PATTERN)) {
    const id = idByHandle.get(match[1]!.toLowerCase());
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** Append `@handle ` to a draft, adding a separating space when needed. */
export function insertMention(text: string, handle: string): string {
  const token = `@${handle} `;
  if (text.length === 0) return token;
  return /\s$/.test(text) ? `${text}${token}` : `${text} ${token}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Remove every `@handle` token (and one following space) from a draft. */
export function removeMention(text: string, handle: string): string {
  const token = new RegExp(`@${escapeRegExp(handle)}(?![\\p{L}\\p{N}_-]) ?`, "giu");
  return text.replace(token, "");
}
