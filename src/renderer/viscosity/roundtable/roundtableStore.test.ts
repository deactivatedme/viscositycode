import { describe, expect, it, vi } from "vitest";
import { agentSeat, makeSession } from "./engine/testFixtures";
import {
  capTurnForStorage,
  MAX_STORED_SESSIONS,
  migrateRoundtableState,
  retainForStorage,
  ROUNDTABLE_STORE_NAME,
  ROUNDTABLE_STORE_VERSION,
  sanitizeSession,
  useRoundtableStore,
  waitForRoundtableHydration,
} from "./roundtableStore";
import type { RoundtableSession, RoundtableTurn } from "./types";

vi.mock("@/renderer/state/dbStorage", () => ({
  createDbStorage: () => ({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  }),
}));

const seats = [agentSeat("a", "Alpha", "builder"), agentSeat("b", "Beta", "reviewer")];

function turn(overrides: Partial<RoundtableTurn> = {}): RoundtableTurn {
  return {
    id: "t1",
    participantId: "a",
    round: 0,
    prompt: "p",
    status: "done",
    phase: "build",
    ...overrides,
  };
}

describe("roundtable store persistence", () => {
  it("persists through the local backend under a versioned poracode-* name", () => {
    const options = useRoundtableStore.persist.getOptions();
    expect(options.name).toBe(ROUNDTABLE_STORE_NAME);
    expect(ROUNDTABLE_STORE_NAME.startsWith("poracode-")).toBe(true);
    expect(options.version).toBe(ROUNDTABLE_STORE_VERSION);
  });

  it("stores sessions only, never live state", () => {
    const options = useRoundtableStore.persist.getOptions();
    const session = makeSession("build-review", seats);
    const persisted = options.partialize!({
      ...useRoundtableStore.getState(),
      sessions: { [session.id]: session },
    });
    expect(Object.keys(persisted as object)).toEqual(["sessions"]);
  });

  it("migrates an older or foreign shape by dropping malformed records one by one", () => {
    const good = makeSession("debate", seats, { id: "good" });
    const migrated = migrateRoundtableState(
      {
        sessions: {
          good,
          noPattern: { ...good, id: "noPattern", pattern: "brainstorm" },
          badParticipant: { ...good, id: "badParticipant", participants: [{ id: "x" }] },
          notAnObject: 42,
        },
        somethingElse: true,
      },
      0,
    );
    expect(Object.keys(migrated.sessions)).toEqual(["good"]);
    expect(migrateRoundtableState(undefined, 0)).toEqual({ sessions: {} });
    expect(migrateRoundtableState({ sessions: [] }, 2)).toEqual({ sessions: {} });
  });

  it("keeps valid turns and notes and fills missing defaults", () => {
    const raw = {
      ...makeSession("open", seats),
      title: undefined,
      threadIds: { a: "thread-a", b: 7 },
      turns: [turn(), { id: "broken" }],
      notes: [{ id: "n1", text: "hi", createdAt: 1 }, { text: "no id" }],
    };
    const session = sanitizeSession(raw)!;
    expect(session.title).toBe("");
    expect(session.threadIds).toEqual({ a: "thread-a" });
    expect(session.turns.map((item) => item.id)).toEqual(["t1"]);
    expect(session.notes?.map((note) => note.id)).toEqual(["n1"]);
  });

  it("caps stored answers and prompts with a truncated marker", () => {
    const capped = capTurnForStorage(
      turn({ responseText: "x".repeat(50_000), prompt: "y".repeat(30_000) }),
    );
    expect(capped.truncated).toBe(true);
    expect(capped.responseText!.length).toBeLessThanOrEqual(20_000);
    expect(capped.responseText).toContain("characters truncated");
    expect(capped.prompt.length).toBeLessThanOrEqual(8_000);
    const small = turn({ responseText: "ok" });
    expect(capTurnForStorage(small)).toBe(small);
  });

  it("keeps active sessions and the newest finished ones on disk", () => {
    const sessions: Record<string, RoundtableSession> = {};
    for (let index = 0; index < MAX_STORED_SESSIONS + 5; index += 1) {
      const id = `done-${index}`;
      sessions[id] = makeSession("relay", seats, { id, status: "done", updatedAt: index });
    }
    sessions.running = makeSession("relay", seats, {
      id: "running",
      status: "running",
      updatedAt: -1,
    });
    const kept = retainForStorage(sessions);
    expect(kept.running).toBeDefined();
    expect(kept["done-0"]).toBeUndefined();
    expect(kept[`done-${MAX_STORED_SESSIONS + 4}`]).toBeDefined();
    expect(Object.keys(kept)).toHaveLength(MAX_STORED_SESSIONS + 1);
  });

  it("updates stamp the time and cap turns; removes are clean", async () => {
    await waitForRoundtableHydration();
    const store = useRoundtableStore.getState();
    store.putSession(makeSession("build-review", seats, { id: "s-update" }));
    store.updateSession("s-update", (session) => ({
      ...session,
      turns: [turn({ responseText: "z".repeat(30_000) })],
    }));
    const updated = useRoundtableStore.getState().sessions["s-update"]!;
    expect(updated.updatedAt).toBeGreaterThan(0);
    expect(updated.turns[0]!.truncated).toBe(true);
    store.updateSession("missing", (session) => ({ ...session, title: "x" }));
    expect(useRoundtableStore.getState().sessions.missing).toBeUndefined();
    store.removeSession("s-update");
    expect(useRoundtableStore.getState().sessions["s-update"]).toBeUndefined();
  });

  it("merges stored sessions through the same sanitizer on hydration", () => {
    const options = useRoundtableStore.persist.getOptions();
    const merged = options.merge!(
      { sessions: { ok: makeSession("race", seats, { id: "ok" }), bad: { id: "bad" } } },
      useRoundtableStore.getState(),
    );
    expect(Object.keys(merged.sessions)).toContain("ok");
    expect(Object.keys(merged.sessions)).not.toContain("bad");
  });
});
