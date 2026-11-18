/**
 * ViscosityCode: the Roundtable engine's public API (contract).
 *
 * UI, in-chat entry points and Bots import ONLY from this module. The engine
 * agent replaces these placeholder implementations; signatures are the
 * contract and must not change without updating every caller.
 */
import type {
  ParticipantBrain,
  ParticipantDriver,
  ParticipantProfile,
  RoundtablePattern,
  RoundtableSession,
} from "./types";

export interface StartRoundtableInput {
  title?: string;
  task: string;
  pattern: RoundtablePattern;
  projectId: string;
  participants: ParticipantProfile[];
  /** Defaults per pattern (build-review 4, debate 2 critique rounds, open unlimited). */
  maxRounds?: number;
  /** Sequential patterns share one checkout; race always uses one worktree per participant. */
  worktree?: { mode: "current" } | { mode: "new-branch"; branchName?: string };
  /** Start from an existing thread: it becomes the first participant ("invite a model"). */
  originThreadId?: string;
}

export interface RoundtableSummary {
  id: string;
  title: string;
  pattern: RoundtablePattern;
  status: RoundtableSession["status"];
  participantCount: number;
  updatedAt: number;
}

/** An installed, signed-in agent the user can seat at a Roundtable (provider-agnostic). */
export interface ReadyAgentBrain {
  agentKind: string;
  agentInstanceId?: string;
  /** Display label from the provider manifest. */
  label: string;
  models: Array<{ id: string; label: string }>;
  defaultModel: string;
  presentationModes: Array<"gui" | "terminal">;
}

export type ParticipantDriverFactory = (
  profile: ParticipantProfile,
  session: RoundtableSession,
) => ParticipantDriver;

function notReady(name: string): never {
  throw new Error(`Roundtable engine not available yet: ${name}`);
}

export function startRoundtable(_input: StartRoundtableInput): Promise<string> {
  return notReady("startRoundtable");
}
export function stopRoundtable(_sessionId: string): Promise<void> {
  return notReady("stopRoundtable");
}
export function pauseRoundtable(_sessionId: string): void {
  notReady("pauseRoundtable");
}
export function resumeRoundtable(_sessionId: string): void {
  notReady("resumeRoundtable");
}
/** Post a user message; `mentions` (participant ids) choose who replies in the open pattern. */
export function postToRoundtable(
  _sessionId: string,
  _text: string,
  _options?: { mentions?: string[] },
): Promise<void> {
  return notReady("postToRoundtable");
}
export function deleteRoundtable(_sessionId: string): void {
  notReady("deleteRoundtable");
}
export function useRoundtableSession(
  _sessionId: string | undefined,
): RoundtableSession | undefined {
  return undefined;
}
export function useRoundtableList(): RoundtableSummary[] {
  return [];
}
/** Live partial text of a running turn (throttled), or "" when idle. */
export function useLiveTurnText(_sessionId: string, _turnId: string): string {
  return "";
}
/** Agents that are installed, enabled, signed in and have models, for a project. */
export function useReadyAgentBrains(_projectId: string | undefined): ReadyAgentBrain[] {
  return [];
}
export function registerParticipantDriverFactory(
  _kind: ParticipantBrain["kind"],
  _factory: ParticipantDriverFactory,
): void {
  // Placeholder: the engine keeps a registry keyed by brain kind.
}
