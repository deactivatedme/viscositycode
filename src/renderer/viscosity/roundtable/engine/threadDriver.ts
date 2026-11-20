/**
 * ViscosityCode Roundtable engine: `ThreadParticipantDriver`, the
 * `ParticipantDriver` for agent brains (any installed provider, on the user's
 * own login). It follows the PR Ask side-chat pattern through
 * {@link ThreadEnginePort}:
 *
 * - first turn: create the thread without focus (grouped under the session)
 *   and launch it with the prompt;
 * - later turns: wait until the thread is idle — never send while it is
 *   working or launching — then submit the follow-up;
 * - turn end: the thread is no longer turn-active, no background workflow,
 *   task or sub-agent is running, and that stays true for a short settle time;
 * - result: the final assistant text since the last user message (terminal
 *   threads: the scrollback without ANSI); failures from the error status,
 *   an interrupted turn or an error item;
 * - approvals and questions stay with the user: the driver only reports
 *   "waiting" so the Roundtable can show attention.
 *
 * The thread keeps its provider's default approval and sandbox settings; the
 * model comes from the participant's brain.
 */
import { msg } from "@lingui/core/macro";
import { isThreadTurnActive, type PromptSegment } from "@/shared/contracts";
import { i18n } from "@/renderer/i18n/i18n";
import type {
  ParticipantDriver,
  ParticipantProfile,
  RoundtableSession,
  SendTurnOptions,
  TurnProgressListener,
  TurnResult,
} from "../types";
import {
  DEFAULT_DRIVER_TIMING,
  type DriverTiming,
  type ThreadEnginePort,
  type ThreadTurnSnapshot,
} from "./threadPort";

export interface ThreadDriverBindings {
  /** The thread already bound to this participant (origin, race candidate, reload). */
  lookupThreadId(): string | undefined;
  /** Records a newly created thread on the session. */
  recordThreadId(threadId: string): void;
}

interface ActiveTurn {
  stopRequested: boolean;
  /** The prompt went out (or the turn was adopted): the thread's running turn is ours. */
  sent: boolean;
  /** Resolves a pending idle wait or watch early (stop / dispose). */
  wake: (() => void) | undefined;
}

function isWaitingForUser(snapshot: ThreadTurnSnapshot): boolean {
  return snapshot.status === "needs_approval" || snapshot.status === "needs_reply";
}

function hasEnded(snapshot: ThreadTurnSnapshot): boolean {
  return !isThreadTurnActive(snapshot.status) && !snapshot.busyInBackground;
}

export class ThreadParticipantDriver implements ParticipantDriver {
  readonly participantId: string;
  private boundThreadId: string | undefined;
  private releaseReader: (() => void) | undefined;
  private active: ActiveTurn | undefined;
  private disposed = false;

  constructor(
    private readonly profile: ParticipantProfile,
    private readonly session: RoundtableSession,
    private readonly port: ThreadEnginePort,
    private readonly bindings: ThreadDriverBindings,
    private readonly timing: DriverTiming = DEFAULT_DRIVER_TIMING,
  ) {
    this.participantId = profile.id;
  }

  threadId(): string | undefined {
    return this.boundThreadId ?? this.bindings.lookupThreadId();
  }

  async ensureStarted(): Promise<void> {
    // The thread is created by the first turn (its launch needs the prompt).
    const threadId = this.threadId();
    if (threadId) this.boundThreadId = threadId;
  }

  async sendTurn(
    prompt: string,
    onProgress?: TurnProgressListener,
    options?: SendTurnOptions,
  ): Promise<TurnResult> {
    if (this.disposed) return this.failure(i18n._(msg`This participant was closed.`));
    if (this.active) return this.failure(i18n._(msg`This participant is still answering.`));
    const brain = this.profile.brain;
    if (brain.kind !== "agent") {
      return this.failure(i18n._(msg`This participant is not an agent thread.`));
    }
    const turn: ActiveTurn = { stopRequested: false, sent: false, wake: undefined };
    this.active = turn;
    try {
      const contextIds = options?.contextThreadIds ?? [];
      let threadId = this.threadId();
      let fresh = false;
      if (!threadId) {
        const mention = contextIds.length > 0 && this.port.readThreadToolEnabled();
        turn.sent = true;
        options?.onSent?.();
        threadId = await this.port.createAndLaunch(
          {
            session: this.session,
            profile: this.profile,
            brain,
            prompt,
            ...(mention
              ? { segments: this.segments(prompt, contextIds), mentionHandoff: true }
              : {}),
          },
          (createdId) => {
            this.bind(createdId);
            this.bindings.recordThreadId(createdId);
          },
        );
        this.bind(threadId);
        fresh = true;
      } else {
        this.bind(threadId);
        const idle = await this.waitUntilIdle(threadId, turn);
        if (turn.stopRequested) return { status: "stopped", text: "" };
        if (!idle)
          return this.failure(i18n._(msg`The participant's thread is no longer available.`));
        const mention =
          contextIds.length > 0 && this.port.snapshot(threadId)?.mentionToolsAvailable === true;
        turn.sent = true;
        options?.onSent?.();
        await this.port.submit(
          threadId,
          prompt,
          mention ? this.segments(prompt, contextIds) : undefined,
        );
      }
      return await this.watch(threadId, turn, onProgress, options, fresh ? "launch" : "submit");
    } catch (error) {
      if (turn.stopRequested) return { status: "stopped", text: "" };
      return this.failure(this.port.describeError(error));
    } finally {
      this.finishTurn(turn);
    }
  }

  async awaitCurrentTurn(
    onProgress?: TurnProgressListener,
    options?: SendTurnOptions,
  ): Promise<TurnResult> {
    const threadId = this.threadId();
    if (!threadId) return { status: "stopped", text: "" };
    if (this.active) return this.failure(i18n._(msg`This participant is still answering.`));
    const turn: ActiveTurn = { stopRequested: false, sent: true, wake: undefined };
    this.active = turn;
    try {
      this.bind(threadId);
      return await this.watch(threadId, turn, onProgress, options, "attach");
    } finally {
      this.finishTurn(turn);
    }
  }

  async stop(): Promise<void> {
    const turn = this.active;
    if (!turn) return;
    turn.stopRequested = true;
    const threadId = this.threadId();
    const snapshot = threadId ? this.port.snapshot(threadId) : undefined;
    // Only interrupt our own turn: while the driver still waits for a busy
    // thread, that thread's running turn belongs to the user.
    if (turn.sent && threadId && snapshot && isThreadTurnActive(snapshot.status)) {
      try {
        await this.port.interrupt(threadId);
      } catch (error) {
        console.warn("[roundtable] could not interrupt a participant", error);
      }
    } else {
      // Not running yet (waiting for idle): end the wait now.
      turn.wake?.();
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.active) {
      this.active.stopRequested = true;
      this.active.wake?.();
    }
    this.releaseReader?.();
    this.releaseReader = undefined;
  }

  private failure(error: string): TurnResult {
    return { status: "failed", text: "", error };
  }

  private bind(threadId: string): void {
    if (this.boundThreadId === threadId && this.releaseReader) return;
    this.releaseReader?.();
    this.boundThreadId = threadId;
    this.releaseReader = this.disposed ? undefined : this.port.retainReader(threadId);
  }

  private finishTurn(turn: ActiveTurn): void {
    if (this.active === turn) this.active = undefined;
    // The reader is only held while a turn runs.
    this.releaseReader?.();
    this.releaseReader = undefined;
  }

  private segments(prompt: string, contextIds: readonly string[]): PromptSegment[] {
    return [
      { kind: "text", content: prompt },
      ...contextIds.map((threadId): PromptSegment => ({
        kind: "thread",
        threadId,
        title: this.port.threadTitle(threadId) ?? "",
      })),
    ];
  }

  /** Resolves `true` once the thread is idle, `false` when it disappeared or the turn was stopped. */
  private waitUntilIdle(threadId: string, turn: ActiveTurn): Promise<boolean> {
    return new Promise((resolve) => {
      let unsubscribe: (() => void) | undefined;
      let settled = false;
      const finish = (value: boolean) => {
        if (settled) return;
        settled = true;
        unsubscribe?.();
        turn.wake = undefined;
        resolve(value);
      };
      const check = () => {
        if (turn.stopRequested || this.disposed) return finish(false);
        const snapshot = this.port.snapshot(threadId);
        if (!snapshot) return finish(false);
        if (!isThreadTurnActive(snapshot.status)) finish(true);
      };
      turn.wake = () => finish(false);
      unsubscribe = this.port.subscribe(threadId, check);
      check();
    });
  }

  private watch(
    threadId: string,
    turn: ActiveTurn,
    onProgress: TurnProgressListener | undefined,
    options: SendTurnOptions | undefined,
    mode: "launch" | "submit" | "attach",
  ): Promise<TurnResult> {
    return new Promise((resolve) => {
      const startedAt = Date.now();
      const presentation = this.port.snapshot(threadId)?.presentationMode ?? "gui";
      const graceMs = mode === "attach" ? 0 : this.timing.startGraceMs[presentation];
      let sawActive = false;
      let waiting = false;
      let finished = false;
      let settleTimer: ReturnType<typeof setTimeout> | undefined;
      let graceTimer: ReturnType<typeof setTimeout> | undefined;
      let progressTimer: ReturnType<typeof setInterval> | undefined;
      let lastProgress = "";
      let unsubscribe: () => void = () => {};

      const cleanup = () => {
        finished = true;
        unsubscribe();
        if (settleTimer !== undefined) clearTimeout(settleTimer);
        if (graceTimer !== undefined) clearTimeout(graceTimer);
        if (progressTimer !== undefined) clearInterval(progressTimer);
        turn.wake = undefined;
        if (waiting) options?.onAttention?.(false);
      };
      const complete = () => {
        if (finished) return;
        cleanup();
        void this.collect(threadId, turn).then(resolve);
      };
      const evaluate = () => {
        if (finished) return;
        const snapshot = this.port.snapshot(threadId);
        if (!snapshot) {
          cleanup();
          resolve(
            turn.stopRequested
              ? { status: "stopped", text: "" }
              : this.failure(i18n._(msg`The participant's thread was removed.`)),
          );
          return;
        }
        if (isThreadTurnActive(snapshot.status)) sawActive = true;
        const nowWaiting = isWaitingForUser(snapshot);
        if (nowWaiting !== waiting) {
          waiting = nowWaiting;
          options?.onAttention?.(waiting);
        }
        if (!hasEnded(snapshot)) {
          if (settleTimer !== undefined) clearTimeout(settleTimer);
          settleTimer = undefined;
          return;
        }
        const sinceStart = Date.now() - startedAt;
        if (!sawActive && !turn.stopRequested && sinceStart < graceMs) {
          // The send has not visibly started yet (a terminal status can lag).
          if (graceTimer === undefined) {
            graceTimer = setTimeout(() => {
              graceTimer = undefined;
              evaluate();
            }, graceMs - sinceStart);
          }
          return;
        }
        if (settleTimer === undefined) {
          settleTimer = setTimeout(() => {
            settleTimer = undefined;
            const latest = this.port.snapshot(threadId);
            if (latest && hasEnded(latest)) complete();
            else evaluate();
          }, this.timing.settleMs);
        }
      };

      turn.wake = complete;
      unsubscribe = this.port.subscribe(threadId, evaluate);
      if (onProgress && presentation === "gui") {
        progressTimer = setInterval(() => {
          const text = this.port.readLiveText(threadId);
          if (text !== lastProgress) {
            lastProgress = text;
            onProgress(text);
          }
        }, this.timing.progressMs);
      }
      evaluate();
    });
  }

  private async collect(threadId: string, turn: ActiveTurn): Promise<TurnResult> {
    const snapshot = this.port.snapshot(threadId);
    let text = "";
    let errorMessage: string | undefined;
    try {
      if (snapshot?.presentationMode === "terminal") {
        text = await this.port.readTerminalText(threadId);
      } else {
        const read = await this.port.readLastTurn(threadId);
        text = read.text;
        errorMessage = read.errorMessage;
      }
    } catch (error) {
      errorMessage = this.port.describeError(error);
    }
    if (turn.stopRequested) return { status: "stopped", text };
    if (snapshot?.status === "error" || snapshot?.interruptedTurn === "error") {
      return {
        status: "failed",
        text,
        error:
          snapshot.errorMessage ??
          errorMessage ??
          i18n._(msg`The participant's turn ended with an error.`),
      };
    }
    if (snapshot?.interruptedTurn === "restart") {
      return {
        status: "failed",
        text,
        error: i18n._(msg`The participant's turn was cut off by a restart.`),
      };
    }
    if (!text.trim() && errorMessage) return { status: "failed", text, error: errorMessage };
    return { status: "done", text };
  }
}
