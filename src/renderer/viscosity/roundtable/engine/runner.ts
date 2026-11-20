/**
 * ViscosityCode Roundtable engine: the side-effect runner.
 *
 * One loop per running session: ask the pure planner what is next, perform it
 * (send turns through participant drivers, launch or crown a race), record
 * the results, repeat. Everything it needs from the outside comes through
 * {@link RunnerDeps}, so the state machine can be exercised with fake drivers.
 *
 * Controls:
 * - pause: the running turns finish, then the loop waits;
 * - resume: a paused session continues; a failed one retries its failed turns;
 * - stop: running turns are interrupted and the session ends;
 * - interrupt (open pattern, "Stop replies"): running turns are interrupted,
 *   nobody else answers the messages so far, and the chat stays open;
 * - post: a user message — open pattern: who should reply (a stopped chat
 *   reopens); others: steering added to the next participant's prompt.
 *
 * A participant waiting for a permission or an answer shows as
 * "waiting-approval" and holds the Roundtable until the user answers in the
 * participant's own thread. Nothing is ever approved automatically.
 */
import { msg } from "@lingui/core/macro";
import { i18n } from "@/renderer/i18n/i18n";
import type {
  ParticipantDriver,
  ParticipantProfile,
  RoundtableNote,
  RoundtableSession,
  RoundtableTurn,
  TurnResult,
  TurnStatus,
} from "../types";
import { clearLiveTurnText, clearSessionLiveText, setLiveTurnText } from "./liveText";
import {
  interpretTurn,
  planNextStep,
  type PlannedTurn,
  type PlannerContext,
  type RoundtablePlan,
} from "./planner";

export interface RoundtableRepo {
  get(sessionId: string): RoundtableSession | undefined;
  update(sessionId: string, update: (session: RoundtableSession) => RoundtableSession): void;
}

export interface RaceAdapter {
  /** Launches the race through the Agent Experiments engine; maps participant → candidate thread. */
  launch(
    session: RoundtableSession,
    input: { prompt: string; participants: ParticipantProfile[] },
  ): Promise<{ experimentId: string; threadIds: Record<string, string> }>;
  /** Crowns the experiment (its judge); `undefined` when no crown was made. */
  crown(
    session: RoundtableSession,
    judge: ParticipantProfile | undefined,
  ): Promise<{ winnerThreadId: string; rationale?: string } | undefined>;
}

export interface RunnerDeps {
  repo: RoundtableRepo;
  createDriver(profile: ParticipantProfile, session: RoundtableSession): ParticipantDriver;
  race: RaceAdapter;
  /** The origin thread's latest answer (and whether participants can read the thread itself). */
  readOriginContext(session: RoundtableSession): Promise<PlannerContext["origin"] | undefined>;
  describeError(error: unknown): string;
  newId(): string;
  now(): number;
}

interface ActiveRun {
  drivers: Map<string, ParticipantDriver>;
  /** Turn id → driver, for the turns in flight. */
  inFlight: Map<string, ParticipantDriver>;
  loop: Promise<void> | undefined;
  kickPending: boolean;
  /** `null`: looked up, none. */
  origin: PlannerContext["origin"] | null | undefined;
}

const UNSETTLED: readonly TurnStatus[] = ["pending", "running", "waiting-approval"];
/** Safety net against a planner/driver pair that makes no progress. */
const MAX_LOOP_STEPS = 1_000;

function isUnsettled(turn: RoundtableTurn): boolean {
  return UNSETTLED.includes(turn.status);
}

/** The `notes` patch marking `noteIds` as carried by `turnId` (empty when nothing changes). */
function deliverNotes(
  notes: RoundtableNote[] | undefined,
  noteIds: readonly string[],
  turnId: string | undefined,
): { notes?: RoundtableNote[] } {
  if (!notes || noteIds.length === 0 || !turnId) return {};
  return {
    notes: notes.map((note) =>
      noteIds.includes(note.id) && !note.deliveredTurnId
        ? { ...note, deliveredTurnId: turnId }
        : note,
    ),
  };
}

/** Every note marked halted (nobody else answers them). */
function haltNotes(notes: RoundtableNote[] | undefined): RoundtableNote[] {
  return (notes ?? []).map((note) => (note.halted ? note : { ...note, halted: true as const }));
}

export class RoundtableRunner {
  private readonly runs = new Map<string, ActiveRun>();
  /** Saved sessions a reload has not resumed yet (`holdForReload`): kicks wait for the resume. */
  private readonly held = new Set<string>();
  /** Held open chats whose replies were stopped meanwhile: stopped once attached. */
  private readonly stopOnAttach = new Set<string>();

  constructor(private readonly deps: RunnerDeps) {}

  /** Starts (or nudges) the loop of a running session. Resolves when the loop goes idle. */
  kick(sessionId: string): Promise<void> {
    // `resumeAfterReload` kicks it with whatever happened meanwhile.
    if (this.held.has(sessionId)) return Promise.resolve();
    const run = this.ensureRun(sessionId);
    if (run.loop) {
      run.kickPending = true;
      return run.loop;
    }
    const loop = this.loop(sessionId, run)
      .catch((error: unknown) => {
        console.error("[roundtable] orchestration failed", error);
        this.deps.repo.update(sessionId, (session) =>
          session.status === "running"
            ? { ...session, status: "failed", error: this.deps.describeError(error) }
            : session,
        );
      })
      .finally(() => {
        run.loop = undefined;
        if (this.isTerminal(sessionId)) this.release(sessionId);
        else if (run.kickPending) {
          run.kickPending = false;
          void this.kick(sessionId);
        }
      });
    run.loop = loop;
    return loop;
  }

  /** Whether a loop is active for the session (tests and the dev hook). */
  isActive(sessionId: string): boolean {
    return this.runs.get(sessionId)?.loop !== undefined;
  }

  pause(sessionId: string): void {
    this.deps.repo.update(sessionId, (session) =>
      session.status === "running" ? { ...session, status: "paused" } : session,
    );
  }

  resume(sessionId: string): void {
    const session = this.deps.repo.get(sessionId);
    if (!session || (session.status !== "paused" && session.status !== "failed")) return;
    this.deps.repo.update(sessionId, (current) => {
      const { error: _error, ...rest } = current;
      return {
        ...rest,
        status: "running",
        // Retrying a failed session re-runs its failed turns.
        turns:
          current.status === "failed"
            ? current.turns.map((turn) =>
                turn.status === "failed" ? { ...turn, status: "stopped" as const } : turn,
              )
            : current.turns,
      };
    });
    void this.kick(sessionId);
  }

  async stop(sessionId: string): Promise<void> {
    const run = this.runs.get(sessionId);
    this.deps.repo.update(sessionId, (session) => {
      if (
        session.status === "done" ||
        session.status === "failed" ||
        session.status === "stopped"
      ) {
        return session;
      }
      const now = this.deps.now();
      return {
        ...session,
        status: "stopped",
        turns: session.turns.map((turn) =>
          isUnsettled(turn) ? { ...turn, status: "stopped" as const, endedAt: now } : turn,
        ),
      };
    });
    if (run) {
      await Promise.all(
        [...run.inFlight.values()].map((driver) =>
          driver.stop().catch((error: unknown) => {
            console.warn("[roundtable] could not stop a participant", error);
          }),
        ),
      );
      // A message may have reopened the chat (a new run) while the drivers were stopping.
      if (!run.loop && this.runs.get(sessionId) === run && this.isTerminal(sessionId)) {
        this.release(sessionId);
      }
    }
  }

  /**
   * Open pattern ("Stop replies"): interrupts the running replies and marks
   * every message so far as halted, so nobody else answers them. The chat
   * stays running and the next message is answered as usual.
   */
  async interrupt(sessionId: string): Promise<void> {
    const session = this.deps.repo.get(sessionId);
    if (!session || session.pattern !== "open" || session.status !== "running") return;
    this.deps.repo.update(sessionId, (current) => ({
      ...current,
      notes: haltNotes(current.notes),
    }));
    if (this.held.has(sessionId)) {
      // The replies of the previous window are not attached yet.
      this.stopOnAttach.add(sessionId);
      return;
    }
    const run = this.runs.get(sessionId);
    if (!run) return;
    await Promise.all(
      [...run.inFlight.values()].map((driver) =>
        driver.stop().catch((error: unknown) => {
          console.warn("[roundtable] could not stop a participant", error);
        }),
      ),
    );
  }

  /** Forgets a session's runtime state (drivers are disposed; threads are left alone). */
  release(sessionId: string): void {
    const run = this.runs.get(sessionId);
    if (!run) return;
    this.runs.delete(sessionId);
    for (const driver of run.drivers.values()) driver.dispose();
    clearSessionLiveText(sessionId);
  }

  post(sessionId: string, text: string, mentions: readonly string[] | undefined): void {
    const session = this.deps.repo.get(sessionId);
    if (!session) return;
    const valid = (mentions ?? []).filter((id) =>
      session.participants.some((participant) => participant.id === id),
    );
    const note: RoundtableNote = {
      id: this.deps.newId(),
      text,
      ...(valid.length > 0 ? { mentions: valid } : {}),
      createdAt: this.deps.now(),
    };
    // A stopped open chat continues; what was cut off by the stop stays unanswered.
    const reopen = session.pattern === "open" && session.status === "stopped";
    this.deps.repo.update(sessionId, (current) =>
      reopen && current.status === "stopped"
        ? { ...current, status: "running", notes: [...haltNotes(current.notes), note] }
        : { ...current, notes: [...(current.notes ?? []), note] },
    );
    if (session.status === "running" || reopen) void this.kick(sessionId);
  }

  /**
   * After a reload, until `resumeAfterReload` gets them: kicks for these
   * sessions (a message, a Resume) wait, and "Stop replies" stops the
   * replies of the previous window once they are attached.
   */
  holdForReload(sessionIds: readonly string[]): void {
    for (const sessionId of sessionIds) this.held.add(sessionId);
  }

  /**
   * After a reload: running sessions continue; paused ones only settle the
   * turns that were in flight (the loop settles first, then stops because the
   * session is paused; a Resume meanwhile waits for that settle instead of
   * sending the in-flight turns again).
   */
  resumeAfterReload(sessions: readonly RoundtableSession[]): void {
    for (const session of sessions) {
      this.held.delete(session.id);
      if (
        session.status === "running" ||
        (session.status === "paused" && session.turns.some(isUnsettled))
      ) {
        void this.kick(session.id);
      }
    }
  }

  private isTerminal(sessionId: string): boolean {
    const status = this.deps.repo.get(sessionId)?.status;
    return status === undefined || status === "done" || status === "failed" || status === "stopped";
  }

  private ensureRun(sessionId: string): ActiveRun {
    let run = this.runs.get(sessionId);
    if (!run) {
      run = {
        drivers: new Map(),
        inFlight: new Map(),
        loop: undefined,
        kickPending: false,
        origin: undefined,
      };
      this.runs.set(sessionId, run);
    }
    return run;
  }

  private driverFor(run: ActiveRun, profile: ParticipantProfile, session: RoundtableSession) {
    let driver = run.drivers.get(profile.id);
    if (!driver) {
      driver = this.deps.createDriver(profile, session);
      run.drivers.set(profile.id, driver);
    }
    return driver;
  }

  private async loop(sessionId: string, run: ActiveRun): Promise<void> {
    await this.settleInFlight(sessionId, run);
    for (let step = 0; step < MAX_LOOP_STEPS; step += 1) {
      run.kickPending = false;
      let session = this.deps.repo.get(sessionId);
      if (!session || session.status !== "running") return;
      if (run.origin === undefined) {
        run.origin = (await this.deps.readOriginContext(session).catch(() => undefined)) ?? null;
        session = this.deps.repo.get(sessionId);
        if (!session || session.status !== "running") return;
      }
      const plan = planNextStep(session, run.origin ? { origin: run.origin } : {});
      switch (plan.kind) {
        case "idle":
          return;
        case "finish":
          this.finish(sessionId, plan);
          return;
        case "run":
          await this.runBatch(sessionId, run, plan.turns, plan.deliverNoteIds);
          break;
        case "race-launch":
          await this.launchRace(sessionId, run, plan);
          break;
        case "race-crown":
          await this.crownRace(sessionId, plan);
          break;
      }
    }
    throw new Error(i18n._(msg`The Roundtable stopped making progress.`));
  }

  private finish(sessionId: string, plan: Extract<RoundtablePlan, { kind: "finish" }>): void {
    this.deps.repo.update(sessionId, (session) => {
      if (session.status !== "running") return session;
      if (plan.status === "done") {
        return {
          ...session,
          status: "done",
          outcome: plan.outcome,
          ...(plan.winnerParticipantId ? { winnerParticipantId: plan.winnerParticipantId } : {}),
        };
      }
      const turn = plan.turnId
        ? session.turns.find((candidate) => candidate.id === plan.turnId)
        : undefined;
      const error =
        turn?.error ??
        (plan.reason === "no-race-candidates"
          ? i18n._(msg`No race candidate finished its work.`)
          : plan.reason === "not-enough-participants"
            ? i18n._(msg`Not enough participants are left to continue.`)
            : i18n._(msg`A participant's turn failed.`));
      return { ...session, status: "failed", error };
    });
  }

  private async runBatch(
    sessionId: string,
    run: ActiveRun,
    planned: readonly PlannedTurn[],
    deliverNoteIds: readonly string[],
  ): Promise<void> {
    const now = this.deps.now();
    const turns: RoundtableTurn[] = planned.map((plan) => ({
      id: this.deps.newId(),
      participantId: plan.participantId,
      round: plan.round,
      phase: plan.phase,
      prompt: plan.prompt,
      status: "running",
      startedAt: now,
      // Cleared once the prompt goes out (`onSent`): a reload before that re-sends it.
      unsent: true,
      ...(plan.noteId ? { noteId: plan.noteId } : {}),
    }));
    this.deps.repo.update(sessionId, (session) => ({
      ...session,
      turns: [...session.turns, ...turns],
      ...deliverNotes(session.notes, deliverNoteIds, turns[0]?.id),
    }));
    await Promise.all(
      turns.map((turn, index) => this.runTurn(sessionId, run, turn, planned[index]!, "send")),
    );
  }

  private async runTurn(
    sessionId: string,
    run: ActiveRun,
    turn: RoundtableTurn,
    plan: Pick<PlannedTurn, "prompt" | "contextThreadIds">,
    mode: "send" | "await",
  ): Promise<void> {
    const session = this.deps.repo.get(sessionId);
    if (!session) return;
    const profile = session.participants.find(
      (participant) => participant.id === turn.participantId,
    );
    let result: TurnResult;
    let driver: ParticipantDriver | undefined;
    try {
      if (!profile) throw new Error(i18n._(msg`This participant left the Roundtable.`));
      driver = this.driverFor(run, profile, session);
      run.inFlight.set(turn.id, driver);
      const onProgress = (text: string) => setLiveTurnText(sessionId, turn.id, text);
      const options = {
        onAttention: (waiting: boolean) => this.markAttention(sessionId, turn.id, waiting),
        onSent: () => this.markSent(sessionId, turn.id),
        ...(plan.contextThreadIds ? { contextThreadIds: plan.contextThreadIds } : {}),
      };
      if (mode === "await") {
        result = driver.awaitCurrentTurn
          ? await driver.awaitCurrentTurn(onProgress, options)
          : { status: "stopped", text: "" };
      } else {
        result = await driver.sendTurn(plan.prompt, onProgress, options);
      }
    } catch (error) {
      result = { status: "failed", text: "", error: this.deps.describeError(error) };
    } finally {
      run.inFlight.delete(turn.id);
      clearLiveTurnText(sessionId, turn.id);
    }
    this.record(sessionId, turn, result, driver?.threadId());
  }

  private markAttention(sessionId: string, turnId: string, waiting: boolean): void {
    this.deps.repo.update(sessionId, (session) => {
      const turn = session.turns.find((candidate) => candidate.id === turnId);
      if (!turn || !isUnsettled(turn)) return session;
      const status: TurnStatus = waiting ? "waiting-approval" : "running";
      if (turn.status === status) return session;
      return {
        ...session,
        turns: session.turns.map((candidate) =>
          candidate.id === turnId ? { ...candidate, status } : candidate,
        ),
      };
    });
  }

  private markSent(sessionId: string, turnId: string): void {
    this.deps.repo.update(sessionId, (session) =>
      session.turns.some((turn) => turn.id === turnId && turn.unsent)
        ? {
            ...session,
            turns: session.turns.map((turn) => {
              if (turn.id !== turnId) return turn;
              const { unsent: _unsent, ...sent } = turn;
              return sent;
            }),
          }
        : session,
    );
  }

  private record(
    sessionId: string,
    turn: RoundtableTurn,
    result: TurnResult,
    threadId: string | undefined,
  ): void {
    this.deps.repo.update(sessionId, (session) => {
      const current = session.turns.find((candidate) => candidate.id === turn.id);
      if (!current) return session;
      const status = result.status;
      const interpretation = status === "done" ? interpretTurn(session, current, result.text) : {};
      const { unsent: _unsent, ...settled } = current;
      const next: RoundtableTurn = {
        ...settled,
        status,
        endedAt: this.deps.now(),
        ...(result.text ? { responseText: result.text } : {}),
        ...interpretation,
        ...(result.error ? { error: result.error } : {}),
      };
      return {
        ...session,
        turns: session.turns.map((candidate) => (candidate.id === turn.id ? next : candidate)),
        threadIds:
          threadId && session.threadIds[turn.participantId] !== threadId
            ? { ...session.threadIds, [turn.participantId]: threadId }
            : session.threadIds,
      };
    });
  }

  /**
   * Turns left in flight by a previous window (or just launched by a race):
   * wait for them through their driver, or mark them stopped so the planner
   * runs them again.
   */
  private async settleInFlight(sessionId: string, run: ActiveRun): Promise<void> {
    const stopAttached = this.stopOnAttach.delete(sessionId);
    const session = this.deps.repo.get(sessionId);
    if (!session) return;
    const stale = session.turns.filter((turn) => isUnsettled(turn) && !run.inFlight.has(turn.id));
    if (stale.length === 0) return;
    // Attach only to a prompt that went out: an unsent turn's thread still
    // shows the answer to an earlier turn.
    const attachable = stale.filter(
      (turn) => !turn.unsent && session.threadIds[turn.participantId] !== undefined,
    );
    const orphaned = new Set(
      stale.filter((turn) => !attachable.includes(turn)).map((turn) => turn.id),
    );
    if (orphaned.size > 0) {
      // Never sent (no thread yet, or not submitted): the planner sends them again.
      const now = this.deps.now();
      this.deps.repo.update(sessionId, (current) => ({
        ...current,
        turns: current.turns.map((turn) => {
          if (!orphaned.has(turn.id)) return turn;
          const { unsent: _unsent, ...settled } = turn;
          return { ...settled, status: "stopped" as const, endedAt: now };
        }),
      }));
    }
    // Attaching registers the drivers synchronously.
    const settling = Promise.all(
      attachable.map((turn) =>
        this.runTurn(sessionId, run, turn, { prompt: turn.prompt }, "await"),
      ),
    );
    if (stopAttached) {
      const attached = attachable.flatMap((turn) => run.inFlight.get(turn.id) ?? []);
      await Promise.all(
        attached.map((driver) =>
          driver.stop().catch((error: unknown) => {
            console.warn("[roundtable] could not stop a participant", error);
          }),
        ),
      );
    }
    await settling;
  }

  private async launchRace(
    sessionId: string,
    run: ActiveRun,
    plan: Extract<RoundtablePlan, { kind: "race-launch" }>,
  ): Promise<void> {
    const session = this.deps.repo.get(sessionId);
    if (!session) return;
    const participants = plan.participantIds
      .map((id) => session.participants.find((participant) => participant.id === id))
      .filter((participant): participant is ParticipantProfile => participant !== undefined);
    if (participants.some((participant) => participant.brain.kind !== "agent")) {
      this.fail(sessionId, i18n._(msg`Every racer must be an installed agent.`));
      return;
    }
    let launched: { experimentId: string; threadIds: Record<string, string> };
    try {
      launched = await this.deps.race.launch(session, { prompt: plan.prompt, participants });
    } catch (error) {
      this.fail(sessionId, this.deps.describeError(error));
      return;
    }
    const now = this.deps.now();
    const turns: RoundtableTurn[] = participants.map((participant) => {
      const bound = launched.threadIds[participant.id] !== undefined;
      return {
        id: this.deps.newId(),
        participantId: participant.id,
        round: 0,
        phase: "race",
        prompt: plan.prompt,
        status: bound ? "running" : "failed",
        startedAt: now,
        ...(bound ? {} : { endedAt: now, error: i18n._(msg`This racer could not be started.`) }),
      };
    });
    // One update: the experiment, its threads and the running turns land together,
    // so a reload waits for the candidates instead of prompting them again.
    this.deps.repo.update(sessionId, (current) => ({
      ...current,
      experimentId: launched.experimentId,
      threadIds: { ...current.threadIds, ...launched.threadIds },
      turns: [...current.turns, ...turns],
      ...deliverNotes(current.notes, plan.deliverNoteIds, turns[0]?.id),
    }));
    // Attaching registers the racers' drivers synchronously.
    const settling = this.settleInFlight(sessionId, run);
    if (this.deps.repo.get(sessionId)?.status === "stopped") {
      // Stopped while the race was launching: the racers just started, so
      // interrupt them now instead of letting them run on.
      await Promise.all(
        [...run.inFlight.values()].map((driver) =>
          driver.stop().catch((error: unknown) => {
            console.warn("[roundtable] could not stop a racer", error);
          }),
        ),
      );
    }
    await settling;
  }

  private async crownRace(
    sessionId: string,
    plan: Extract<RoundtablePlan, { kind: "race-crown" }>,
  ): Promise<void> {
    const session = this.deps.repo.get(sessionId);
    if (!session) return;
    const judge = plan.judgeParticipantId
      ? session.participants.find((participant) => participant.id === plan.judgeParticipantId)
      : undefined;
    let crown: { winnerThreadId: string; rationale?: string } | undefined;
    try {
      crown = await this.deps.race.crown(session, judge);
    } catch (error) {
      console.warn("[roundtable] the race judge failed; using the cross-review votes", error);
    }
    const crowned = crown
      ? Object.entries(session.threadIds).find(
          ([, threadId]) => threadId === crown.winnerThreadId,
        )?.[0]
      : undefined;
    this.deps.repo.update(sessionId, (current) => {
      if (current.status !== "running") return current;
      if (crowned) {
        return {
          ...current,
          winnerParticipantId: crowned,
          outcome: { reason: "crown", ...(crown?.rationale ? { rationale: crown.rationale } : {}) },
        };
      }
      if (plan.fallbackWinnerParticipantId) {
        return {
          ...current,
          winnerParticipantId: plan.fallbackWinnerParticipantId,
          outcome: { reason: "vote" },
        };
      }
      return { ...current, status: "failed", error: i18n._(msg`No winner could be chosen.`) };
    });
  }

  private fail(sessionId: string, error: string): void {
    this.deps.repo.update(sessionId, (session) =>
      session.status === "running" ? { ...session, status: "failed", error } : session,
    );
  }
}
