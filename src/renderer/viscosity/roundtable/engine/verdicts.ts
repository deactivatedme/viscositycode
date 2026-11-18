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

const LABEL_CONTINUATION = /[\p{L}\p{N}]/u;

/**
 * Participant ids @mentioned in `text` (by their unique label), in
 * `candidates` order. At each "@" the longest matching label wins, so
 * "@Codex (2)" names "Codex (2)", not "Codex"; "@Codexy" names nobody.
 */
export function findMentions(text: string, candidates: readonly PickCandidate[]): string[] {
  const haystack = text.toLowerCase();
  const labels = candidates
    .map((candidate) => ({ id: candidate.id, label: candidate.label.toLowerCase() }))
    .filter((candidate) => candidate.label.length > 0)
    .toSorted((left, right) => right.label.length - left.label.length);
  const found = new Set<string>();
  for (let index = haystack.indexOf("@"); index !== -1; index = haystack.indexOf("@", index + 1)) {
    const rest = haystack.slice(index + 1);
    const match = labels.find(
      (candidate) =>
        rest.startsWith(candidate.label) &&
        !LABEL_CONTINUATION.test(rest.charAt(candidate.label.length)),
    );
    if (match) found.add(match.id);
  }
  return candidates.filter((candidate) => found.has(candidate.id)).map((candidate) => candidate.id);
}
