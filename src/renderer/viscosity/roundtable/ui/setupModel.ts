/**
 * ViscosityCode Roundtable UI: the setup dialog's form model (pure).
 *
 * Holds the draft, its validation and the conversion to the engine's
 * `StartRoundtableInput`. Provider-agnostic: an agent seat is described only
 * by what `useReadyAgentBrains` reports (kind, models, presentation modes).
 */
import { XAI_DEFAULT_TEXT_MODEL } from "@/shared/viscosity/xaiContract";
import type { ReadyAgentBrain, StartRoundtableInput } from "../api";
import type {
  ParticipantBrain,
  ParticipantProfile,
  ParticipantRole,
  RoundtablePattern,
} from "../types";
import {
  defaultMaxRounds,
  defaultRolesForPattern,
  MAX_PARTICIPANTS,
  MAX_ROUNDS_LIMIT,
  MIN_PARTICIPANTS,
  patternUsesOwnWorktrees,
} from "./patterns";

export type WorktreeMode = "current" | "new-branch";

export interface SetupSeat {
  /** Stable row key, reused as the participant id. */
  id: string;
  brain: ParticipantBrain;
  role: ParticipantRole;
  /** Optional carried-over profile fields (bots, prefilled seats). */
  label?: string;
  instructions?: string;
  avatar?: ParticipantProfile["avatar"];
}

export interface RoundtableSetupDraft {
  title: string;
  task: string;
  projectId: string | undefined;
  pattern: RoundtablePattern;
  seats: SetupSeat[];
  /** Ignored for the open pattern (unlimited). */
  maxRounds: number;
  worktreeMode: WorktreeMode;
  branchName: string;
  originThreadId?: string;
  /** Set once the user picks a role by hand; until then roles follow the pattern. */
  rolesCustomized?: boolean;
}

export type SetupProblem =
  | "no-project"
  | "no-task"
  | "too-few-participants"
  | "too-many-participants"
  | "missing-model"
  | "invalid-rounds";

function newSeatId(): string {
  return globalThis.crypto.randomUUID();
}

/** Chat presentation when the agent offers it (its final answer is readable), else its first mode. */
export function preferredPresentationMode(
  brain: Pick<ReadyAgentBrain, "presentationModes">,
): "gui" | "terminal" {
  if (brain.presentationModes.includes("gui")) return "gui";
  return brain.presentationModes[0] ?? "gui";
}

export function agentBrainFor(
  ready: ReadyAgentBrain,
  model: string = ready.defaultModel,
  presentationMode: "gui" | "terminal" = preferredPresentationMode(ready),
): ParticipantBrain {
  return {
    kind: "agent",
    agentKind: ready.agentKind,
    ...(ready.agentInstanceId ? { agentInstanceId: ready.agentInstanceId } : {}),
    model,
    presentationMode,
  };
}

export function xaiBrain(): ParticipantBrain {
  return {
    kind: "xai",
    model: XAI_DEFAULT_TEXT_MODEL,
    region: "global",
    tools: { webSearch: false, xSearch: false },
  };
}

/**
 * The agent for a new seat: the first ready agent nobody is using yet, so a
 * fresh table mixes subscriptions; once all are seated, start over.
 */
export function nextReadyBrain(
  ready: readonly ReadyAgentBrain[],
  seats: readonly SetupSeat[],
): ReadyAgentBrain | undefined {
  const used = new Set(
    seats.flatMap((seat) => (seat.brain.kind === "agent" ? [seat.brain.agentKind] : [])),
  );
  return ready.find((brain) => !used.has(brain.agentKind)) ?? ready[seats.length % ready.length];
}

export function createSeat(brain: ParticipantBrain, role: ParticipantRole): SetupSeat {
  return { id: newSeatId(), brain, role };
}

export function seatFromProfile(profile: ParticipantProfile): SetupSeat {
  return {
    id: profile.id || newSeatId(),
    brain: profile.brain,
    role: profile.role,
    label: profile.label,
    ...(profile.instructions ? { instructions: profile.instructions } : {}),
    ...(profile.avatar ? { avatar: profile.avatar } : {}),
  };
}

/** Initial seats: two different ready agents when available. */
export function initialSeats(
  ready: readonly ReadyAgentBrain[],
  pattern: RoundtablePattern,
): SetupSeat[] {
  if (ready.length === 0) return [];
  const roles = defaultRolesForPattern(pattern, MIN_PARTICIPANTS);
  const seats: SetupSeat[] = [];
  for (const role of roles) {
    const brain = nextReadyBrain(ready, seats);
    if (!brain) break;
    seats.push(createSeat(agentBrainFor(brain), role));
  }
  return seats;
}

/** Reassign every seat's default role for a pattern. */
export function withPatternRoles(seats: readonly SetupSeat[], pattern: RoundtablePattern) {
  const roles = defaultRolesForPattern(pattern, seats.length);
  return seats.map((seat, index) => ({ ...seat, role: roles[index] ?? "member" }));
}

export function changePattern(
  draft: RoundtableSetupDraft,
  pattern: RoundtablePattern,
): RoundtableSetupDraft {
  if (draft.pattern === pattern) return draft;
  return {
    ...draft,
    pattern,
    seats: withPatternRoles(draft.seats, pattern),
    maxRounds: defaultMaxRounds(pattern) ?? draft.maxRounds,
    rolesCustomized: false,
  };
}

/** Seats after a change in count: the pattern's chain unless the user set roles by hand. */
function reseat(draft: RoundtableSetupDraft, seats: SetupSeat[]): RoundtableSetupDraft {
  return {
    ...draft,
    seats: draft.rolesCustomized ? seats : withPatternRoles(seats, draft.pattern),
  };
}

export function canAddSeat(draft: Pick<RoundtableSetupDraft, "seats">): boolean {
  return draft.seats.length < MAX_PARTICIPANTS;
}

/** Add a seat; it takes the pattern's default role for its position. */
export function addSeat(
  draft: RoundtableSetupDraft,
  brain: ParticipantBrain,
): RoundtableSetupDraft {
  if (!canAddSeat(draft)) return draft;
  const roles = defaultRolesForPattern(draft.pattern, draft.seats.length + 1);
  const role = roles[draft.seats.length] ?? "member";
  return reseat(draft, [...draft.seats, createSeat(brain, role)]);
}

export function removeSeat(draft: RoundtableSetupDraft, seatId: string): RoundtableSetupDraft {
  return reseat(
    draft,
    draft.seats.filter((seat) => seat.id !== seatId),
  );
}

export function updateSeat(
  draft: RoundtableSetupDraft,
  seatId: string,
  patch: Partial<Pick<SetupSeat, "brain" | "role">>,
): RoundtableSetupDraft {
  return {
    ...draft,
    seats: draft.seats.map((seat) => (seat.id === seatId ? { ...seat, ...patch } : seat)),
    ...(patch.role !== undefined ? { rolesCustomized: true } : {}),
  };
}

export function roundsApply(pattern: RoundtablePattern): boolean {
  return defaultMaxRounds(pattern) !== undefined;
}

/** First thing that keeps the form from starting, or null when it can start. */
export function validateSetup(draft: RoundtableSetupDraft): SetupProblem | null {
  if (!draft.projectId) return "no-project";
  if (draft.task.trim().length === 0) return "no-task";
  if (draft.seats.length < MIN_PARTICIPANTS) return "too-few-participants";
  if (draft.seats.length > MAX_PARTICIPANTS) return "too-many-participants";
  if (draft.seats.some((seat) => seat.brain.model.trim().length === 0)) return "missing-model";
  if (
    roundsApply(draft.pattern) &&
    (!Number.isInteger(draft.maxRounds) ||
      draft.maxRounds < 1 ||
      draft.maxRounds > MAX_ROUNDS_LIMIT)
  ) {
    return "invalid-rounds";
  }
  return null;
}

/** Display label for a brain: "<provider> · <model>", or "Grok · <model>" for the xAI API. */
export function brainLabel(brain: ParticipantBrain, ready: readonly ReadyAgentBrain[]): string {
  if (brain.kind === "xai") return `Grok · ${brain.model}`;
  const agent = ready.find((candidate) => candidate.agentKind === brain.agentKind);
  const model = agent?.models.find((candidate) => candidate.id === brain.model)?.label;
  return `${agent?.label ?? brain.agentKind} · ${model ?? brain.model}`;
}

/** Make labels unique by numbering repeats ("Claude · Opus", "Claude · Opus 2"). */
export function uniqueLabels(labels: readonly string[]): string[] {
  const counts = new Map<string, number>();
  return labels.map((label) => {
    const seen = (counts.get(label) ?? 0) + 1;
    counts.set(label, seen);
    return seen === 1 ? label : `${label} ${seen}`;
  });
}

export function buildParticipants(
  seats: readonly SetupSeat[],
  ready: readonly ReadyAgentBrain[],
): ParticipantProfile[] {
  const labels = uniqueLabels(seats.map((seat) => seat.label ?? brainLabel(seat.brain, ready)));
  return seats.map((seat, index) => ({
    id: seat.id,
    label: labels[index]!,
    role: seat.role,
    brain: seat.brain,
    ...(seat.instructions ? { instructions: seat.instructions } : {}),
    ...(seat.avatar ? { avatar: seat.avatar } : {}),
  }));
}

/** The engine call for a valid draft (call `validateSetup` first). */
export function buildStartInput(
  draft: RoundtableSetupDraft,
  ready: readonly ReadyAgentBrain[],
): StartRoundtableInput {
  const title = draft.title.trim();
  const branchName = draft.branchName.trim();
  // Race gives every participant its own worktree, so it takes no checkout choice.
  const worktree: StartRoundtableInput["worktree"] = patternUsesOwnWorktrees(draft.pattern)
    ? undefined
    : draft.worktreeMode === "current"
      ? { mode: "current" }
      : { mode: "new-branch", ...(branchName ? { branchName } : {}) };
  return {
    ...(title ? { title } : {}),
    task: draft.task.trim(),
    pattern: draft.pattern,
    projectId: draft.projectId ?? "",
    participants: buildParticipants(draft.seats, ready),
    ...(roundsApply(draft.pattern) ? { maxRounds: draft.maxRounds } : {}),
    ...(worktree ? { worktree } : {}),
    ...(draft.originThreadId ? { originThreadId: draft.originThreadId } : {}),
  };
}
