/**
 * ViscosityCode: Roundtable patterns as offered by the in-chat entry points,
 * and the default seat roles each pattern hands out (the engine may refine
 * them). Pure data; labels are Lingui descriptors resolved by the caller.
 */
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import type { ParticipantRole, RoundtablePattern } from "../types";

/** A Roundtable seats 2–5 participants in total. */
export const MIN_ROUNDTABLE_PARTICIPANTS = 2;
export const MAX_ROUNDTABLE_PARTICIPANTS = 5;

export interface RoundtablePatternOption {
  id: RoundtablePattern;
  label: MessageDescriptor;
  hint: MessageDescriptor;
}

export const ROUNDTABLE_PATTERN_OPTIONS: readonly RoundtablePatternOption[] = [
  {
    id: "build-review",
    label: msg`Build ↔ review`,
    hint: msg`One builds, the others review until they approve`,
  },
  {
    id: "debate",
    label: msg`Debate → decide`,
    hint: msg`Everyone proposes and critiques, then a decision is made`,
  },
  {
    id: "relay",
    label: msg`Relay`,
    hint: msg`Plan → implement → test → review, one stage each`,
  },
  {
    id: "race",
    label: msg`Race + cross-review`,
    hint: msg`All build in separate worktrees, review each other, best wins`,
  },
  {
    id: "open",
    label: msg`Open group chat`,
    hint: msg`Talk to everyone; @mention who should reply`,
  },
];

export const DEFAULT_ROUNDTABLE_PATTERN: RoundtablePattern = "build-review";

export function isRoundtablePattern(value: unknown): value is RoundtablePattern {
  return ROUNDTABLE_PATTERN_OPTIONS.some((option) => option.id === value);
}

const RELAY_ROLES: readonly ParticipantRole[] = ["planner", "builder", "tester", "reviewer"];

/**
 * Seat roles for `count` participants, in seating order. When a Roundtable
 * starts from an existing chat, that chat holds seat 0 and the invited
 * participants take the roles from seat 1 on.
 */
export function rolesForPattern(pattern: RoundtablePattern, count: number): ParticipantRole[] {
  const seats = Math.max(0, Math.floor(count));
  return Array.from({ length: seats }, (_, index): ParticipantRole => {
    switch (pattern) {
      case "build-review":
        return index === 0 ? "builder" : "reviewer";
      case "debate":
        return seats >= 3 && index === seats - 1 ? "judge" : "member";
      case "relay":
        return RELAY_ROLES[index] ?? "reviewer";
      case "race":
        return "builder";
      case "open":
        return "member";
    }
  });
}
