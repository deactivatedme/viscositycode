/**
 * ViscosityCode Roundtable engine: the "compare" pattern's read side
 * (additive, AA compare) — each participant's answer, and seeding a debate
 * from a finished comparison.
 *
 * A seeded debate reuses the comparison's participants (same ids), their
 * threads and their checkout, and starts with their answers as its round-0
 * proposals, so the planner goes straight to the critique rounds and every
 * participant continues the conversation it already had. Pure; no store.
 */
import type { ParticipantProfile, RoundtableSession, RoundtableTurn } from "../types";

export interface CompareAnswer {
  participant: ParticipantProfile;
  /** The participant's newest "answer" turn (any status), if it has one. */
  turn: RoundtableTurn | undefined;
}

type CompareSource = Pick<RoundtableSession, "participants" | "turns">;

/** One entry per participant, in seat order, with its newest answer turn. */
export function compareAnswers(session: CompareSource): CompareAnswer[] {
  const latest = new Map<string, RoundtableTurn>();
  for (const turn of session.turns) {
    if (turn.phase === "answer") latest.set(turn.participantId, turn);
  }
  return session.participants.map((participant) => ({
    participant,
    turn: latest.get(participant.id),
  }));
}

/** Participants whose answer finished, in seat order. */
export function answeredParticipants(session: CompareSource): ParticipantProfile[] {
  return compareAnswers(session).flatMap((answer) =>
    answer.turn?.status === "done" ? [answer.participant] : [],
  );
}

function hasEnded(status: RoundtableSession["status"]): boolean {
  return status === "done" || status === "stopped" || status === "failed";
}

/** Why a debate cannot start from `source` with these participants; null when it can. */
export type SeedProblem = "not-a-comparison" | "still-running" | "not-answered" | "too-few-answers";

export function seedProblem(
  source: Pick<RoundtableSession, "pattern" | "status" | "participants" | "turns">,
  participantIds: readonly string[],
): SeedProblem | null {
  if (source.pattern !== "compare") return "not-a-comparison";
  // Seeded participants continue in the comparison's threads: never while it still drives them.
  if (!hasEnded(source.status)) return "still-running";
  const answered = new Set(answeredParticipants(source).map((participant) => participant.id));
  if (participantIds.some((id) => !answered.has(id))) return "not-answered";
  if (participantIds.length < 2) return "too-few-answers";
  return null;
}

/** Whether "Start a debate from here" applies: the comparison ended with two answers or more. */
export function canSeedDebate(
  session: Pick<RoundtableSession, "pattern" | "status" | "participants" | "turns">,
): boolean {
  return (
    seedProblem(
      session,
      answeredParticipants(session).map((participant) => participant.id),
    ) === null
  );
}

/**
 * The debate's opening proposals: one finished "propose" turn per
 * participant, copied from its answer (call {@link seedProblem} first).
 */
export function seedDebateTurns(
  source: CompareSource,
  participants: readonly Pick<ParticipantProfile, "id">[],
  newId: () => string,
): RoundtableTurn[] {
  const answers = new Map(
    compareAnswers(source).map((answer) => [answer.participant.id, answer.turn]),
  );
  return participants.flatMap((participant) => {
    const answer = answers.get(participant.id);
    if (answer?.status !== "done") return [];
    return [
      {
        id: newId(),
        participantId: participant.id,
        round: 0,
        phase: "propose" as const,
        prompt: answer.prompt,
        status: "done" as const,
        ...(answer.responseText !== undefined ? { responseText: answer.responseText } : {}),
        ...(answer.startedAt !== undefined ? { startedAt: answer.startedAt } : {}),
        ...(answer.endedAt !== undefined ? { endedAt: answer.endedAt } : {}),
        ...(answer.truncated ? { truncated: true } : {}),
      },
    ];
  });
}

/** The comparison's threads of the seeded participants (they continue there). */
export function seedThreadIds(
  source: Pick<RoundtableSession, "threadIds">,
  participants: readonly Pick<ParticipantProfile, "id">[],
): Record<string, string> {
  const threadIds: Record<string, string> = {};
  for (const participant of participants) {
    const threadId = source.threadIds[participant.id];
    if (threadId) threadIds[participant.id] = threadId;
  }
  return threadIds;
}

/** The comparison's checkout, which its threads already work in. */
export function seedWorkspace(source: Pick<RoundtableSession, "worktreePath" | "worktreeBranch">): {
  worktreePath?: string;
  worktreeBranch?: string;
} {
  return {
    ...(source.worktreePath ? { worktreePath: source.worktreePath } : {}),
    ...(source.worktreeBranch ? { worktreeBranch: source.worktreeBranch } : {}),
  };
}

function isActive(status: RoundtableSession["status"]): boolean {
  return status === "running" || status === "paused";
}

type SeededDebateCandidate = Pick<
  RoundtableSession,
  "id" | "status" | "createdAt" | "seededFromSessionId"
>;

/** The newest debate started from this comparison, if any. */
export function latestSeededDebate<T extends SeededDebateCandidate>(
  sessions: Readonly<Record<string, T>>,
  compareId: string,
): T | undefined {
  let latest: T | undefined;
  for (const session of Object.values(sessions)) {
    if (session.seededFromSessionId !== compareId) continue;
    if (!latest || session.createdAt > latest.createdAt) latest = session;
  }
  return latest;
}

/**
 * Whether a debate from this comparison is still running (or paused): it
 * drives the comparison's threads, so a second one must not start.
 */
export function hasActiveSeededDebate(
  sessions: Readonly<Record<string, SeededDebateCandidate>>,
  compareId: string,
): boolean {
  return Object.values(sessions).some(
    (session) => session.seededFromSessionId === compareId && isActive(session.status),
  );
}
