/**
 * ViscosityCode: Roundtable contracts (fork of Poracode).
 *
 * A Roundtable runs 2–5 participants on one task in turns. Each participant is
 * either an agent THREAD on any installed provider (Claude Code, Codex, Cursor,
 * Grok Build, Gemini, Copilot … — the user's own subscription logins) or a
 * model reached directly over an API (the xAI Grok Responses API). Both sit
 * behind `ParticipantDriver`, so the orchestrator and UI never branch on a
 * provider name (provider-isolation rule, ARCHITECTURE_NOTES.md §1).
 *
 * Codync-style Bots reuse the same engine: a bot is a saved participant
 * profile, and a bot group chat is a Roundtable in the "open" pattern.
 */

/** How participants take turns. */
export type RoundtablePattern =
  /** One builds, another reviews; loop until the reviewer approves or rounds run out. */
  | "build-review"
  /** Everyone proposes, critiques the others for N rounds, then a judge (or vote) decides. */
  | "debate"
  /** A fixed chain of stages (plan → implement → test → review), one participant each. */
  | "relay"
  /** All build in parallel on separate worktrees, cross-review each other, best is crowned. */
  | "race"
  /** Free group chat: the user (or a bot) @mentions who replies; everyone else may react. */
  | "open";

export type ParticipantRole = "builder" | "reviewer" | "planner" | "tester" | "judge" | "member";

/** Where a participant's brain runs. */
export type ParticipantBrain =
  | {
      kind: "agent";
      /** Provider adapter kind, opaque to shared code. */
      agentKind: string;
      agentInstanceId?: string;
      model: string;
      presentationMode: "gui" | "terminal";
    }
  | {
      kind: "xai";
      /** Owner-confirmed spec: grok-4.7 for text (see reference-xai-api-spec). */
      model: string;
      region: "global" | "us";
      tools: { webSearch: boolean; xSearch: boolean };
    };

export interface ParticipantProfile {
  id: string;
  /** Display name, e.g. "Claude · Opus" or a bot's name. */
  label: string;
  role: ParticipantRole;
  brain: ParticipantBrain;
  /** Optional standing instructions (bots) prepended to this participant's first turn. */
  instructions?: string;
  /** Avatar for bots: an emoji or 1–2 letters, plus an accent colour token or hex. */
  avatar?: { glyph: string; color: string };
}

export type TurnStatus = "pending" | "running" | "waiting-approval" | "done" | "failed" | "stopped";

export interface RoundtableTurn {
  id: string;
  participantId: string;
  round: number;
  /** Prompt the orchestrator sent (already includes peer context). */
  prompt: string;
  status: TurnStatus;
  /** Final text of the turn once done (read from the thread or the API stream). */
  responseText?: string;
  /** Machine-readable verdict parsed from the response, when the pattern asks for one. */
  verdict?: "approve" | "revise" | "pick";
  /** For "pick" verdicts: the participant id that was chosen. */
  pickedParticipantId?: string;
  startedAt?: number;
  endedAt?: number;
  error?: string;
}

export type RoundtableStatus = "draft" | "running" | "paused" | "done" | "failed" | "stopped";

export interface RoundtableSession {
  id: string;
  version: 1;
  title: string;
  task: string;
  pattern: RoundtablePattern;
  projectId: string;
  /** Shared worktree for sequential patterns; race uses one worktree per participant. */
  worktreePath?: string;
  participants: ParticipantProfile[];
  /** Thread id per agent participant once launched (participantId → threadId). */
  threadIds: Record<string, string>;
  maxRounds: number;
  status: RoundtableStatus;
  turns: RoundtableTurn[];
  /** Participant chosen by a debate/race decision, if any. */
  winnerParticipantId?: string;
  /** The thread the Roundtable was started from ("invite a model into this chat"). */
  originThreadId?: string;
  createdAt: number;
  updatedAt: number;
}

/** Live streaming callback: text so far for the running turn (throttled by the driver). */
export type TurnProgressListener = (partialText: string) => void;

export interface TurnResult {
  status: Extract<TurnStatus, "done" | "failed" | "stopped">;
  text: string;
  error?: string;
}

/**
 * One participant's connection. Implementations: `ThreadParticipantDriver`
 * (agent threads via the existing thread engine — the PR Ask side-chat
 * pattern) and `XaiParticipantDriver` (main-process xAI client).
 */
export interface ParticipantDriver {
  readonly participantId: string;
  /** Create the thread / conversation if needed. Idempotent. */
  ensureStarted(): Promise<void>;
  /** Send one turn and resolve when it finishes (approvals still go to the user). */
  sendTurn(prompt: string, onProgress?: TurnProgressListener): Promise<TurnResult>;
  /** Interrupt the running turn, if any. */
  stop(): Promise<void>;
  /** Thread id when backed by an agent thread (to open it in a pane). */
  threadId(): string | undefined;
  /** Release live-event interest, timers and listeners. */
  dispose(): void;
}
