/**
 * ViscosityCode: the Roundtable session store (fork of Poracode).
 *
 * Persisted through the local backend's generic key/value state
 * (`createDbStorage`, the same path upstream UI stores use): this desktop's
 * SQLite on Electron, an IndexedDB cache in browser clients. It is a deliberate
 * exception to ARCHITECTURE_NOTES §8.6 (client preferences in localStorage):
 * session records are larger than a preference and must survive a reload so
 * an orchestration can resume.
 *
 * What is stored: participants, thread ids, round state and each turn's FINAL
 * text (capped at ~20k characters, with a marker) — never transcripts; the
 * threads themselves stay host-owned and are re-read from the host. Live
 * partial text lives in `engine/liveText.ts` and is never persisted.
 *
 * Storage format: name {@link ROUNDTABLE_STORE_NAME}, version
 * {@link ROUNDTABLE_STORE_VERSION}. Unknown or malformed records (an older
 * draft, a newer build) are dropped one by one on load instead of failing the
 * whole store.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { playbookIdSchema } from "@/shared/viscosity/playbook";
import { createDbStorage } from "@/renderer/state/dbStorage";
import { projectJsonBytes } from "@/renderer/state/remote/engine/jsonProjection";
import { OPEN_TRANSCRIPT_MESSAGES } from "./engine/prompts";
import { capText, RESPONSE_TEXT_CAP, STORED_PROMPT_CAP } from "./engine/text";
import type { RoundtableNote, RoundtablePattern, RoundtableSession, RoundtableTurn } from "./types";

export const ROUNDTABLE_STORE_NAME = "poracode-viscosity-roundtables";
/**
 * Version 1 is still current after the additive AA "compare" pattern
 * (pattern "compare", turn phase "answer", outcome "compared", optional
 * `seededFromSessionId`). Audit (.agents/docs/versioning.md):
 * - Upgrade: every record an older build wrote is still valid as is; the
 *   pre-upgrade test in roundtableStore.test.ts loads a literal pre-compare
 *   blob of each pattern unchanged.
 * - Downgrade: an older build's `sanitizeSession` rejects the unknown pattern,
 *   so it drops compare sessions one by one, keeps everything else, and its
 *   next write leaves them out. A debate seeded from a comparison is an
 *   ordinary debate record (phase "propose" turns) that older builds load and
 *   run; they ignore and carry `seededFromSessionId`. The participant threads
 *   stay host-owned either way, so only the compare cards are lost.
 * - No bump: older builds migrate any version through the same sanitizer, so
 *   a bump would not make them refuse the blob or keep the compare records.
 *
 * Still version 1 after the additive "Work together" fields: session
 * `instructions`, `instructionsUpdatedAt` and `instructionsUpdatedFor`, participant `joinedAt`, note
 * `halted` and turn `unsent`. No new pattern, phase, status or outcome.
 * - Upgrade: records without them are valid as is (pre-upgrade test in roundtableStore.test.ts).
 *   Malformed values are dropped here so they cannot reach a prompt.
 * - Downgrade: older builds spread the raw record, so they load, carry and
 *   ignore the fields. Costs: they re-ask a reply stopped with "Stop
 *   replies", ask a participant added later to answer older messages, send no
 *   shared instructions, and attach a reloaded turn that was never sent (the
 *   old behaviour).
 *
 * Still version 1 after the additive Playbooks fields: session `playbookId`
 * and participant `playbookId` (an id, or `null` for none on that seat).
 * - Upgrade: records without them are valid as is (pre-upgrade test in
 *   roundtableStore.test.ts). A value that is not a playbook id is dropped
 *   here, so the seat falls back to the table's playbook (or none).
 * - Downgrade: older builds spread the raw record, so they carry and ignore
 *   the fields; threads already created keep their own `ThreadConfig.playbook`,
 *   and only seats whose threads an older build creates start without one.
 *
 * Retention is not part of the format: sizes are now measured in projected
 * write bytes (they were rough characters) and open chats no longer count
 * against {@link MAX_STORED_SESSIONS}. A blob an older build saved over the
 * new budget loads whole and is trimmed by the next write (pre-upgrade test).
 */
export const ROUNDTABLE_STORE_VERSION = 1;
/**
 * Finished sessions kept on disk (newest first), besides the active ones and
 * the open chats, which do not count against it.
 */
export const MAX_STORED_SESSIONS = 50;
/**
 * Budget for the stored blob, measured the way the backend measures a write
 * ({@link storedBytes}). Both the SQLite path (`dbStorage` refuses a write
 * whose projection exceeds `CLIENT_ENGINE_AUX_STRINGIFY_MAX_BYTES`, 8 MiB) and
 * the browser cache (8 MiB per record) skip an oversized write, so this keeps
 * 2 MiB of headroom for the wrapper and keys.
 */
export const STORED_BYTE_BUDGET = 6 * 1024 * 1024;
/** An open chat never ends: past this size its oldest answered messages are not saved. */
export const OPEN_SESSION_BYTE_BUDGET = 2 * 1024 * 1024;

export interface RoundtableStoreState {
  sessions: Record<string, RoundtableSession>;
  /** Inserts or replaces a whole session. */
  putSession: (session: RoundtableSession) => void;
  /** Applies `update` to one session (no-op when it is gone) and stamps `updatedAt`. */
  updateSession: (
    sessionId: string,
    update: (session: RoundtableSession) => RoundtableSession,
  ) => void;
  removeSession: (sessionId: string) => void;
}

export type PersistedRoundtableState = Pick<RoundtableStoreState, "sessions">;

const PATTERNS: readonly RoundtablePattern[] = [
  "build-review",
  "debate",
  "relay",
  "race",
  "open",
  // Additive (AA compare). An older build drops these records one by one on
  // load; see ROUNDTABLE_STORE_VERSION for the audit.
  "compare",
];
const SESSION_STATUSES = ["draft", "running", "paused", "done", "failed", "stopped"];
const TURN_STATUSES = ["pending", "running", "waiting-approval", "done", "failed", "stopped"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Caps a turn's stored text. Idempotent. */
export function capTurnForStorage(turn: RoundtableTurn): RoundtableTurn {
  let next = turn;
  if (turn.responseText !== undefined && turn.responseText.length > RESPONSE_TEXT_CAP) {
    next = { ...next, responseText: capText(turn.responseText).text, truncated: true };
  }
  if (turn.prompt.length > STORED_PROMPT_CAP) {
    next = { ...next, prompt: capText(turn.prompt, STORED_PROMPT_CAP).text };
  }
  return next;
}

function sanitizeTurn(value: unknown): RoundtableTurn | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "string" || typeof value.participantId !== "string") return null;
  if (typeof value.round !== "number" || typeof value.prompt !== "string") return null;
  if (typeof value.status !== "string" || !TURN_STATUSES.includes(value.status)) return null;
  const { unsent, ...turn } = value;
  return capTurnForStorage({
    ...(turn as unknown as RoundtableTurn),
    ...(unsent === true ? { unsent } : {}),
  });
}

function sanitizeNote(value: unknown): RoundtableNote | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "string" || typeof value.text !== "string") return null;
  if (typeof value.createdAt !== "number") return null;
  const { halted, ...note } = value;
  return { ...(note as unknown as RoundtableNote), ...(halted === true ? { halted } : {}) };
}

function isPlaybookId(value: unknown): value is string {
  return playbookIdSchema.safeParse(value).success;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Drops malformed optional participant fields, so they cannot reach a prompt. */
function sanitizeParticipant(
  participant: RoundtableSession["participants"][number],
): RoundtableSession["participants"][number] {
  const { instructions, joinedAt, playbookId, ...rest } = participant as unknown as Record<
    string,
    unknown
  >;
  return {
    ...(rest as unknown as RoundtableSession["participants"][number]),
    ...(typeof instructions === "string" ? { instructions } : {}),
    ...(isFiniteNumber(joinedAt) ? { joinedAt } : {}),
    ...(playbookId === null || isPlaybookId(playbookId) ? { playbookId } : {}),
  };
}

/** Validates one stored session; `null` drops it. */
export function sanitizeSession(value: unknown): RoundtableSession | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "string" || !value.id) return null;
  if (typeof value.task !== "string" || typeof value.projectId !== "string") return null;
  if (typeof value.pattern !== "string" || !PATTERNS.includes(value.pattern as RoundtablePattern)) {
    return null;
  }
  if (typeof value.status !== "string" || !SESSION_STATUSES.includes(value.status)) return null;
  if (!Array.isArray(value.participants) || !Array.isArray(value.turns)) return null;
  const participants = value.participants.filter(
    (participant): participant is RoundtableSession["participants"][number] =>
      isRecord(participant) &&
      typeof participant.id === "string" &&
      typeof participant.label === "string" &&
      isRecord(participant.brain) &&
      (participant.brain.kind === "agent" || participant.brain.kind === "xai"),
  );
  if (participants.length !== value.participants.length) return null;
  const { instructions, instructionsUpdatedAt, instructionsUpdatedFor, playbookId, ...record } =
    value;
  const stamps = isRecord(instructionsUpdatedFor)
    ? Object.fromEntries(
        Object.entries(instructionsUpdatedFor).filter((entry): entry is [string, number] =>
          isFiniteNumber(entry[1]),
        ),
      )
    : {};
  const threadIds = isRecord(value.threadIds)
    ? Object.fromEntries(
        Object.entries(value.threadIds).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      )
    : {};
  const notes = Array.isArray(value.notes)
    ? value.notes.map(sanitizeNote).filter((note): note is RoundtableNote => note !== null)
    : undefined;
  return {
    ...(record as unknown as RoundtableSession),
    version: 1,
    title: typeof value.title === "string" ? value.title : "",
    participants: participants.map(sanitizeParticipant),
    ...(typeof instructions === "string" ? { instructions } : {}),
    ...(isFiniteNumber(instructionsUpdatedAt) ? { instructionsUpdatedAt } : {}),
    ...(Object.keys(stamps).length > 0 ? { instructionsUpdatedFor: stamps } : {}),
    ...(isPlaybookId(playbookId) ? { playbookId } : {}),
    threadIds,
    maxRounds: typeof value.maxRounds === "number" ? value.maxRounds : 0,
    turns: value.turns.map(sanitizeTurn).filter((turn): turn is RoundtableTurn => turn !== null),
    ...(notes ? { notes } : {}),
    createdAt: typeof value.createdAt === "number" ? value.createdAt : 0,
    updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : 0,
  };
}

export function sanitizeSessions(value: unknown): Record<string, RoundtableSession> {
  if (!isRecord(value)) return {};
  const sessions: Record<string, RoundtableSession> = {};
  for (const raw of Object.values(value)) {
    const session = sanitizeSession(raw);
    if (session) sessions[session.id] = session;
  }
  return sessions;
}

/**
 * Projected write size, as the backend charges it (`projectJsonBytes`: 2 bytes
 * per JSON character, escapes included, plus a per-container allowance).
 * A value it cannot project is never written, so it costs everything.
 */
export function storedBytes(value: unknown): number {
  const projection = projectJsonBytes(value, Number.MAX_SAFE_INTEGER);
  return projection.ok ? projection.bytes : Number.POSITIVE_INFINITY;
}

function isUnsettledTurn(turn: RoundtableTurn): boolean {
  return (
    turn.status === "pending" || turn.status === "running" || turn.status === "waiting-approval"
  );
}

/**
 * The notes the last {@link OPEN_TRANSCRIPT_MESSAGES} transcript entries up
 * to `notes.at(-1)` belong to, ordered like the planner's `groupTranscript`.
 */
function transcriptWindowNoteIds(
  notes: readonly RoundtableNote[],
  turns: readonly RoundtableTurn[],
): string[] {
  const included = new Set(notes.map((note) => note.id));
  const entries = [
    ...notes.map((note, index) => ({ at: note.createdAt, order: index, noteId: note.id })),
    ...turns.flatMap((turn, index) =>
      turn.phase === "reply" && turn.status === "done" && turn.noteId && included.has(turn.noteId)
        ? [{ at: turn.endedAt ?? turn.startedAt ?? 0, order: 100_000 + index, noteId: turn.noteId }]
        : [],
    ),
  ];
  return entries
    .toSorted((left, right) => left.at - right.at || left.order - right.order)
    .slice(-OPEN_TRANSCRIPT_MESSAGES)
    .map((entry) => entry.noteId);
}

/**
 * Messages compaction never drops, so the planner builds the same prompts
 * from the saved copy: the transcript a reply prompt quotes (for the newest
 * message and for one still being answered), the latest message, the opening message when it is
 * the chat's topic (prompts leave the task out only while it is the first
 * message), and each seat's latest finished reply (without one a seat gets
 * its first-turn instructions again).
 */
function pinnedNoteIds(session: RoundtableSession, turns: readonly RoundtableTurn[]): Set<string> {
  const notes = session.notes ?? [];
  const pinned = new Set(transcriptWindowNoteIds(notes, turns));
  if (notes.length > 0) pinned.add(notes.at(-1)!.id);
  const answering = notes.findIndex((note) =>
    turns.some((turn) => turn.noteId === note.id && isUnsettledTurn(turn)),
  );
  if (answering >= 0) {
    for (const id of transcriptWindowNoteIds(notes.slice(0, answering + 1), turns)) pinned.add(id);
  }
  if (notes[0] && notes[0].text.trim() === session.task.trim()) pinned.add(notes[0].id);
  const latestDone = new Map<string, RoundtableTurn>();
  for (const turn of turns) {
    if (turn.status !== "done") continue;
    const previous = latestDone.get(turn.participantId);
    if (!previous || (turn.startedAt ?? 0) >= (previous.startedAt ?? 0)) {
      latestDone.set(turn.participantId, turn);
    }
  }
  for (const turn of latestDone.values()) if (turn.noteId) pinned.add(turn.noteId);
  return pinned;
}

/**
 * The saved copy of an open chat: over `budget` bytes, first the prompts of
 * settled turns are left out (oldest first; xAI seats keep theirs, their
 * history is rebuilt from them), then, if still over, its oldest messages
 * together with their replies, so the planner never re-asks them. It keeps
 * the latest messages, one still being answered and everything after it, and
 * the {@link pinnedNoteIds}, so it can stay over `budget`.
 */
export function compactOpenSession(
  session: RoundtableSession,
  budget: number = OPEN_SESSION_BYTE_BUDGET,
): RoundtableSession {
  if (session.pattern !== "open" || !session.notes?.length) return session;
  let size = storedBytes(session);
  if (size <= budget) return session;
  const xaiSeats = new Set(
    session.participants
      .filter((participant) => participant.brain.kind === "xai")
      .map((participant) => participant.id),
  );
  const emptyString = storedBytes("");
  const turns = session.turns.map((turn) => {
    if (size <= budget || isUnsettledTurn(turn)) return turn;
    if (!turn.prompt || xaiSeats.has(turn.participantId)) return turn;
    size -= storedBytes(turn.prompt) - emptyString;
    return { ...turn, prompt: "" };
  });
  if (size <= budget) return { ...session, turns };
  const pinned = pinnedNoteIds(session, turns);
  const dropped = new Set<string>();
  for (const note of session.notes) {
    if (size <= budget) break;
    if (pinned.has(note.id)) continue;
    const replies = turns.filter((turn) => turn.noteId === note.id);
    // Still being answered, or not answered yet: keep it and everything after.
    if (replies.some(isUnsettledTurn) || (replies.length === 0 && !note.halted)) break;
    dropped.add(note.id);
    for (const item of [note, ...replies]) size -= storedBytes(item) + 2; // + the comma
  }
  return {
    ...session,
    notes: session.notes.filter((note) => !dropped.has(note.id)),
    turns: turns.filter((turn) => turn.noteId === undefined || !dropped.has(turn.noteId)),
  };
}

/**
 * What goes to disk, always within {@link STORED_BYTE_BUDGET}, so a save never
 * stops: running and paused sessions and every open chat (the user still has
 * them, idle or stopped), then the newest finished ones that fit. When
 * the kept ones alone are over the budget, the oldest open chats lose more of
 * their oldest messages, and only then are whole sessions left out, oldest
 * first.
 */
export function retainForStorage(
  sessions: Record<string, RoundtableSession>,
): Record<string, RoundtableSession> {
  const ordered = Object.values(sessions)
    .toSorted((left, right) => right.updatedAt - left.updatedAt)
    .map((stored) => {
      const session = compactOpenSession(stored);
      return { session, cost: storedBytes(session) };
    });
  const isKeptAlways = ({ session }: { session: RoundtableSession }) =>
    session.pattern === "open" || session.status === "running" || session.status === "paused";
  const always = ordered.filter(isKeptAlways);
  let size = always.reduce((total, entry) => total + entry.cost, 0);
  for (const entry of always.toReversed()) {
    if (size <= STORED_BYTE_BUDGET) break;
    const session = compactOpenSession(entry.session, entry.cost - (size - STORED_BYTE_BUDGET));
    const cost = storedBytes(session);
    size -= entry.cost - cost;
    entry.session = session;
    entry.cost = cost;
  }
  const left = new Set<string>();
  for (const entry of always.toReversed()) {
    if (size <= STORED_BYTE_BUDGET) break;
    left.add(entry.session.id);
    size -= entry.cost;
  }
  const kept: Record<string, RoundtableSession> = {};
  for (const { session } of always) if (!left.has(session.id)) kept[session.id] = session;
  let finished = 0;
  for (const entry of ordered) {
    if (isKeptAlways(entry) || finished >= MAX_STORED_SESSIONS) continue;
    if (size + entry.cost > STORED_BYTE_BUDGET) continue;
    finished += 1;
    size += entry.cost;
    kept[entry.session.id] = entry.session;
  }
  return kept;
}

/** Migrates any stored shape to version 1 (and tolerates a newer build's records). */
export function migrateRoundtableState(
  persisted: unknown,
  _version: number,
): PersistedRoundtableState {
  const state = isRecord(persisted) ? persisted : {};
  return { sessions: sanitizeSessions(state.sessions) };
}

let settleHydration: (() => void) | undefined;
const hydrationSettled = new Promise<void>((resolve) => {
  settleHydration = resolve;
});

export const useRoundtableStore = create<RoundtableStoreState>()(
  persist(
    (set) => ({
      sessions: {},
      putSession: (session) =>
        set((state) => ({ sessions: { ...state.sessions, [session.id]: session } })),
      updateSession: (sessionId, update) =>
        set((state) => {
          const current = state.sessions[sessionId];
          if (!current) return state;
          const next = update(current);
          if (next === current) return state;
          return {
            sessions: {
              ...state.sessions,
              [sessionId]: {
                ...next,
                turns: next.turns.map(capTurnForStorage),
                updatedAt: Date.now(),
              },
            },
          };
        }),
      removeSession: (sessionId) =>
        set((state) => {
          if (!(sessionId in state.sessions)) return state;
          const { [sessionId]: _removed, ...sessions } = state.sessions;
          return { sessions };
        }),
    }),
    {
      name: ROUNDTABLE_STORE_NAME,
      version: ROUNDTABLE_STORE_VERSION,
      storage: createDbStorage<PersistedRoundtableState>(),
      migrate: migrateRoundtableState,
      merge: (persisted, current) => ({
        ...current,
        // Sessions created before hydration finished (none should be: the
        // engine waits) win over stored copies with the same id.
        sessions: {
          ...sanitizeSessions(isRecord(persisted) ? persisted.sessions : undefined),
          ...current.sessions,
        },
      }),
      partialize: (state) => ({ sessions: retainForStorage(state.sessions) }),
      onRehydrateStorage: () => (_state, error) => {
        if (error) console.warn("[roundtable] could not restore saved Roundtables", error);
        settleHydration?.();
      },
    },
  ),
);

/**
 * Resolves once the stored sessions were loaded (or loading failed). The
 * engine waits for it before resuming or writing anything, so a fresh write
 * never overwrites sessions that were still loading.
 */
export function waitForRoundtableHydration(): Promise<void> {
  if (useRoundtableStore.persist.hasHydrated()) return Promise.resolve();
  return hydrationSettled;
}
