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
import { createDbStorage } from "@/renderer/state/dbStorage";
import { capText, RESPONSE_TEXT_CAP, STORED_PROMPT_CAP } from "./engine/text";
import type { RoundtableNote, RoundtablePattern, RoundtableSession, RoundtableTurn } from "./types";

export const ROUNDTABLE_STORE_NAME = "poracode-viscosity-roundtables";
export const ROUNDTABLE_STORE_VERSION = 1;
/** Finished sessions kept on disk (newest first); running and paused ones are always kept. */
export const MAX_STORED_SESSIONS = 50;
/** Rough character budget for the stored blob (the backend skips writes over 8 MiB). */
export const STORED_CHARACTER_BUDGET = 6_000_000;

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

const PATTERNS: readonly RoundtablePattern[] = ["build-review", "debate", "relay", "race", "open"];
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
  return capTurnForStorage(value as unknown as RoundtableTurn);
}

function sanitizeNote(value: unknown): RoundtableNote | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "string" || typeof value.text !== "string") return null;
  if (typeof value.createdAt !== "number") return null;
  return value as unknown as RoundtableNote;
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
    ...(value as unknown as RoundtableSession),
    version: 1,
    title: typeof value.title === "string" ? value.title : "",
    participants,
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

function approximateSize(session: RoundtableSession): number {
  let size = 2_000 + session.task.length;
  for (const turn of session.turns)
    size += 300 + turn.prompt.length + (turn.responseText?.length ?? 0);
  for (const note of session.notes ?? []) size += 100 + note.text.length;
  return size;
}

/** What goes to disk: active sessions always, then the newest finished ones within budget. */
export function retainForStorage(
  sessions: Record<string, RoundtableSession>,
): Record<string, RoundtableSession> {
  const ordered = Object.values(sessions).toSorted(
    (left, right) => right.updatedAt - left.updatedAt,
  );
  const kept: Record<string, RoundtableSession> = {};
  let size = 0;
  let finished = 0;
  for (const session of ordered) {
    const active = session.status === "running" || session.status === "paused";
    const cost = approximateSize(session);
    if (!active && (finished >= MAX_STORED_SESSIONS || size + cost > STORED_CHARACTER_BUDGET))
      continue;
    if (!active) finished += 1;
    size += cost;
    kept[session.id] = session;
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
