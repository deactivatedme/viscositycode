/**
 * ViscosityCode: the Roundtable engine's public API (contract).
 *
 * UI, in-chat entry points and Bots import ONLY from this module. Signatures
 * are the contract and must not change without updating every caller.
 *
 * Additive extensions (RT1 engine): `StartRoundtableInput.implementWinner`;
 * see also the "Additive (RT1 engine)" fields in ./types.ts.
 *
 * The engine (./engine) is renderer-orchestrated: it creates, sends to and
 * reads participant threads only through the existing renderer actions (the
 * PR Ask side-chat pattern), so the supervisor remains the only process that
 * starts agents. Participant threads are created without focus — starting or
 * running a Roundtable never switches the user's current view or tab.
 */
import { msg } from "@lingui/core/macro";
import { useDraftEnvironment } from "@/renderer/hooks/uiSelectors";
import { i18n } from "@/renderer/i18n/i18n";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { useProject } from "@/renderer/state/useThread";
import { selectReadyAgentBrains } from "./engine/agentBrains";
import { registerDriverFactory } from "./engine/driverRegistry";
import { clearSessionLiveText, liveTurnKey, useRoundtableLiveText } from "./engine/liveText";
import { getRoundtableRuntime, startRoundtableSession } from "./engine/runtime";
import { useRoundtableStore, waitForRoundtableHydration } from "./roundtableStore";
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
  /** Defaults per pattern (build-review 4, debate 2 critique rounds, relay 3, open unlimited). */
  maxRounds?: number;
  /** Sequential patterns share one checkout; race always uses one worktree per participant. */
  worktree?: { mode: "current" } | { mode: "new-branch"; branchName?: string };
  /** Start from an existing thread: it becomes the first participant ("invite a model"). */
  originThreadId?: string;
  /**
   * Additive (RT1 engine): debate only — after the decision, the winner
   * implements its proposal in the working tree. Explicit by design: the
   * engine never guesses it from the task text.
   */
  implementWinner?: boolean;
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

/**
 * Creates a session and starts it; resolves with its id once it is saved.
 * Rejects with a user-facing message when the request cannot run.
 */
export function startRoundtable(input: StartRoundtableInput): Promise<string> {
  return startRoundtableSession(input);
}

/** Interrupts the participants' running turns and ends the session. */
export function stopRoundtable(sessionId: string): Promise<void> {
  return getRoundtableRuntime().runner.stop(sessionId);
}

/** Lets the running turns finish, then waits. */
export function pauseRoundtable(sessionId: string): void {
  getRoundtableRuntime().runner.pause(sessionId);
}

/** Continues a paused session; a failed one retries its failed turns. */
export function resumeRoundtable(sessionId: string): void {
  getRoundtableRuntime().runner.resume(sessionId);
}

/**
 * Post a user message; `mentions` (participant ids) choose who replies in the
 * open pattern. In the other patterns the message steers the run: it is added
 * to the next participant's prompt. Rejects with a user-facing message when
 * the session is gone or has ended, since nobody would ever answer.
 */
export async function postToRoundtable(
  sessionId: string,
  text: string,
  options?: { mentions?: string[] },
): Promise<void> {
  const message = text.trim();
  if (!message) return;
  await waitForRoundtableHydration();
  const status = useRoundtableStore.getState().sessions[sessionId]?.status;
  if (status === undefined) throw new Error(i18n._(msg`This Roundtable no longer exists.`));
  if (status === "done" || status === "stopped" || status === "failed") {
    throw new Error(i18n._(msg`This Roundtable has ended. Start a new one to continue.`));
  }
  getRoundtableRuntime().runner.post(sessionId, message, options?.mentions);
}

/** Forgets the session. Its participant threads stay, as ordinary threads. */
export function deleteRoundtable(sessionId: string): void {
  getRoundtableRuntime().runner.release(sessionId);
  useRoundtableStore.getState().removeSession(sessionId);
  clearSessionLiveText(sessionId);
}

export function useRoundtableSession(sessionId: string | undefined): RoundtableSession | undefined {
  return useRoundtableStore((state) => (sessionId ? state.sessions[sessionId] : undefined));
}

/** Every saved Roundtable, most recently updated first. */
export function useRoundtableList(): RoundtableSummary[] {
  const sessions = useRoundtableStore((state) => state.sessions);
  return Object.values(sessions)
    .map((session) => ({
      id: session.id,
      title: session.title,
      pattern: session.pattern,
      status: session.status,
      participantCount: session.participants.length,
      updatedAt: session.updatedAt,
    }))
    .toSorted((left, right) => right.updatedAt - left.updatedAt);
}

/** Live partial text of a running turn (throttled), or "" when idle. */
export function useLiveTurnText(sessionId: string, turnId: string): string {
  return useRoundtableLiveText((state) => state.textByTurn[liveTurnKey(sessionId, turnId)] ?? "");
}

/** Agents that are installed, enabled, signed in and have models, for a project. */
export function useReadyAgentBrains(projectId: string | undefined): ReadyAgentBrain[] {
  const project = useProject(projectId);
  const environment = useDraftEnvironment(project);
  const disabledAgents = useSharedSettings((state) => state.disabledAgents);
  const providerConfigs = useSharedSettings((state) => state.providerConfigs);
  const providerModelPreferences = useSharedSettings((state) => state.providerModelPreferences);
  return selectReadyAgentBrains({
    agents: environment.agentStatuses,
    disabledAgents,
    lastDraftConfig: project?.lastDraftConfig,
    providerConfigs,
    providerModelPreferences,
  });
}

/** Registers the driver for a brain kind ("agent" is built in; Bots registers "xai"). */
export function registerParticipantDriverFactory(
  kind: ParticipantBrain["kind"],
  factory: ParticipantDriverFactory,
): void {
  registerDriverFactory(kind, factory);
}

// Register the built-in "agent" driver and, in the main window, resume the
// sessions that were running before a reload (after the store has loaded).
getRoundtableRuntime();
