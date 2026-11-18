/**
 * ViscosityCode Roundtable UI: pattern, role and status vocabulary (labels,
 * one-line explanations, per-pattern defaults). Pure data; no React, no store.
 */
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import type {
  ParticipantRole,
  RoundtableOutcome,
  RoundtablePattern,
  RoundtableSession,
  RoundtableTurn,
  RoundtableTurnPhase,
  TurnStatus,
} from "../types";

export const MIN_PARTICIPANTS = 2;
export const MAX_PARTICIPANTS = 5;
export const MAX_ROUNDS_LIMIT = 20;

export const ROUNDTABLE_PATTERNS: readonly RoundtablePattern[] = [
  "build-review",
  "debate",
  "relay",
  "race",
  "open",
];

export const PATTERN_LABELS: Readonly<Record<RoundtablePattern, MessageDescriptor>> = {
  "build-review": msg`Build ↔ review`,
  debate: msg`Debate → decide`,
  relay: msg`Relay`,
  race: msg`Race + cross-review`,
  open: msg`Group chat`,
};

export const PATTERN_DESCRIPTIONS: Readonly<Record<RoundtablePattern, MessageDescriptor>> = {
  "build-review": msg`One builds, the others review, until a reviewer approves or the rounds run out.`,
  debate: msg`Everyone proposes and critiques the others, then a judge or a vote decides.`,
  relay: msg`A chain of stages (plan, implement, test, review), one participant each.`,
  race: msg`Everyone builds on their own worktree, reviews the others, and the best is picked.`,
  open: msg`A free group chat: @mention who should answer.`,
};

export const ROUNDTABLE_ROLES: readonly ParticipantRole[] = [
  "builder",
  "reviewer",
  "planner",
  "tester",
  "judge",
  "member",
];

export const ROLE_LABELS: Readonly<Record<ParticipantRole, MessageDescriptor>> = {
  builder: msg`Builder`,
  reviewer: msg`Reviewer`,
  planner: msg`Planner`,
  tester: msg`Tester`,
  judge: msg`Judge`,
  member: msg`Member`,
};

const RELAY_ROLES: Readonly<Record<number, readonly ParticipantRole[]>> = {
  2: ["builder", "reviewer"],
  3: ["planner", "builder", "reviewer"],
  4: ["planner", "builder", "tester", "reviewer"],
  5: ["planner", "builder", "tester", "reviewer", "member"],
};

/** Default role per seat for a pattern and a participant count. */
export function defaultRolesForPattern(
  pattern: RoundtablePattern,
  count: number,
): ParticipantRole[] {
  const seats = Math.max(0, Math.floor(count));
  switch (pattern) {
    case "build-review":
      return Array.from({ length: seats }, (_, index) => (index === 0 ? "builder" : "reviewer"));
    case "debate":
      // Three or more seats: the last one judges; two seats decide by vote.
      return Array.from({ length: seats }, (_, index) =>
        seats >= 3 && index === seats - 1 ? "judge" : "member",
      );
    case "relay": {
      const chain = RELAY_ROLES[Math.min(Math.max(seats, 2), MAX_PARTICIPANTS)] ?? [];
      return Array.from({ length: seats }, (_, index) => chain[index] ?? "member");
    }
    case "race":
      return Array.from({ length: seats }, () => "builder");
    case "open":
      return Array.from({ length: seats }, () => "member");
  }
}

/** Default round limit; undefined means unlimited (the open group chat). */
export function defaultMaxRounds(pattern: RoundtablePattern): number | undefined {
  switch (pattern) {
    case "build-review":
      return 4;
    case "debate":
      return 2;
    case "relay":
    case "race":
      return 1;
    case "open":
      return undefined;
  }
}

/** Whether the pattern runs every participant on its own worktree. */
export function patternUsesOwnWorktrees(pattern: RoundtablePattern): boolean {
  return pattern === "race";
}

export const SESSION_STATUS_LABELS: Readonly<
  Record<RoundtableSession["status"], MessageDescriptor>
> = {
  draft: msg`Draft`,
  running: msg`Running`,
  paused: msg`Paused`,
  done: msg`Done`,
  failed: msg`Failed`,
  stopped: msg`Stopped`,
};

export const TURN_STATUS_LABELS: Readonly<Record<TurnStatus, MessageDescriptor>> = {
  pending: msg`Up next`,
  running: msg`Working`,
  "waiting-approval": msg`Waiting for your approval`,
  done: msg`Done`,
  failed: msg`Failed`,
  stopped: msg`Stopped`,
};

/** What a turn was for (engine `phase`), shown on its bubble in place of the role. */
export const PHASE_LABELS: Readonly<Record<RoundtableTurnPhase, MessageDescriptor>> = {
  build: msg`Build`,
  review: msg`Review`,
  plan: msg`Plan`,
  test: msg`Test`,
  contribute: msg`Contribution`,
  propose: msg`Proposal`,
  critique: msg`Critique`,
  decide: msg`Decision`,
  implement: msg`Implementation`,
  race: msg`Candidate run`,
  "cross-review": msg`Cross-review`,
  reply: msg`Reply`,
};

/** Why a finished Roundtable ended (engine `outcome.reason`). */
export const OUTCOME_LABELS: Readonly<Record<RoundtableOutcome["reason"], MessageDescriptor>> = {
  approved: msg`A reviewer approved the work.`,
  "max-rounds": msg`The round limit was reached.`,
  judge: msg`The judge picked a winner.`,
  vote: msg`The participants voted.`,
  crown: msg`The best candidate was crowned.`,
  completed: msg`Every stage finished.`,
  "single-survivor": msg`Only one candidate finished.`,
};

/** Same tone vocabulary as the tab strip's status dot (`.vc-tab__dot[data-tone]`). */
export type RoundtableTone = "working" | "attention" | "error" | "finished" | "inactive";

export function sessionTone(status: RoundtableSession["status"]): RoundtableTone {
  switch (status) {
    case "running":
      return "working";
    case "paused":
      return "attention";
    case "failed":
      return "error";
    case "done":
      return "finished";
    case "draft":
    case "stopped":
      return "inactive";
  }
}

/** `data-vc-fx-state` values (fx/agentState) a participant chip can carry. */
export type ParticipantFxState = "working" | "attention" | "error" | "idle";

export function turnFxState(status: TurnStatus | undefined): ParticipantFxState {
  switch (status) {
    case "running":
      return "working";
    case "waiting-approval":
      return "attention";
    case "failed":
      return "error";
    default:
      return "idle";
  }
}

/** The turn that is running or waiting for the user, newest first. */
export function findActiveTurn(turns: readonly RoundtableTurn[]): RoundtableTurn | undefined {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index]!;
    if (turn.status === "running" || turn.status === "waiting-approval") return turn;
  }
  return undefined;
}

/** The newest turn of one participant. */
export function latestTurnOf(
  turns: readonly RoundtableTurn[],
  participantId: string,
): RoundtableTurn | undefined {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index]!;
    if (turn.participantId === participantId) return turn;
  }
  return undefined;
}

/** Round limit worth showing ("2/4"); null for unlimited or unset limits. */
export function displayMaxRounds(maxRounds: number): number | null {
  return Number.isFinite(maxRounds) && maxRounds > 0 ? Math.floor(maxRounds) : null;
}

/** "{name} reviewing" style activity line for the status bar. */
export function describeParticipantActivity(
  role: ParticipantRole,
  name: string,
  status: TurnStatus,
): MessageDescriptor {
  if (status === "waiting-approval") return msg`${name} needs your approval`;
  switch (role) {
    case "builder":
      return msg`${name} building`;
    case "reviewer":
      return msg`${name} reviewing`;
    case "planner":
      return msg`${name} planning`;
    case "tester":
      return msg`${name} testing`;
    case "judge":
      return msg`${name} judging`;
    case "member":
      return msg`${name} replying`;
  }
}
