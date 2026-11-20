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
 * Group chats saved by the removed Bots feature are Roundtables in the
 * "open" pattern; their seats keep the optional avatar and instructions.
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
  /**
   * "Work together" (default): a continuous team chat. Each user message is
   * answered by every seated participant in seat order (or only the ones it
   * @mentions); each sees the replies before it, and a reply that @mentions a
   * teammate hands it over. No rounds, no verdicts, no winner; it never
   * finishes on its own. Bot group chats use it too.
   */
  | "open"
  /**
   * Additive (AA compare): everyone answers the task once, independently and in
   * parallel; the user compares the answers side by side. No critique rounds,
   * no verdicts.
   */
  | "compare";

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
  /**
   * Optional standing instructions (bots, or per-AI instructions): sent on the
   * participant's first turn and again after the user edits them
   * (`RoundtableSession.instructionsUpdatedFor`).
   */
  instructions?: string;
  /** Avatar for bots: an emoji or 1–2 letters, plus an accent colour token or hex. */
  avatar?: { glyph: string; color: string };
  /**
   * Additive (Work together): when the participant joined a running open
   * session (`addRoundtableParticipants`). It is not asked to answer messages
   * posted before then. Absent: seated from the start.
   */
  joinedAt?: number;
  /**
   * Additive (Playbooks): this seat's playbook id, which overrides the
   * table's (`RoundtableSession.playbookId`); `null` means none for this
   * seat. Absent: the table's. Applied when the seat's thread is created.
   */
  playbookId?: string | null;
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
  /**
   * Additive (RT1 engine): what this turn was for. The orchestrator re-derives
   * its position from the stored turns alone, so a reload can resume a session.
   */
  phase?: RoundtableTurnPhase;
  /** Additive (RT1 engine): the user message (`RoundtableNote`) an open-pattern reply answers. */
  noteId?: string;
  /** Additive (RT1 engine): `responseText` was cut to the stored cap (a marker sits in the text). */
  truncated?: boolean;
  /**
   * Additive (Work together): the turn is saved but its prompt has not gone
   * out yet. A reload re-sends such a turn instead of attaching to the
   * thread (whose last answer belongs to an earlier turn). Absent on turns
   * older builds wrote: those attach, as before.
   */
  unsent?: true;
}

/** Additive (RT1 engine): the step a turn belongs to, per pattern. */
export type RoundtableTurnPhase =
  /** build-review: the builder's work; relay: the builder stage. */
  | "build"
  /** build-review: a reviewer's verdict; relay: the reviewer stage. */
  | "review"
  /** relay: the planner stage. */
  | "plan"
  /** relay: the tester stage. */
  | "test"
  /** relay: a stage whose participant has no specific role. */
  | "contribute"
  /** debate: independent first proposal. */
  | "propose"
  /** debate: revision after reading the others' proposals. */
  | "critique"
  /** debate/race: the judge's or a voter's pick. */
  | "decide"
  /** debate: the winner implements the chosen proposal. */
  | "implement"
  /** race: the candidate's own run inside the experiment. */
  | "race"
  /** race: reviewing the other candidates. */
  | "cross-review"
  /** open: a reply in the group chat. */
  | "reply"
  /** Additive (AA compare): a participant's one independent answer. */
  | "answer";

/**
 * Additive (RT1 engine): a message the user posted to a Roundtable. In the
 * open pattern it asks participants to reply; in the other patterns it steers
 * the run and is added to the next participant's prompt.
 */
export interface RoundtableNote {
  id: string;
  text: string;
  /** Participant ids asked to reply (open pattern); empty or absent = everyone, in order. */
  mentions?: string[];
  createdAt: number;
  /** Steering notes: the turn whose prompt carried this note. */
  deliveredTurnId?: string;
  /**
   * Additive (Work together): the user stopped the replies to this message
   * ("Stop replies", or the chat was stopped and then continued); nobody
   * else answers it.
   */
  halted?: true;
}

/** Additive (RT1 engine): why a Roundtable finished, for the UI to explain (localized there). */
export interface RoundtableOutcome {
  reason:
    | "approved"
    | "max-rounds"
    | "judge"
    | "vote"
    | "crown"
    | "completed"
    | "single-survivor"
    /** Additive (AA compare): every participant answered (failed answers are marked). */
    | "compared";
  /** Judge or crown rationale, when one was given. */
  rationale?: string;
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
  /** Additive (RT1 engine): branch of `worktreePath` when the Roundtable created one. */
  worktreeBranch?: string;
  /** Additive (RT1 engine): race pattern — the Agent Experiment that holds the candidates. */
  experimentId?: string;
  /** Additive (RT1 engine): debate pattern — the winner implements the chosen proposal. */
  implementWinner?: boolean;
  /** Additive (RT1 engine): user messages, in posting order. */
  notes?: RoundtableNote[];
  /** Additive (RT1 engine): set when the session finishes `done`. */
  outcome?: RoundtableOutcome;
  /** Additive (RT1 engine): why the session failed. */
  error?: string;
  /**
   * Additive (AA compare): a debate started from a compare session. Its
   * round-0 proposals are that session's answers, and each participant
   * continues in the same thread.
   */
  seededFromSessionId?: string;
  /** Additive (Work together): instructions for every participant, editable after start. */
  instructions?: string;
  /**
   * Additive (Work together), legacy: one stamp for every participant, written
   * by builds before `instructionsUpdatedFor`. Still honoured when present.
   */
  instructionsUpdatedAt?: number;
  /**
   * Additive (Work together): participant id → when an edit after start last
   * changed that participant's own or the shared instructions. Only those
   * participants get them again on their next turn.
   */
  instructionsUpdatedFor?: Record<string, number>;
  /**
   * Additive (Playbooks): the playbook every seat's new thread is bound to,
   * unless the seat overrides it. Resolved from the catalog when the thread
   * is created; the thread then holds its own frozen copy.
   */
  playbookId?: string;
}

/** Live streaming callback: text so far for the running turn (throttled by the driver). */
export type TurnProgressListener = (partialText: string) => void;

/** Additive (RT1 engine): optional per-turn hooks for `ParticipantDriver.sendTurn`. */
export interface SendTurnOptions {
  /**
   * The participant started (`true`) or stopped (`false`) waiting for the user
   * (a permission request or a question). The engine shows attention; the user
   * answers in the participant's own thread. Never auto-approved.
   */
  onAttention?: (waiting: boolean) => void;
  /**
   * Threads to reference as context (`{kind:"thread"}` mentions) when the
   * participant can read them with `read_thread`; otherwise ignored (the
   * prompt already quotes the needed text).
   */
  contextThreadIds?: string[];
  /**
   * Additive (Work together): called right before the prompt goes out, so a
   * reload can tell a sent turn from one that was only queued.
   */
  onSent?: () => void;
}

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
  sendTurn(
    prompt: string,
    onProgress?: TurnProgressListener,
    /** Additive (RT1 engine): optional per-turn hooks; drivers may ignore them. */
    options?: SendTurnOptions,
  ): Promise<TurnResult>;
  /**
   * Additive (RT1 engine), optional: wait for a turn that is already running
   * (a race candidate launched by the experiment, or a turn in flight when the
   * window reloaded) and resolve with its result, without sending anything.
   */
  awaitCurrentTurn?(
    onProgress?: TurnProgressListener,
    options?: SendTurnOptions,
  ): Promise<TurnResult>;
  /** Interrupt the running turn, if any. */
  stop(): Promise<void>;
  /** Thread id when backed by an agent thread (to open it in a pane). */
  threadId(): string | undefined;
  /** Release live-event interest, timers and listeners. */
  dispose(): void;
}
