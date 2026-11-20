/**
 * ViscosityCode: which Roundtable a chat's `@mentions` go to.
 *
 * The first message that mentions models starts an open-pattern
 * Roundtable with the chat as its origin; later mentions reuse it. The link
 * (chat thread id → Roundtable id + who is seated) is a per-viewer pointer,
 * not authoritative state: the engine owns the session, and a link whose
 * session the engine no longer lists is dropped and replaced. It therefore
 * lives in this renderer's local storage (ARCHITECTURE_NOTES §8.6).
 *
 * Storage format v1 (`viscosity:roundtable-chat-links`, zustand persist
 * envelope): `{ links: Record<threadId, { sessionId, participants, updatedAt }> }`.
 * An unreadable or newer envelope starts empty.
 */
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { RoundtableSummary } from "../api";
import type { ParticipantProfile } from "../types";

export const ROUNDTABLE_CHAT_LINKS_STORAGE_KEY = "viscosity:roundtable-chat-links";
const STORAGE_VERSION = 1;
/** Oldest links are dropped past this many chats. */
export const MAX_ROUNDTABLE_CHAT_LINKS = 200;

export interface RoundtableChatLink {
  sessionId: string;
  /** Everyone seated, the chat's own agent (seat 0) included. */
  participants: ParticipantProfile[];
  updatedAt: number;
}

interface RoundtableChatLinksState {
  links: Record<string, RoundtableChatLink>;
}

function safeLocalStorage(): Storage {
  try {
    if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
  } catch {
    // Blocked storage: fall through to an in-memory stand-in.
  }
  const memory = new Map<string, string>();
  return {
    get length() {
      return memory.size;
    },
    clear: () => memory.clear(),
    getItem: (key) => memory.get(key) ?? null,
    key: (index) => [...memory.keys()][index] ?? null,
    removeItem: (key) => void memory.delete(key),
    setItem: (key, value) => void memory.set(key, value),
  };
}

export const useRoundtableChatLinksStore = create<RoundtableChatLinksState>()(
  persist(() => ({ links: {} }), {
    name: ROUNDTABLE_CHAT_LINKS_STORAGE_KEY,
    version: STORAGE_VERSION,
    storage: createJSONStorage(safeLocalStorage),
    partialize: (state) => ({ links: state.links }),
    // A newer build's envelope is not understood here: start empty rather than guess.
    migrate: () => ({ links: {} }),
  }),
);

export function getRoundtableChatLink(threadId: string): RoundtableChatLink | undefined {
  return useRoundtableChatLinksStore.getState().links[threadId];
}

export function setRoundtableChatLink(threadId: string, link: RoundtableChatLink): void {
  useRoundtableChatLinksStore.setState((state) => {
    const next = { ...state.links, [threadId]: link };
    const ids = Object.keys(next);
    if (ids.length > MAX_ROUNDTABLE_CHAT_LINKS) {
      const oldest = ids
        .toSorted((a, b) => next[a]!.updatedAt - next[b]!.updatedAt)
        .slice(0, ids.length - MAX_ROUNDTABLE_CHAT_LINKS);
      for (const id of oldest) delete next[id];
    }
    return { links: next };
  });
}

export function forgetRoundtableChatLink(threadId: string): void {
  if (!getRoundtableChatLink(threadId)) return;
  useRoundtableChatLinksStore.setState((state) => {
    const { [threadId]: _removed, ...rest } = state.links;
    return { links: rest };
  });
}

// ── Engine session snapshot ─────────────────────────────────────────────────
// The engine API exposes its sessions to React only (`useRoundtableList`). The
// always-mounted chat host mirrors that list here so the submit path, which
// runs outside React, can tell a live link from a stale one. No snapshot yet
// trusts links as-is; neither does an empty one until the list has been seen
// non-empty this run (before that the engine may still be hydrating). A
// failed post also drops the link.

let knownSessions: ReadonlyMap<string, Pick<RoundtableSummary, "status" | "pattern">> | null = null;
let sawSessions = false;

export function syncKnownRoundtables(list: readonly RoundtableSummary[]): void {
  knownSessions = new Map(
    list.map((summary) => [summary.id, { status: summary.status, pattern: summary.pattern }]),
  );
  if (list.length > 0) sawSessions = true;
}

/** Test helper. */
export function resetKnownRoundtables(): void {
  knownSessions = null;
  sawSessions = false;
}

/** Whether a linked session can still take messages. */
export function isReusableRoundtable(sessionId: string): boolean {
  if (knownSessions === null) return true;
  if (knownSessions.size === 0) return !sawSessions;
  const known = knownSessions.get(sessionId);
  if (known === undefined || known.status === "failed") return false;
  // Posting reopens a stopped team chat, so its link stays usable.
  return known.status !== "stopped" || known.pattern === "open";
}
