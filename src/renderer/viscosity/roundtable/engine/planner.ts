/**
 * ViscosityCode Roundtable engine: the pure state machine.
 *
 * `planNextStep(session)` looks only at the stored session (participants,
 * turns, notes, outcome) and says what happens next: run a batch of turns
 * (one, or several in parallel), launch or crown a race, wait for the user, or
 * finish. Because the position is re-derived from the turns every time, a
 * reloaded window resumes exactly where it stopped, and the runner that
 * performs the side effects stays small.
 *
 * Patterns: build ↔ review, debate, relay, race, open group chat, and
 * (additive, AA compare) compare — everyone answers once, in parallel.
 *
 * Turn slots: a slot is (participant, round, phase[, note]). Its latest turn
 * decides its state — `done`, `failed`, or open (no turn, or only `stopped`
 * turns, which are re-run). Pure; no store, no React.
 */
import type {
  ParticipantProfile,
  ParticipantRole,
  RoundtableOutcome,
  RoundtablePattern,
  RoundtableSession,
  RoundtableTurn,
  RoundtableTurnPhase,
} from "../types";
import {
  buildBuilderPrompt,
  buildCompareAnswerPrompt,
  buildCritiquePrompt,
  buildCrossReviewPrompt,
  buildImplementPrompt,
  buildJudgePrompt,
  buildOpenReplyPrompt,
  buildProposalPrompt,
  buildRacePrompt,
  buildRelayStagePrompt,
  buildReviewerPrompt,
  OPEN_TRANSCRIPT_MESSAGES,
  type ChatMessage,
  type PromptIdentity,
  type QuotedOutput,
} from "./prompts";
import { uniqueLabels } from "./text";
import { findMentions, parsePick, parseVerdict, tallyPicks, type PickCandidate } from "./verdicts";

/** Per-pattern defaults for `maxRounds` (open: unlimited and compare: one answer; both unused). */
export const DEFAULT_MAX_ROUNDS: Record<RoundtablePattern, number> = {
  "build-review": 4,
  debate: 2,
  relay: 3,
  race: 1,
  open: 0,
  compare: 1,
};
/** Reaction rounds participants may add to one user message in the open pattern. */
export const OPEN_REACTION_ROUNDS = 2;

export interface PlannedTurn {
  participantId: string;
  round: number;
  phase: RoundtableTurnPhase;
  prompt: string;
  noteId?: string;
  /** Threads to attach as `{kind:"thread"}` context when the participant can read them. */
  contextThreadIds?: string[];
}

export type FailureReason = "turn-failed" | "not-enough-participants" | "no-race-candidates";

export type RoundtablePlan =
  | { kind: "run"; turns: PlannedTurn[]; deliverNoteIds: string[] }
  | { kind: "race-launch"; prompt: string; participantIds: string[]; deliverNoteIds: string[] }
  | { kind: "race-crown"; judgeParticipantId?: string; fallbackWinnerParticipantId?: string }
  | { kind: "idle" }
  | { kind: "finish"; status: "done"; winnerParticipantId?: string; outcome: RoundtableOutcome }
  | { kind: "finish"; status: "failed"; reason: FailureReason; turnId?: string };

export interface PlannerContext {
  /**
   * The thread the Roundtable started from, as context for every OTHER
   * participant's first turn: quoted text, plus a thread reference when
   * `mention` (the read_thread tool) is available.
   */
  origin?: { threadId: string; text: string; mention: boolean };
}

type SlotState =
  | { state: "done"; turn: RoundtableTurn }
  | { state: "failed"; turn: RoundtableTurn }
  | { state: "open" };

function slotKey(participantId: string, round: number, phase: string, noteId?: string): string {
  return `${participantId}\u0000${round}\u0000${phase}\u0000${noteId ?? ""}`;
}

/** Read-only view over a session used by every pattern. */
class SessionView {
  readonly labels: Map<string, string>;
  private readonly slots = new Map<string, RoundtableTurn>();

  constructor(
    readonly session: RoundtableSession,
    readonly context: PlannerContext,
  ) {
    this.labels = uniqueLabels(session.participants);
    for (const turn of session.turns) {
      this.slots.set(slotKey(turn.participantId, turn.round, turn.phase ?? "", turn.noteId), turn);
    }
  }

  label(participantId: string): string {
    return this.labels.get(participantId) ?? participantId;
  }

  candidate(participant: ParticipantProfile): PickCandidate {
    return { id: participant.id, label: this.label(participant.id) };
  }

  slot(
    participantId: string,
    round: number,
    phase: RoundtableTurnPhase,
    noteId?: string,
  ): SlotState {
    const turn = this.slots.get(slotKey(participantId, round, phase, noteId));
    if (turn?.status === "done") return { state: "done", turn };
    if (turn?.status === "failed") return { state: "failed", turn };
    return { state: "open" };
  }

  output(turn: RoundtableTurn): QuotedOutput {
    return { label: this.label(turn.participantId), text: turn.responseText ?? "" };
  }

  /** Steering notes not yet carried by a turn (non-open patterns). */
  pendingNotes(): { ids: string[]; texts: string[] } {
    const notes = (this.session.notes ?? []).filter((note) => !note.deliveredTurnId);
    return { ids: notes.map((note) => note.id), texts: notes.map((note) => note.text) };
  }

  private hasHistory(participantId: string): boolean {
    if (
      this.session.turns.some(
        (turn) => turn.participantId === participantId && turn.status === "done",
      )
    ) {
      return true;
    }
    // The origin participant continues its own conversation.
    return this.isOriginParticipant(participantId);
  }

  isOriginParticipant(participantId: string): boolean {
    return (
      this.session.originThreadId !== undefined &&
      this.session.pattern !== "race" &&
      this.session.participants[0]?.id === participantId
    );
  }

  /**
   * Whether this participant's next prompt carries the instructions: on its
   * first finished turn (the origin seat too), and again once an edit changed
   * its own or the shared instructions after its latest finished turn
   * started. Not on every turn: thread drivers keep every prompt in the
   * agent's own context. A race launch prompt is shared by every racer and
   * cannot carry a racer's own instructions, so race turns do not count.
   */
  private instructionsDue(participantId: string): "first" | "edited" | false {
    let latestStart: number | undefined;
    for (const turn of this.session.turns) {
      if (turn.participantId !== participantId || turn.status !== "done") continue;
      if (turn.phase === "race") continue;
      latestStart = Math.max(latestStart ?? 0, turn.startedAt ?? 0);
    }
    if (latestStart === undefined) return "first";
    const own = this.session.instructionsUpdatedFor?.[participantId];
    const stamp = Math.max(
      typeof own === "number" ? own : 0,
      this.session.instructionsUpdatedAt ?? 0,
    );
    return stamp > latestStart ? "edited" : false;
  }

  /** The task for prompts; empty for an open chat whose task is just its first message. */
  private promptTask(): string {
    const { session } = this;
    const first = session.notes?.[0];
    if (session.pattern === "open" && first && first.text.trim() === session.task.trim()) return "";
    return session.task;
  }

  /** Prompt identity for one participant's next turn. */
  identity(participant: ParticipantProfile, notes: readonly string[] = []): PromptIdentity {
    const first = !this.hasHistory(participant.id);
    const refresh = this.instructionsDue(participant.id);
    const origin = this.context.origin;
    const originParticipant = this.session.participants[0];
    return {
      selfLabel: this.label(participant.id),
      role: participant.role,
      pattern: this.session.pattern,
      roster: this.session.participants.map((member) => this.label(member.id)),
      task: this.promptTask(),
      ...(refresh && participant.instructions ? { instructions: participant.instructions } : {}),
      ...(refresh && this.session.instructions
        ? { sharedInstructions: this.session.instructions }
        : {}),
      ...(refresh === "edited" ? { instructionsEdited: true } : {}),
      notes,
      ...(first && origin && originParticipant && !this.isOriginParticipant(participant.id)
        ? {
            origin: {
              label:
                this.session.pattern === "race"
                  ? "the original conversation"
                  : this.label(originParticipant.id),
              text: origin.text,
              mention: origin.mention,
            },
          }
        : {}),
    };
  }

  /** Thread references to attach to a participant's first turn. */
  contextThreadIds(participant: ParticipantProfile): string[] | undefined {
    const origin = this.context.origin;
    if (!origin?.mention || this.hasHistory(participant.id)) return undefined;
    if (this.isOriginParticipant(participant.id)) return undefined;
    return [origin.threadId];
  }

  planned(
    participant: ParticipantProfile,
    round: number,
    phase: RoundtableTurnPhase,
    prompt: string,
    noteId?: string,
  ): PlannedTurn {
    const contextThreadIds = this.contextThreadIds(participant);
    return {
      participantId: participant.id,
      round,
      phase,
      prompt,
      ...(noteId ? { noteId } : {}),
      ...(contextThreadIds ? { contextThreadIds } : {}),
    };
  }
}

function run(turns: PlannedTurn[], deliverNoteIds: string[] = []): RoundtablePlan {
  return { kind: "run", turns, deliverNoteIds };
}

function failed(reason: FailureReason, turn?: RoundtableTurn): RoundtablePlan {
  return { kind: "finish", status: "failed", reason, ...(turn ? { turnId: turn.id } : {}) };
}

function done(outcome: RoundtableOutcome, winnerParticipantId?: string): RoundtablePlan {
  return {
    kind: "finish",
    status: "done",
    outcome,
    ...(winnerParticipantId ? { winnerParticipantId } : {}),
  };
}

function firstWithRole(
  participants: readonly ParticipantProfile[],
  role: ParticipantRole,
): ParticipantProfile | undefined {
  return participants.find((participant) => participant.role === role);
}

/**
 * The participant that judges instead of competing (debate, race): the first
 * "judge" — but only while at least two others remain to be judged; otherwise
 * it takes part like everyone else.
 */
export function seatedJudge(
  participants: readonly ParticipantProfile[],
): ParticipantProfile | undefined {
  const judge = firstWithRole(participants, "judge");
  if (!judge) return undefined;
  return participants.filter((participant) => participant !== judge).length >= 2
    ? judge
    : undefined;
}

/**
 * Seats whose turns edit files, as the plans below pick them: the builder
 * (build ↔ review), every relay stage, every racer, and every debater when the
 * winner implements (any of them can win). Other patterns edit nothing.
 */
export function editingSeats(
  session: Pick<RoundtableSession, "pattern" | "participants" | "implementWinner">,
): ParticipantProfile[] {
  const { participants } = session;
  switch (session.pattern) {
    case "build-review": {
      const builder = firstWithRole(participants, "builder") ?? participants[0];
      return builder ? [builder] : [];
    }
    case "relay":
      return [...participants];
    case "race":
    case "debate": {
      if (session.pattern === "debate" && !session.implementWinner) return [];
      const judge = seatedJudge(participants);
      return participants.filter((participant) => participant !== judge);
    }
    default:
      return [];
  }
}

// --- build ↔ review ------------------------------------------------------------

function planBuildReview(view: SessionView): RoundtablePlan {
  const { session } = view;
  const builder = firstWithRole(session.participants, "builder") ?? session.participants[0];
  if (!builder) return failed("not-enough-participants");
  const reviewers = session.participants.filter((participant) => participant.id !== builder.id);
  if (reviewers.length === 0) return failed("not-enough-participants");
  const maxRounds = Math.max(1, session.maxRounds);
  const notes = view.pendingNotes();
  let previousReviews: RoundtableTurn[] = [];
  for (let round = 0; round < maxRounds; round += 1) {
    const build = view.slot(builder.id, round, "build");
    if (build.state === "failed") return failed("turn-failed", build.turn);
    if (build.state === "open") {
      const prompt = buildBuilderPrompt(view.identity(builder, notes.texts), {
        round,
        maxRounds,
        reviews: previousReviews.map((turn) => view.output(turn)),
      });
      return run([view.planned(builder, round, "build", prompt)], notes.ids);
    }
    const reviews: RoundtableTurn[] = [];
    const missing: ParticipantProfile[] = [];
    for (const reviewer of reviewers) {
      const review = view.slot(reviewer.id, round, "review");
      if (review.state === "failed") return failed("turn-failed", review.turn);
      if (review.state === "done") reviews.push(review.turn);
      else missing.push(reviewer);
    }
    if (missing.length > 0) {
      return run(
        missing.map((reviewer) =>
          view.planned(
            reviewer,
            round,
            "review",
            buildReviewerPrompt(view.identity(reviewer, notes.texts), {
              builder: view.output(build.turn),
              round,
            }),
          ),
        ),
        notes.ids,
      );
    }
    if (reviews.every((review) => review.verdict === "approve")) {
      return done({ reason: "approved" }, builder.id);
    }
    previousReviews = reviews.filter((review) => review.verdict !== "approve");
  }
  return done({ reason: "max-rounds" }, builder.id);
}

// --- debate ----------------------------------------------------------------------

function planDebate(view: SessionView): RoundtablePlan {
  const { session } = view;
  const judge = seatedJudge(session.participants);
  const proposers = session.participants.filter((participant) => participant !== judge);
  const critiqueRounds = Math.max(0, session.maxRounds);
  const notes = view.pendingNotes();

  // A proposer whose turn failed drops out; the debate goes on while two remain.
  let alive = [...proposers];
  let lastFailure: RoundtableTurn | undefined;
  const dropFailed = (round: number, phase: RoundtableTurnPhase) => {
    alive = alive.filter((proposer) => {
      const slot = view.slot(proposer.id, round, phase);
      if (slot.state === "failed") lastFailure = slot.turn;
      return slot.state !== "failed";
    });
  };

  const latestOf = (participantId: string, beforeRound: number): RoundtableTurn | undefined => {
    for (let round = beforeRound - 1; round >= 0; round -= 1) {
      const slot = view.slot(participantId, round, round === 0 ? "propose" : "critique");
      if (slot.state === "done") return slot.turn;
    }
    return undefined;
  };

  for (let round = 0; round <= critiqueRounds; round += 1) {
    const phase: RoundtableTurnPhase = round === 0 ? "propose" : "critique";
    dropFailed(round, phase);
    if (alive.length < 2) {
      if (alive.length === 1 && lastFailure && round > 0) {
        return done({ reason: "single-survivor" }, alive[0]!.id);
      }
      return failed(lastFailure ? "turn-failed" : "not-enough-participants", lastFailure);
    }
    const missing = alive.filter(
      (proposer) => view.slot(proposer.id, round, phase).state === "open",
    );
    if (missing.length === 0) continue;
    return run(
      missing.map((proposer) => {
        const identity = view.identity(proposer, notes.texts);
        if (round === 0) return view.planned(proposer, round, phase, buildProposalPrompt(identity));
        const others = alive
          .filter((other) => other.id !== proposer.id)
          .map((other) => latestOf(other.id, round))
          .filter((turn): turn is RoundtableTurn => turn !== undefined)
          .map((turn) => view.output(turn));
        const prompt = buildCritiquePrompt(identity, {
          round,
          rounds: critiqueRounds,
          own: latestOf(proposer.id, round)?.responseText,
          others,
        });
        return view.planned(proposer, round, phase, prompt);
      }),
      notes.ids,
    );
  }

  const finals = alive.map((proposer) => ({
    proposer,
    turn: latestOf(proposer.id, critiqueRounds + 1)!,
  }));
  const decideRound = critiqueRounds + 1;
  let winner: string | undefined;
  let outcome: RoundtableOutcome;
  let decision: RoundtableTurn | undefined;
  if (judge) {
    const slot = view.slot(judge.id, decideRound, "decide");
    if (slot.state === "failed") return failed("turn-failed", slot.turn);
    if (slot.state === "open") {
      const prompt = buildJudgePrompt(view.identity(judge, notes.texts), {
        candidates: finals.map(({ turn }) => view.output(turn)),
        vote: false,
        kind: "proposal",
      });
      return run([view.planned(judge, decideRound, "decide", prompt)], notes.ids);
    }
    decision = slot.turn;
    winner =
      slot.turn.pickedParticipantId && alive.some((p) => p.id === slot.turn.pickedParticipantId)
        ? slot.turn.pickedParticipantId
        : alive[0]!.id;
    outcome = {
      reason: "judge",
      ...(slot.turn.responseText ? { rationale: slot.turn.responseText } : {}),
    };
  } else {
    const votes: RoundtableTurn[] = [];
    const missing: ParticipantProfile[] = [];
    for (const voter of alive) {
      const slot = view.slot(voter.id, decideRound, "decide");
      if (slot.state === "done") votes.push(slot.turn);
      else if (slot.state === "open") missing.push(voter);
      // A failed vote simply does not count.
    }
    if (missing.length > 0) {
      return run(
        missing.map((voter) =>
          view.planned(
            voter,
            decideRound,
            "decide",
            buildJudgePrompt(view.identity(voter, notes.texts), {
              candidates: finals
                .filter(({ proposer }) => proposer.id !== voter.id)
                .map(({ turn }) => view.output(turn)),
              vote: true,
              kind: "proposal",
            }),
          ),
        ),
        notes.ids,
      );
    }
    const picks = votes.map((vote) =>
      vote.pickedParticipantId !== vote.participantId ? vote.pickedParticipantId : undefined,
    );
    winner = tallyPicks(
      picks,
      alive.map((proposer) => proposer.id),
    ).winner;
    outcome = { reason: "vote" };
  }
  if (!winner) return failed("not-enough-participants");

  if (session.implementWinner) {
    const implementer = alive.find((proposer) => proposer.id === winner)!;
    const slot = view.slot(winner, decideRound + 1, "implement");
    if (slot.state === "failed") return failed("turn-failed", slot.turn);
    if (slot.state === "open") {
      const prompt = buildImplementPrompt(view.identity(implementer, notes.texts), {
        proposal: finals.find(({ proposer }) => proposer.id === winner)?.turn.responseText ?? "",
        decision: decision ? view.output(decision) : undefined,
      });
      return run([view.planned(implementer, decideRound + 1, "implement", prompt)], notes.ids);
    }
  }
  return done(outcome, winner);
}

// --- relay -----------------------------------------------------------------------

const RELAY_PHASE: Record<ParticipantRole, RoundtableTurnPhase> = {
  planner: "plan",
  builder: "build",
  tester: "test",
  reviewer: "review",
  judge: "contribute",
  member: "contribute",
};

function planRelay(view: SessionView): RoundtablePlan {
  const { session } = view;
  const stages = session.participants;
  if (stages.length === 0) return failed("not-enough-participants");
  const builderIndex = Math.max(
    0,
    stages.findIndex((stage) => stage.role === "builder"),
  );
  const maxRounds = Math.max(1, session.maxRounds);
  const notes = view.pendingNotes();
  let previous: RoundtableTurn | undefined;
  let lastVerdict: "approve" | "revise" | undefined;
  for (let round = 0; round < maxRounds; round += 1) {
    let sentBack = false;
    for (let index = round === 0 ? 0 : builderIndex; index < stages.length; index += 1) {
      const stage = stages[index]!;
      const phase = RELAY_PHASE[stage.role];
      const slot = view.slot(stage.id, round, phase);
      if (slot.state === "failed") return failed("turn-failed", slot.turn);
      if (slot.state === "open") {
        const previousStage = previous
          ? stages.find((candidate) => candidate.id === previous!.participantId)
          : undefined;
        const prompt = buildRelayStagePrompt(view.identity(stage, notes.texts), {
          round,
          previous:
            previous && previousStage
              ? { ...view.output(previous), role: previousStage.role }
              : undefined,
        });
        return run([view.planned(stage, round, phase, prompt)], notes.ids);
      }
      previous = slot.turn;
      if (stage.role === "reviewer") {
        lastVerdict = slot.turn.verdict === "approve" ? "approve" : "revise";
        if (lastVerdict === "revise") {
          sentBack = true;
          break;
        }
      }
    }
    if (!sentBack) {
      return done({ reason: lastVerdict === "approve" ? "approved" : "completed" });
    }
  }
  return done({ reason: "max-rounds" });
}

// --- race ----------------------------------------------------------------------

function planRace(view: SessionView): RoundtablePlan {
  const { session } = view;
  const judge = seatedJudge(session.participants);
  const racers = session.participants.filter((participant) => participant !== judge);
  const notes = view.pendingNotes();
  if (racers.length < 2) return failed("not-enough-participants");

  if (!session.experimentId) {
    const origin = view.context.origin;
    return {
      kind: "race-launch",
      prompt: buildRacePrompt({
        pattern: "race",
        roster: [],
        task: session.task,
        notes: notes.texts,
        ...(session.instructions ? { sharedInstructions: session.instructions } : {}),
        ...(origin
          ? { origin: { label: "the original conversation", text: origin.text, mention: false } }
          : {}),
      }),
      participantIds: racers.map((racer) => racer.id),
      deliverNoteIds: notes.ids,
    };
  }

  // A racer whose turn is open (stopped or interrupted by a reload) is asked again in its own thread.
  const reruns = racers.filter((racer) => view.slot(racer.id, 0, "race").state === "open");
  if (reruns.length > 0) {
    return run(
      reruns.map((racer) => {
        const prompt = buildRacePrompt({
          pattern: "race",
          roster: [],
          task: session.task,
          notes: notes.texts,
          ...(session.instructions ? { sharedInstructions: session.instructions } : {}),
          ...(racer.instructions ? { instructions: racer.instructions } : {}),
        });
        return { participantId: racer.id, round: 0, phase: "race" as const, prompt };
      }),
      notes.ids,
    );
  }
  const finished = racers
    .map((racer) => ({ racer, slot: view.slot(racer.id, 0, "race") }))
    .filter(
      (
        entry,
      ): entry is { racer: ParticipantProfile; slot: { state: "done"; turn: RoundtableTurn } } =>
        entry.slot.state === "done",
    );
  if (finished.length === 0) return failed("no-race-candidates");
  if (finished.length === 1) return done({ reason: "single-survivor" }, finished[0]!.racer.id);

  const missingReviews = finished.filter(
    ({ racer }) => view.slot(racer.id, 1, "cross-review").state === "open",
  );
  if (missingReviews.length > 0) {
    return run(
      missingReviews.map(({ racer }) =>
        view.planned(
          racer,
          1,
          "cross-review",
          buildCrossReviewPrompt(view.identity(racer, notes.texts), {
            others: finished
              .filter((entry) => entry.racer.id !== racer.id)
              .map((entry) => view.output(entry.slot.turn)),
          }),
        ),
      ),
      notes.ids,
    );
  }

  if (session.winnerParticipantId && session.outcome) {
    return done(session.outcome, session.winnerParticipantId);
  }
  const order = finished.map(({ racer }) => racer.id);
  const picks = finished.map(({ racer }) => {
    const review = view.slot(racer.id, 1, "cross-review");
    return review.state === "done" && review.turn.pickedParticipantId !== racer.id
      ? review.turn.pickedParticipantId
      : undefined;
  });
  const fallbackWinner = tallyPicks(picks, order).winner;

  if (judge && judge.brain.kind !== "agent") {
    // A judge outside the agent engine (an API model) cannot run the experiment
    // judge; it reads the candidates' answers and picks like a debate judge.
    const slot = view.slot(judge.id, 2, "decide");
    if (slot.state === "open") {
      const prompt = buildJudgePrompt(view.identity(judge, notes.texts), {
        candidates: finished.map(({ slot: entry }) => view.output(entry.turn)),
        vote: false,
        kind: "candidate",
      });
      return run([view.planned(judge, 2, "decide", prompt)], notes.ids);
    }
    if (
      slot.state === "done" &&
      slot.turn.pickedParticipantId &&
      order.includes(slot.turn.pickedParticipantId)
    ) {
      return done(
        {
          reason: "judge",
          ...(slot.turn.responseText ? { rationale: slot.turn.responseText } : {}),
        },
        slot.turn.pickedParticipantId,
      );
    }
    return done({ reason: "vote" }, fallbackWinner);
  }
  return {
    kind: "race-crown",
    ...(judge ? { judgeParticipantId: judge.id } : {}),
    ...(fallbackWinner ? { fallbackWinnerParticipantId: fallbackWinner } : {}),
  };
}

// --- open group chat -----------------------------------------------------------

/**
 * The group conversation in time order: user notes and finished replies.
 * `uptoNoteId`: leave out the messages posted after that note (and replies to
 * them), so a reply to it never sees a later question.
 */
export function groupTranscript(session: RoundtableSession, uptoNoteId?: string): ChatMessage[] {
  const labels = uniqueLabels(session.participants);
  const notes = session.notes ?? [];
  const cut = uptoNoteId === undefined ? -1 : notes.findIndex((note) => note.id === uptoNoteId);
  const later = new Set(cut < 0 ? [] : notes.slice(cut + 1).map((note) => note.id));
  const entries: Array<{ at: number; order: number; message: ChatMessage }> = [];
  notes.forEach((note, index) => {
    if (later.has(note.id)) return;
    entries.push({ at: note.createdAt, order: index, message: { name: "User", text: note.text } });
  });
  session.turns.forEach((turn, index) => {
    if (turn.phase !== "reply" || turn.status !== "done") return;
    if (turn.noteId !== undefined && later.has(turn.noteId)) return;
    entries.push({
      at: turn.endedAt ?? turn.startedAt ?? 0,
      order: 100_000 + index,
      message: {
        name: labels.get(turn.participantId) ?? turn.participantId,
        text: turn.responseText ?? "",
      },
    });
  });
  return entries
    .toSorted((left, right) => left.at - right.at || left.order - right.order)
    .map((entry) => entry.message);
}

function planOpen(view: SessionView): RoundtablePlan {
  const { session } = view;
  const byId = new Map(session.participants.map((participant) => [participant.id, participant]));
  for (const note of session.notes ?? []) {
    // The user stopped the replies to this message.
    if (note.halted) continue;
    // Participants added later never answer (or react to) earlier messages.
    const seated = session.participants.filter(
      (participant) => participant.joinedAt === undefined || participant.joinedAt <= note.createdAt,
    );
    const candidates = seated.map((participant) => view.candidate(participant));
    const mentioned = [...new Set(note.mentions ?? [])].filter((id) => byId.has(id));
    let targets = mentioned.length > 0 ? mentioned : seated.map((participant) => participant.id);
    let mentionedBy = new Map<string, QuotedOutput[]>();
    for (let round = 0; round <= OPEN_REACTION_ROUNDS && targets.length > 0; round += 1) {
      const replies: RoundtableTurn[] = [];
      for (const participantId of targets) {
        const slot = view.slot(participantId, round, "reply", note.id);
        if (slot.state === "open") {
          const participant = byId.get(participantId)!;
          const prompt = buildOpenReplyPrompt(view.identity(participant), {
            transcript: groupTranscript(session, note.id).slice(-OPEN_TRANSCRIPT_MESSAGES),
            userMessage: note.text,
            ...(round > 0 ? { mentionedBy: mentionedBy.get(participantId) ?? [] } : {}),
          });
          // Replies go one at a time, so each speaker sees the replies before it.
          return run([view.planned(participant, round, "reply", prompt, note.id)]);
        }
        if (slot.state === "done") replies.push(slot.turn);
      }
      const next = new Map<string, QuotedOutput[]>();
      for (const reply of replies) {
        for (const id of findMentions(reply.responseText ?? "", candidates)) {
          if (id === reply.participantId) continue;
          next.set(id, [...(next.get(id) ?? []), view.output(reply)]);
        }
      }
      mentionedBy = next;
      targets = seated.map((participant) => participant.id).filter((id) => next.has(id));
    }
  }
  return { kind: "idle" };
}

// --- compare -------------------------------------------------------------------

/**
 * Everyone answers the task once, at the same time and without seeing the
 * others; no critique, no verdict. Done once every answer is in (a failed
 * answer is marked on its turn); failed only when nobody answered.
 */
function planCompare(view: SessionView): RoundtablePlan {
  const { session } = view;
  if (session.participants.length === 0) return failed("not-enough-participants");
  const notes = view.pendingNotes();
  const missing = session.participants.filter(
    (participant) => view.slot(participant.id, 0, "answer").state === "open",
  );
  if (missing.length > 0) {
    return run(
      missing.map((participant) =>
        view.planned(
          participant,
          0,
          "answer",
          buildCompareAnswerPrompt(view.identity(participant, notes.texts)),
        ),
      ),
      notes.ids,
    );
  }
  let answered = 0;
  let lastFailure: RoundtableTurn | undefined;
  for (const participant of session.participants) {
    const slot = view.slot(participant.id, 0, "answer");
    if (slot.state === "done") answered += 1;
    else if (slot.state === "failed") lastFailure = slot.turn;
  }
  if (answered === 0) return failed("turn-failed", lastFailure);
  return done({ reason: "compared" });
}

// --- entry -----------------------------------------------------------------------

export function planNextStep(
  session: RoundtableSession,
  context: PlannerContext = {},
): RoundtablePlan {
  const view = new SessionView(session, context);
  switch (session.pattern) {
    case "build-review":
      return planBuildReview(view);
    case "debate":
      return planDebate(view);
    case "relay":
      return planRelay(view);
    case "race":
      return planRace(view);
    case "open":
      return planOpen(view);
    case "compare":
      return planCompare(view);
  }
}

/**
 * Reads the machine-readable part of a finished turn: reviewer verdicts and
 * picks. Pick candidates are the participants the prompt offered.
 */
export function interpretTurn(
  session: RoundtableSession,
  turn: Pick<RoundtableTurn, "participantId" | "phase">,
  text: string,
): Pick<RoundtableTurn, "verdict" | "pickedParticipantId"> {
  if (turn.phase === "review") {
    const verdict = parseVerdict(text);
    return verdict ? { verdict } : {};
  }
  if (turn.phase === "decide" || turn.phase === "cross-review") {
    const labels = uniqueLabels(session.participants);
    const judge = seatedJudge(session.participants);
    const candidates = session.participants
      .filter((participant) => participant.id !== turn.participantId && participant !== judge)
      .map((participant) => ({
        id: participant.id,
        label: labels.get(participant.id) ?? participant.id,
      }));
    const picked = parsePick(text, candidates);
    return picked ? { verdict: "pick", pickedParticipantId: picked } : {};
  }
  return {};
}
