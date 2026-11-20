/**
 * ViscosityCode Roundtable engine: machine-readable lines in participant
 * answers — reviewer verdicts ("VERDICT: APPROVE" / "VERDICT: REVISE"),
 * picks ("PICK: <label>") and @mentions in the group chat. Pure.
 */
import { normalizeLabel } from "./text";

const VERDICT_LINE =
  /^[\s>*_#`-]*verdict\s*[:：]\s*[*_`]*\s*(approve|approved|revise|reject|changes requested)\b/gim;

/**
 * The reviewer's verdict: the LAST "VERDICT:" line wins (a reviewer may quote
 * the instruction earlier). `undefined` when there is none.
 */
export function parseVerdict(text: string): "approve" | "revise" | undefined {
  let verdict: "approve" | "revise" | undefined;
  for (const match of text.matchAll(VERDICT_LINE)) {
    const word = match[1]!.toLowerCase();
    verdict = word === "approve" || word === "approved" ? "approve" : "revise";
  }
  return verdict;
}

export interface PickCandidate {
  id: string;
  label: string;
}

const PICK_LINE = /^[\s>*_#`-]*pick\s*[:：]\s*(.+)$/gim;
const NUMBERED_PICK = /^#?(\d+)$/;

function matchCandidate(raw: string, candidates: readonly PickCandidate[]): string | undefined {
  const value = normalizeLabel(raw.replace(/[.!]+$/, ""));
  if (!value) return undefined;
  const exact = candidates.find((candidate) => normalizeLabel(candidate.label) === value);
  if (exact) return exact.id;
  // "PICK: 2" / "PICK: #2" — candidates are numbered in the prompt.
  const numbered = value.match(NUMBERED_PICK);
  if (numbered) return candidates[Number(numbered[1]) - 1]?.id;
  // A longer line that names exactly one candidate ("PICK: Codex · gpt-5 because …").
  const named = candidates.filter((candidate) => value.startsWith(normalizeLabel(candidate.label)));
  if (named.length > 0) {
    return named.toSorted((left, right) => right.label.length - left.label.length)[0]!.id;
  }
  return undefined;
}

/** The participant a "PICK: <label>" line chose (the last valid line wins). */
export function parsePick(text: string, candidates: readonly PickCandidate[]): string | undefined {
  let picked: string | undefined;
  for (const match of text.matchAll(PICK_LINE)) {
    const id = matchCandidate(match[1]!, candidates);
    if (id) picked = id;
  }
  return picked;
}

/**
 * Majority vote. Ties (and no valid vote at all) go to the earliest candidate
 * in `order` among the tied ones — the first proposer.
 */
export function tallyPicks(
  picks: ReadonlyArray<string | undefined>,
  order: readonly string[],
): { winner: string | undefined; votes: Record<string, number> } {
  const votes: Record<string, number> = {};
  for (const pick of picks) {
    if (pick && order.includes(pick)) votes[pick] = (votes[pick] ?? 0) + 1;
  }
  let winner: string | undefined;
  let best = 0;
  for (const id of order) {
    const count = votes[id] ?? 0;
    if (count > best) {
      best = count;
      winner = id;
    }
  }
  return { winner: winner ?? order[0], votes };
}

/** A typeable slug of a label ("Claude · Opus 4.5" → `claude-opus-4-5`). */
export function mentionSlug(label: string): string {
  return label
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

/** Participant id → unique handle (without the "@"), in participant order. */
export function mentionHandles(participants: readonly PickCandidate[]): Map<string, string> {
  const handles = new Map<string, string>();
  const taken = new Set<string>();
  for (const participant of participants) {
    const base = mentionSlug(participant.label) || "participant";
    let handle = base;
    for (let suffix = 2; taken.has(handle); suffix += 1) handle = `${base}-${suffix}`;
    taken.add(handle);
    handles.set(participant.id, handle);
  }
  return handles;
}

export interface MentionCandidate {
  id: string;
  /** Display label; empty when only the handle is known. */
  label: string;
  /** The `@handle` slug, when the caller already assigned one. */
  handle?: string | undefined;
}

// "@" starts a mention only at a word boundary, so "me@host" is not one.
const MENTION_AT = /(?<![\p{L}\p{N}_.@-])@/gu;
// A name continues past a form ("@Bot2", "@qwen-code/cli", "@claude.ai"), so the form is not a mention.
const MENTION_CONTINUATION = /^(?:[\p{L}\p{N}_/-]|\.[\p{L}\p{N}])/u;

export interface MentionMatchOptions {
  /** Also accept unambiguous provider or model names, not only labels and handles (default true). */
  aliases?: boolean;
}

export interface MentionSpan {
  id: string;
  /** Offset of the "@" in the text. */
  start: number;
  /** Offset just past the mention. */
  end: number;
}

/** Lowercase that keeps every character's length, so offsets stay aligned with the input. */
function lowerAligned(value: string): string {
  return value.replace(/[^]/gu, (char) => {
    const lower = char.toLowerCase();
    return lower.length === char.length ? lower : char;
  });
}

function normalizeMentionText(value: string): string {
  return lowerAligned(value).replace(/\s+/gu, " ").trim();
}

/** Leading words of one label part: "Claude Code" → its lowercased first word and the whole lowercased part. */
function wordPrefixes(part: string): string[] {
  const words = normalizeMentionText(part).split(" ").filter(Boolean);
  return words.map((_, index) => words.slice(0, index + 1).join(" "));
}

/**
 * Every form that names a candidate. The label and handle always do; for a
 * "Provider · Model" label, the leading words of the provider or the model
 * ("@Claude", "@Opus 4.5", also as slugs) do too, but only when they name
 * exactly one candidate and are nobody's label or handle.
 */
function mentionForms(
  candidates: readonly MentionCandidate[],
  aliases: boolean,
): Array<[string, string]> {
  const forms = new Map<string, string>();
  for (const candidate of candidates) {
    for (const form of [
      normalizeMentionText(candidate.label),
      candidate.handle && lowerAligned(candidate.handle),
    ]) {
      if (form && !forms.has(form)) forms.set(form, candidate.id);
    }
  }
  const aliasOwners = new Map<string, Set<string>>();
  for (const candidate of aliases ? candidates : []) {
    const parts = candidate.label.split("·");
    if (parts.length < 2) continue;
    for (const alias of parts.flatMap(wordPrefixes).flatMap((a) => [a, mentionSlug(a)])) {
      if (!alias || forms.has(alias)) continue;
      aliasOwners.set(alias, (aliasOwners.get(alias) ?? new Set()).add(candidate.id));
    }
  }
  const entries = [...forms];
  for (const [alias, owners] of aliasOwners) {
    if (owners.size === 1) entries.push([alias, [...owners][0]!]);
  }
  return entries.toSorted((left, right) => right[0].length - left[0].length);
}

/**
 * Every mention in `text`, in order. One matcher for what users type and what
 * models write: a mention is the label, the handle, or (unless
 * `aliases: false`) an unambiguous provider or model name, any case. At each
 * "@" the longest form wins, so "@Codex (2)" names "Codex (2)", not "Codex";
 * "@Codexy" names nobody.
 */
export function mentionSpans(
  text: string,
  candidates: readonly MentionCandidate[],
  options: MentionMatchOptions = {},
): MentionSpan[] {
  if (candidates.length === 0 || !text.includes("@")) return [];
  // One-for-one replacement keeps offsets aligned with `text`.
  const haystack = lowerAligned(text).replace(/\s/gu, " ");
  const forms = mentionForms(candidates, options.aliases ?? true);
  const spans: MentionSpan[] = [];
  for (const at of haystack.matchAll(MENTION_AT)) {
    const rest = haystack.slice(at.index + 1);
    const match = forms.find(
      ([form]) => rest.startsWith(form) && !MENTION_CONTINUATION.test(rest.slice(form.length)),
    );
    if (match) spans.push({ id: match[1], start: at.index, end: at.index + 1 + match[0].length });
  }
  return spans;
}

/** Candidate ids @mentioned in `text` (`mentionSpans`), in order of first mention, without repeats. */
export function matchMentions(
  text: string,
  candidates: readonly MentionCandidate[],
  options: MentionMatchOptions = {},
): string[] {
  return [...new Set(mentionSpans(text, candidates, options).map((span) => span.id))];
}

/**
 * Participant ids @mentioned in a reply, in `candidates` order (see
 * `matchMentions`; handles are the ones the composer shows).
 */
export function findMentions(text: string, candidates: readonly PickCandidate[]): string[] {
  const handles = mentionHandles(candidates);
  const found = new Set(
    matchMentions(
      text,
      candidates.map((candidate) => ({ ...candidate, handle: handles.get(candidate.id) })),
    ),
  );
  return candidates.filter((candidate) => found.has(candidate.id)).map((candidate) => candidate.id);
}
