/**
 * ViscosityCode: the Roundtable engine's public API (contract).
 *
 * UI and in-chat entry points import ONLY from this module. Signatures
 * are the contract and must not change without updating every caller.
 *
 * Additive extensions (RT1 engine): `StartRoundtableInput.implementWinner`;
 * see also the "Additive (RT1 engine)" fields in ./types.ts.
 * Additive extensions (AA compare): the "compare" pattern and
 * `StartRoundtableInput.seedFromSessionId`.
 * Additive extensions (Work together): `StartRoundtableInput.instructions`,
 * `updateRoundtableInstructions`, `interruptRoundtable`,
 * `addRoundtableParticipants`; `postToRoundtable` reopens a stopped open chat.
 * Additive extensions (Playbooks): `StartRoundtableInput.playbookId`.
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
// ViscosityCode: account pools — seats prefer the pooled account with the most usage left.
import { useAccountPoolPreferredOrder } from "@/renderer/viscosity/accountPools/poolHooks";
import { selectReadyAgentBrains } from "./engine/agentBrains";
import { answeredParticipants, hasActiveSeededDebate, latestSeededDebate } from "./engine/compare";
import { registerDriverFactory } from "./engine/driverRegistry";
import { clearSessionLiveText, liveTurnKey, useRoundtableLiveText } from "./engine/liveText";
import { getRoundtableRuntime, startRoundtableSession } from "./engine/runtime";
import { addParticipantsToSession } from "./engine/session";
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
  /**
   * Defaults per pattern (build-review 4, debate 2 critique rounds, relay 3,
   * open unlimited, compare one answer each).
   */
  maxRounds?: number;
  /** Sequential patterns share one checkout; race always uses one worktree per participant. */
  worktree?:
    | { mode: "current" }
    | { mode: "new-branch"; branchName?: string }
    /** Additive: an existing worktree the user picked; sequential patterns share it. */
    | { mode: "existing"; worktreePath: string; worktreeBranch?: string };
  /** Start from an existing thread: it becomes the first participant ("invite a model"). */
  originThreadId?: string;
  /**
   * Additive (RT1 engine): debate only — after the decision, the winner
   * implements its proposal in the working tree. Explicit by design: the
   * engine never guesses it from the task text.
   */
  implementWinner?: boolean;
  /**
   * Additive (AA compare): debate only — start from a finished compare
   * session. Each participant's answer there becomes its opening proposal and
   * it continues in the same thread (and checkout), so the debate goes
   * straight to the critique rounds. `participants` must be participants of
   * that session (same ids) that answered.
   */
  seedFromSessionId?: string;
  /**
   * Additive (Work together): instructions for every participant (trimmed;
   * blank is omitted). Per-participant ones go in `ParticipantProfile.instructions`.
   */
  instructions?: string;
  /**
   * Additive (Playbooks): the table's playbook id; seats override it with
   * `ParticipantProfile.playbookId`. A read-only playbook is refused for a
   * pattern whose seats must edit files.
   */
  playbookId?: string;
}

/** Additive (Work together): an edit of the instructions after start. */
export interface RoundtableInstructionsUpdate {
  /** Instructions for everyone; blank removes them. Omitted: unchanged. */
  shared?: string;
  /** Participant id → its own instructions; blank removes them. Unknown ids are ignored. */
  participants?: Record<string, string>;
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

/**
 * Additive (AA compare): "Start a debate from here" — a debate seeded with a
 * finished comparison's answers. Every participant that answered takes part
 * (as a voter), keeps its thread and starts from its answer, so the debate
 * opens with the critique rounds. Resolves with the new session's id; rejects
 * with a user-facing message when the comparison cannot seed a debate.
 */
export async function startDebateFromComparison(sessionId: string): Promise<string> {
  await waitForRoundtableHydration();
  const sessions = useRoundtableStore.getState().sessions;
  const source = sessions[sessionId];
  if (!source) throw new Error(i18n._(msg`The comparison to start from is no longer available.`));
  // A running debate already drives these threads; a second one would talk over it.
  if (hasActiveSeededDebate(sessions, sessionId)) {
    throw new Error(i18n._(msg`A debate from this comparison is already running.`));
  }
  const title = source.title;
  return startRoundtableSession({
    title: i18n._(msg`Debate: ${title}`),
    task: source.task,
    pattern: "debate",
    projectId: source.projectId,
    participants: answeredParticipants(source).map((participant) => ({
      ...participant,
      role: "member",
    })),
    seedFromSessionId: source.id,
  });
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
 * Additive (Work together): "Stop replies" in an open chat. Interrupts the
 * running replies; nobody else answers the messages posted so far. The chat
 * stays running, so the next message is answered as usual. No-op for other
 * patterns and for a chat that is not running.
 */
export function interruptRoundtable(sessionId: string): Promise<void> {
  return getRoundtableRuntime().runner.interrupt(sessionId);
}

/**
 * Additive (Work together): changes the shared and/or per-participant
 * instructions of any saved session. Each participant gets them again with
 * its next turn when the edit changed its own or the shared instructions (the
 * planner compares `instructionsUpdatedFor` with its last turn). Grok seats
 * read their current instructions on every request. Rejects with a
 * user-facing message when the session is gone.
 */
export async function updateRoundtableInstructions(
  sessionId: string,
  update: RoundtableInstructionsUpdate,
): Promise<void> {
  await waitForRoundtableHydration();
  const store = useRoundtableStore.getState();
  if (!store.sessions[sessionId]) throw new Error(i18n._(msg`This Roundtable no longer exists.`));
  store.updateSession(sessionId, (session) => {
    const { instructions: _shared, ...rest } = session;
    const shared = update.shared === undefined ? session.instructions : update.shared.trim();
    const sharedChanged = (shared ?? "") !== (session.instructions ?? "");
    const edits = update.participants ?? {};
    const now = Date.now();
    const stamps = { ...session.instructionsUpdatedFor };
    const participants = session.participants.map((participant): ParticipantProfile => {
      if (!Object.hasOwn(edits, participant.id)) return participant;
      const { instructions: _own, ...profile } = participant;
      const own = edits[participant.id]!.trim();
      return own ? { ...profile, instructions: own } : profile;
    });
    // Only seats whose instructions really changed are told again.
    participants.forEach((participant, index) => {
      const before = session.participants[index]!.instructions ?? "";
      if (sharedChanged || (participant.instructions ?? "") !== before) {
        stamps[participant.id] = now;
      }
    });
    return {
      ...rest,
      ...(shared ? { instructions: shared } : {}),
      participants,
      ...(Object.keys(stamps).length > 0 ? { instructionsUpdatedFor: stamps } : {}),
    };
  });
}

/**
 * Additive (Work together): seats more participants in an open chat (ids
 * already seated are skipped). They answer the messages posted from now on,
 * with their own threads. Rejects with a user-facing message when the session
 * is gone, is not an open chat, or would seat more than the maximum.
 */
export async function addRoundtableParticipants(
  sessionId: string,
  participants: ParticipantProfile[],
): Promise<void> {
  await waitForRoundtableHydration();
  const store = useRoundtableStore.getState();
  const session = store.sessions[sessionId];
  if (!session) throw new Error(i18n._(msg`This Roundtable no longer exists.`));
  // Throws before anything is written when they cannot join.
  const next = addParticipantsToSession(session, participants, Date.now());
  store.updateSession(sessionId, () => next);
}

/**
 * Post a user message; `mentions` (participant ids) choose who replies in the
 * open pattern. In the other patterns the message steers the run: it is added
 * to the next participant's prompt. A stopped open chat reopens (what the stop
 * cut off stays unanswered). Rejects with a user-facing message when the
 * session is gone or has ended, since nobody would ever answer.
 */
export async function postToRoundtable(
  sessionId: string,
  text: string,
  options?: { mentions?: string[] },
): Promise<void> {
  const message = text.trim();
  if (!message) return;
  await waitForRoundtableHydration();
  const session = useRoundtableStore.getState().sessions[sessionId];
  if (session === undefined) throw new Error(i18n._(msg`This Roundtable no longer exists.`));
  const { status } = session;
  const reopens = session.pattern === "open" && status === "stopped";
  if (!reopens && (status === "done" || status === "stopped" || status === "failed")) {
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
  // ViscosityCode: account pools — seats default to the pooled account with the most usage left.
  return useAccountPoolPreferredOrder(
    selectReadyAgentBrains({
      agents: environment.agentStatuses,
      disabledAgents,
      lastDraftConfig: project?.lastDraftConfig,
      providerConfigs,
      providerModelPreferences,
    }),
    environment.agentStatuses,
    !project?.remoteServerId,
  );
}

/** Registers the driver for a brain kind ("agent" is built in; the runtime registers "xai"). */
export function registerParticipantDriverFactory(
  kind: ParticipantBrain["kind"],
  factory: ParticipantDriverFactory,
): void {
  registerDriverFactory(kind, factory);
}

/** Additive (AA compare): pure reads of a compare session for the UI. */
export { canSeedDebate, compareAnswers, type CompareAnswer } from "./engine/compare";

/** Additive (AA compare): the newest debate started from a comparison, if any. */
export function useLatestSeededDebateId(compareId: string): string | undefined {
  return useRoundtableStore((state) => latestSeededDebate(state.sessions, compareId)?.id);
}

/** Additive (AA compare): whether a debate from this comparison is still running or paused. */
export function useHasActiveSeededDebate(compareId: string): boolean {
  return useRoundtableStore((state) => hasActiveSeededDebate(state.sessions, compareId));
}

// Register the built-in "agent" driver and, in the main window, resume the
// sessions that were running before a reload (after the store has loaded).
getRoundtableRuntime();
