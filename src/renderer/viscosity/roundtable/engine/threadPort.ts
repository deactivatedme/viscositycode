/**
 * ViscosityCode Roundtable engine: the narrow port through which the thread
 * driver reaches the existing thread engine. The live implementation
 * (`threadPortLive.ts`) only calls existing renderer actions — the PR Ask
 * side-chat pattern — so the supervisor stays the only process that spawns
 * agents. Tests drive the driver with a fake port and a fake store.
 */
import type { PromptSegment, ThreadStatus } from "@/shared/contracts";
import type { ParticipantProfile, RoundtableSession } from "../types";
import { isLightweightActive } from "@/renderer/viscosity/performance/lightweight";

export interface ThreadTurnSnapshot {
  status: ThreadStatus;
  presentationMode: "gui" | "terminal";
  interruptedTurn?: "error" | "restart" | undefined;
  errorMessage?: string | undefined;
  /**
   * Work still running after the foreground turn settled: a live background
   * workflow, provider background tasks, or native sub-agents.
   */
  busyInBackground: boolean;
  /** Whether this thread's live session has the read_thread tool (undefined = unknown). */
  mentionToolsAvailable: boolean | undefined;
}

export interface LastTurnRead {
  /** Final assistant text of the latest turn ("" when there is none). */
  text: string;
  /** A non-warning error the turn reported, if any. */
  errorMessage?: string | undefined;
}

export interface ThreadLaunchRequest {
  session: RoundtableSession;
  profile: ParticipantProfile;
  brain: Extract<ParticipantProfile["brain"], { kind: "agent" }>;
  prompt: string;
  segments?: PromptSegment[] | undefined;
  /** Thread references may be dropped by the host when the session cannot read them. */
  mentionHandoff?: boolean | undefined;
}

export interface ThreadEnginePort {
  snapshot(threadId: string): ThreadTurnSnapshot | undefined;
  /** Calls `listener` when anything that can change `snapshot(threadId)` changed. */
  subscribe(threadId: string, listener: () => void): () => void;
  /** Text so far of the latest assistant reply (cheap; read from loaded items). */
  readLiveText(threadId: string): string;
  /** Final text of the latest turn: loaded items first, then the host's stored items. */
  readLastTurn(threadId: string): Promise<LastTurnRead>;
  /** Terminal presentation: the scrollback as plain text. */
  readTerminalText(threadId: string): Promise<string>;
  /**
   * Creates the participant's thread without taking focus and launches it with
   * the first prompt. `onCreated` runs once the row exists, before the launch.
   * Throws on a definite failure; an uncertain outcome resolves (the launch
   * may have committed and must never be resent).
   */
  createAndLaunch(
    request: ThreadLaunchRequest,
    onCreated: (threadId: string) => void,
  ): Promise<string>;
  /** Sends a follow-up. Throws on a definite failure; resolves on an uncertain one. */
  submit(threadId: string, prompt: string, segments?: PromptSegment[]): Promise<void>;
  interrupt(threadId: string): Promise<void>;
  /** Keeps the thread's runtime events flowing while a turn runs; returns the release. */
  retainReader(threadId: string): () => void;
  /** Launch-time half of read_thread availability (the settings). */
  readThreadToolEnabled(): boolean;
  threadTitle(threadId: string): string | undefined;
  /** A user-facing message for an error thrown by the engine. */
  describeError(error: unknown): string;
}

export interface DriverTiming {
  /** How long an ended turn must stay ended before it counts (status flapping between steps). */
  settleMs: number;
  /** Before a turn was seen running, how long an idle thread is still treated as "starting". */
  startGraceMs: { gui: number; terminal: number };
  /** Live text sampling (≤ 8 Hz), read when a turn starts. */
  progressMs: number;
}

export const DEFAULT_DRIVER_TIMING: DriverTiming = {
  settleMs: 750,
  startGraceMs: { gui: 2_000, terminal: 10_000 },
  // A getter so each turn picks up a Lightweight toggle (2 Hz while it is on).
  get progressMs() {
    return isLightweightActive() ? 500 : 125;
  },
};
