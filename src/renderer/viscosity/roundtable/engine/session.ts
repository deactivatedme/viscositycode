/**
 * ViscosityCode Roundtable engine: turning a start request into a session
 * record (validation, defaults, origin thread binding). Pure apart from the
 * localized error messages.
 */
import { msg } from "@lingui/core/macro";
import { makeThreadTitle } from "@/shared/threadTitle";
import { i18n } from "@/renderer/i18n/i18n";
import type { StartRoundtableInput } from "../api";
import type { RoundtableSession } from "../types";
import { DEFAULT_MAX_ROUNDS, seatedJudge } from "./planner";

export const MIN_PARTICIPANTS = 2;
export const MAX_PARTICIPANTS = 5;
export const MAX_ROUNDS_LIMIT = 20;
const TITLE_MAX = 80;

export class RoundtableInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RoundtableInputError";
  }
}

/** Throws a {@link RoundtableInputError} with a user-facing message when the request cannot run. */
export function validateStartInput(input: StartRoundtableInput): void {
  if (!input.projectId)
    throw new RoundtableInputError(i18n._(msg`Choose a project for the Roundtable.`));
  if (input.pattern !== "open" && !input.task.trim()) {
    throw new RoundtableInputError(i18n._(msg`Describe the task for the Roundtable.`));
  }
  const count = input.participants.length;
  const min = input.pattern === "open" ? 1 : MIN_PARTICIPANTS;
  if (count < min || count > MAX_PARTICIPANTS) {
    throw new RoundtableInputError(
      i18n._(msg`A Roundtable seats ${min} to ${MAX_PARTICIPANTS} participants.`),
    );
  }
  const ids = new Set(input.participants.map((participant) => participant.id));
  if (ids.size !== count || input.participants.some((participant) => !participant.id)) {
    throw new RoundtableInputError(i18n._(msg`Every participant needs its own id.`));
  }
  for (const participant of input.participants) {
    if (!participant.brain.model.trim()) {
      throw new RoundtableInputError(i18n._(msg`Choose a model for every participant.`));
    }
  }
  if (input.pattern === "race") {
    const judge = seatedJudge(input.participants);
    const racers = input.participants.filter((participant) => participant !== judge);
    if (racers.length < 2 || racers.some((participant) => participant.brain.kind !== "agent")) {
      throw new RoundtableInputError(
        i18n._(msg`A race needs at least two installed agents (an API model can only judge).`),
      );
    }
  } else if (input.originThreadId && input.participants[0]?.brain.kind !== "agent") {
    throw new RoundtableInputError(
      i18n._(msg`The first participant must be the agent of the chat the Roundtable starts from.`),
    );
  }
}

export function resolveMaxRounds(
  input: Pick<StartRoundtableInput, "pattern" | "maxRounds">,
): number {
  const fallback = DEFAULT_MAX_ROUNDS[input.pattern];
  if (input.maxRounds === undefined || !Number.isFinite(input.maxRounds)) return fallback;
  const floor = input.pattern === "debate" || input.pattern === "open" ? 0 : 1;
  return Math.min(MAX_ROUNDS_LIMIT, Math.max(floor, Math.round(input.maxRounds)));
}

export function resolveTitle(input: Pick<StartRoundtableInput, "title" | "task">): string {
  const title = input.title?.trim() || makeThreadTitle(input.task) || i18n._(msg`Roundtable`);
  return title.length > TITLE_MAX ? `${title.slice(0, TITLE_MAX - 1)}…` : title;
}

/**
 * The new session record. `originThreadId` binds the origin thread to the first
 * participant (no new thread) — except in a race, where every racer gets its
 * own worktree thread and the origin is quoted as context only.
 */
export function createSessionRecord(
  input: StartRoundtableInput,
  options: {
    id: string;
    now: number;
    worktreePath?: string | undefined;
    worktreeBranch?: string | undefined;
  },
): RoundtableSession {
  const first = input.participants[0];
  const bindOrigin = input.originThreadId && input.pattern !== "race" && first;
  return {
    id: options.id,
    version: 1,
    title: resolveTitle(input),
    task: input.task.trim(),
    pattern: input.pattern,
    projectId: input.projectId,
    ...(options.worktreePath ? { worktreePath: options.worktreePath } : {}),
    ...(options.worktreeBranch ? { worktreeBranch: options.worktreeBranch } : {}),
    participants: input.participants.map((participant) => ({ ...participant })),
    threadIds: bindOrigin ? { [first.id]: input.originThreadId! } : {},
    maxRounds: resolveMaxRounds(input),
    status: "running",
    turns: [],
    ...(input.originThreadId ? { originThreadId: input.originThreadId } : {}),
    ...(input.pattern === "debate" && input.implementWinner ? { implementWinner: true } : {}),
    createdAt: options.now,
    updatedAt: options.now,
  };
}
