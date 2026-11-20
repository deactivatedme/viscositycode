/**
 * ViscosityCode Roundtable UI: the setup dialog's form model (pure).
 *
 * Holds the draft, its validation and the conversion to the engine's
 * `StartRoundtableInput`. Provider-agnostic: an agent seat is described only
 * by what `useReadyAgentBrains` reports (kind, models, presentation modes).
 */
import { parseAgentProfileKind } from "@/shared/contracts";
import type { SavedPlaybook } from "@/shared/viscosity/playbook";
import { XAI_DEFAULT_TEXT_MODEL } from "@/shared/viscosity/xaiContract";
import type { ReadyAgentBrain, StartRoundtableInput } from "../api";
import { readOnlyEditingSeat } from "../playbooks";
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
  patternIsAnswerOnly,
  patternUsesOwnWorktrees,
} from "./patterns";

export type WorktreeMode = "current" | "new-branch";

export interface SetupSeat {
  /** Stable row key, reused as the participant id. */
  id: string;
  brain: ParticipantBrain;
  role: ParticipantRole;
  /** Optional carried-over profile fields (prefilled seats). */
  label?: string;
  instructions?: string;
  avatar?: ParticipantProfile["avatar"];
  /** Additive (Playbooks): this seat's own playbook; `null` = none; absent = the table's. */
  playbookId?: string | null;
}

export interface RoundtableSetupDraft {
  title: string;
  /** The task; for the open pattern, the optional first message. */
  task: string;
  /** Instructions for everyone (optional). */
  instructions: string;
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
  /** Additive (Playbooks): the table's playbook id, if any. */
  playbookId?: string;
}

export type SetupProblem =
  | "no-project"
  | "no-task"
  | "too-few-participants"
  | "too-many-participants"
  | "missing-model"
  | "invalid-rounds"
  /** The table's playbook is read-only and the pattern needs edits. */
  | "read-only-playbook";

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
 * The agent for a new seat: the first ready provider nobody is using yet (two
 * accounts of one provider count as one), so a fresh table mixes
 * subscriptions; then an unused account; once all are seated, start over.
 */
export function nextReadyBrain(
  ready: readonly ReadyAgentBrain[],
  seats: readonly SetupSeat[],
): ReadyAgentBrain | undefined {
  const usedKinds = new Set(
    seats.flatMap((seat) => (seat.brain.kind === "agent" ? [seat.brain.agentKind] : [])),
  );
  const usedProviders = new Set([...usedKinds].map(providerOf));
  return (
    ready.find((brain) => !usedProviders.has(providerOf(brain.agentKind))) ??
    ready.find((brain) => !usedKinds.has(brain.agentKind)) ??
    ready[seats.length % ready.length]
  );
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
    ...(profile.playbookId !== undefined ? { playbookId: profile.playbookId } : {}),
  };
}

/**
 * The provider an agent kind belongs to: several accounts of one provider
 * (account-pool profiles, "<driver>:<id>") count as one.
 */
function providerOf(agentKind: string): string {
  return parseAgentProfileKind(agentKind)?.driver ?? agentKind;
}

/**
 * Additive (AA compare): "ask all" — one more seat for every ready provider
 * not seated yet, in the engine's order (which already prefers the pooled
 * account with the most usage left), up to the seat limit.
 */
export function seatAllReady(
  draft: RoundtableSetupDraft,
  ready: readonly ReadyAgentBrain[],
): RoundtableSetupDraft {
  const seated = new Set(
    draft.seats.flatMap((seat) =>
      seat.brain.kind === "agent" ? [providerOf(seat.brain.agentKind)] : [],
    ),
  );
  let next = draft;
  for (const brain of ready) {
    if (!canAddSeat(next)) break;
    const provider = providerOf(brain.agentKind);
    if (seated.has(provider)) continue;
    seated.add(provider);
    next = addSeat(next, agentBrainFor(brain));
  }
  return next;
}

/**
 * Additive (AA compare): identifies what "ask all" seats on an empty table
 * for this ready list (one brain per ready provider, in order, up to the
 * seat limit). Equal keys mean the same seats, so the setup dialog can keep
 * following a ready list that is still filling in without reseating on
 * every render.
 */
export function askAllSeatingKey(ready: readonly ReadyAgentBrain[]): string {
  const seated = new Set<string>();
  const brains: ParticipantBrain[] = [];
  for (const brain of ready) {
    if (brains.length >= MAX_PARTICIPANTS) break;
    const provider = providerOf(brain.agentKind);
    if (seated.has(provider)) continue;
    seated.add(provider);
    brains.push(agentBrainFor(brain));
  }
  return JSON.stringify(brains);
}

/** Initial seats: two different ready agents when available (compare: every ready provider). */
export function initialSeats(
  ready: readonly ReadyAgentBrain[],
  pattern: RoundtablePattern,
): SetupSeat[] {
  if (ready.length === 0) return [];
  if (patternIsAnswerOnly(pattern)) {
    return seatAllReady(
      {
        title: "",
        task: "",
        instructions: "",
        projectId: undefined,
        pattern,
        seats: [],
        maxRounds: defaultMaxRounds(pattern) ?? 1,
        worktreeMode: "current",
        branchName: "",
      },
      ready,
    ).seats;
  }
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
  patch: Partial<Pick<SetupSeat, "brain" | "role" | "instructions">>,
): RoundtableSetupDraft {
  return {
    ...draft,
    seats: draft.seats.map((seat) => (seat.id === seatId ? { ...seat, ...patch } : seat)),
    ...(patch.role !== undefined ? { rolesCustomized: true } : {}),
  };
}

/** A seat's own playbook: an id, `null` for none, `undefined` for the table's. */
export function setSeatPlaybook(
  draft: RoundtableSetupDraft,
  seatId: string,
  playbookId: string | null | undefined,
): RoundtableSetupDraft {
  return {
    ...draft,
    seats: draft.seats.map((seat) => {
      if (seat.id !== seatId) return seat;
      const { playbookId: _previous, ...rest } = seat;
      return playbookId === undefined ? rest : { ...rest, playbookId };
    }),
  };
}

/** Whether the form asks for a round limit (not for the open chat, nor one-answer compare). */
export function roundsApply(pattern: RoundtablePattern): boolean {
  return !patternIsAnswerOnly(pattern) && defaultMaxRounds(pattern) !== undefined;
}

/**
 * First thing that keeps the form from starting, or null when it can start.
 * `playbooks` is the catalog the table's and seats' playbooks are looked up in.
 */
export function validateSetup(
  draft: RoundtableSetupDraft,
  playbooks: readonly SavedPlaybook[] = [],
): SetupProblem | null {
  if (!draft.projectId) return "no-project";
  // An open chat can start empty: it waits for the first message.
  if (draft.pattern !== "open" && draft.task.trim().length === 0) return "no-task";
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
  const participants = buildParticipants(draft.seats, []);
  if (readOnlyEditingSeat({ ...draft, participants }, playbooks)) {
    return "read-only-playbook";
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
  return seats.map((seat, index) => {
    const instructions = seat.instructions?.trim();
    return {
      id: seat.id,
      label: labels[index]!,
      role: seat.role,
      brain: seat.brain,
      ...(instructions ? { instructions } : {}),
      ...(seat.avatar ? { avatar: seat.avatar } : {}),
      ...(seat.playbookId !== undefined ? { playbookId: seat.playbookId } : {}),
    };
  });
}

/** The engine call for a valid draft (call `validateSetup` first). */
export function buildStartInput(
  draft: RoundtableSetupDraft,
  ready: readonly ReadyAgentBrain[],
): StartRoundtableInput {
  const title = draft.title.trim();
  const instructions = draft.instructions.trim();
  const branchName = draft.branchName.trim();
  // Race gives every participant its own worktree, and compare changes no
  // files, so neither takes a checkout choice.
  const worktree: StartRoundtableInput["worktree"] =
    patternUsesOwnWorktrees(draft.pattern) || patternIsAnswerOnly(draft.pattern)
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
    ...(instructions ? { instructions } : {}),
    ...(draft.playbookId ? { playbookId: draft.playbookId } : {}),
  };
}
