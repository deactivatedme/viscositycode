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

  it("loads every record a pre-compare build wrote, unchanged (pre-upgrade blob)", () => {
    // Literal JSON as the build before the AA compare pattern persisted it
    // (store version 1): one record per pattern that build knew, with the
    // optional RT1 fields it wrote. No seededFromSessionId, no compare.
    const claude = {
      id: "p-claude",
      label: "Claude · Opus",
      role: "builder",
      brain: { kind: "agent", agentKind: "kind-a", model: "m-a", presentationMode: "gui" },
    };
    const codex = {
      id: "p-codex",
      label: "Codex",
      role: "reviewer",
      brain: { kind: "agent", agentKind: "kind-b", model: "m-b", presentationMode: "terminal" },
    };
    const grok = {
      id: "p-grok",
      label: "Grok bot",
      role: "member",
      instructions: "Be brief.",
      avatar: { glyph: "G", color: "#7c3aed" },
      brain: {
        kind: "xai",
        model: "grok-4.7",
        region: "global",
        tools: { webSearch: true, xSearch: false },
      },
    };
    const persisted = {
      state: {
        sessions: {
          "rt-build": {
            id: "rt-build",
            version: 1,
            title: "Fix login",
            task: "Fix the login bug.",
            pattern: "build-review",
            projectId: "project-1",
            worktreePath: "/repo/.worktrees/rt-build",
            worktreeBranch: "roundtable/rt-build",
            participants: [claude, codex],
            threadIds: { "p-claude": "thread-1", "p-codex": "thread-2" },
            maxRounds: 3,
            status: "done",
            turns: [
              {
                id: "t-1",
                participantId: "p-claude",
                round: 1,
                prompt: "Build it.",
                status: "done",
                phase: "build",
                responseText: "Done.",
                startedAt: 10,
                endedAt: 20,
              },
              {
                id: "t-2",
                participantId: "p-codex",
                round: 1,
                prompt: "Review it.",
                status: "done",
                phase: "review",
                responseText: "LGTM",
                verdict: "approve",
                truncated: true,
              },
            ],
            outcome: { reason: "approved" },
            originThreadId: "thread-0",
            createdAt: 1,
            updatedAt: 30,
          },
          "rt-debate": {
            id: "rt-debate",
            version: 1,
            title: "Pick a store",
            task: "Which store?",
            pattern: "debate",
            projectId: "project-1",
            participants: [claude, codex, grok],
            threadIds: { "p-claude": "thread-3", "p-codex": "thread-4" },
            maxRounds: 1,
            status: "running",
            implementWinner: true,
            winnerParticipantId: "p-claude",
            turns: [
              {
                id: "t-3",
                participantId: "p-grok",
                round: 0,
                prompt: "Propose.",
                status: "running",
                phase: "propose",
              },
              {
                id: "t-4",
                participantId: "p-codex",
                round: 1,
                prompt: "Pick one.",
                status: "done",
                phase: "decide",
                verdict: "pick",
                pickedParticipantId: "p-claude",
              },
            ],
            notes: [{ id: "n-1", text: "Prefer SQLite.", createdAt: 5, deliveredTurnId: "t-3" }],
            createdAt: 2,
            updatedAt: 40,
          },
          "rt-relay": {
            id: "rt-relay",
            version: 1,
            title: "Relay",
            task: "Plan, build, test.",
            pattern: "relay",
            projectId: "project-2",
            participants: [claude, codex],
            threadIds: {},
            maxRounds: 3,
            status: "failed",
            error: "The agent stopped responding.",
            turns: [
              {
                id: "t-5",
                participantId: "p-claude",
                round: 1,
                prompt: "Plan.",
                status: "failed",
                phase: "plan",
                error: "boom",
              },
            ],
            createdAt: 3,
            updatedAt: 50,
          },
          "rt-race": {
            id: "rt-race",
            version: 1,
            title: "Race",
            task: "Fastest fix.",
            pattern: "race",
            projectId: "project-1",
            experimentId: "experiment-1",
            participants: [claude, codex],
            threadIds: { "p-claude": "thread-5" },
            maxRounds: 1,
            status: "paused",
            turns: [
              {
                id: "t-6",
                participantId: "p-claude",
                round: 1,
                prompt: "Race.",
                status: "waiting-approval",
                phase: "race",
              },
            ],
            createdAt: 4,
            updatedAt: 60,
          },
          "rt-open": {
            id: "rt-open",
            version: 1,
            title: "Chat",
            task: "Talk.",
            pattern: "open",
            projectId: "project-1",
            participants: [claude, grok],
            threadIds: { "p-claude": "thread-6" },
            maxRounds: 0,
            status: "stopped",
            turns: [
              {
                id: "t-7",
                participantId: "p-grok",
                round: 0,
                prompt: "Reply.",
                status: "stopped",
                phase: "reply",
                noteId: "n-2",
              },
            ],
            notes: [{ id: "n-2", text: "@Grok hi", mentions: ["p-grok"], createdAt: 6 }],
            outcome: { reason: "completed" },
            createdAt: 5,
            updatedAt: 70,
          },
        },
      },
      version: 1,
    };
    const blob = JSON.parse(JSON.stringify(persisted)) as typeof persisted;
    const expected = persisted.state.sessions;
    // Same version: zustand skips migrate and hydrates through merge.
    const options = useRoundtableStore.persist.getOptions();
    const merged = options.merge!(blob.state, { ...useRoundtableStore.getState(), sessions: {} });
    expect(merged.sessions).toEqual(expected);
    // Any other stored version goes through migrate, with the same result.
    expect(migrateRoundtableState(blob.state, blob.version).sessions).toEqual(expected);
    expect(migrateRoundtableState(blob.state, 0).sessions).toEqual(expected);
    expect(ROUNDTABLE_STORE_VERSION).toBe(blob.version);
  });

  it("keeps compare sessions and debates seeded from them (additive AA compare records)", () => {
    // A record as this build writes it, read back by the same store version.
    const compare = makeSession("compare", seats, {
      id: "cmp",
      status: "done",
      maxRounds: 1,
      outcome: { reason: "compared" },
      turns: [turn({ phase: "answer", responseText: "Use a schema" })],
    });
    const debate = makeSession("debate", seats, {
      id: "deb",
      seededFromSessionId: "cmp",
      turns: [turn({ id: "t2", phase: "propose", responseText: "Use a schema" })],
    });
    const migrated = migrateRoundtableState(
      { sessions: JSON.parse(JSON.stringify({ cmp: compare, deb: debate })) },
      ROUNDTABLE_STORE_VERSION,
    );
    expect(migrated.sessions).toEqual({ cmp: compare, deb: debate });
    // A pre-compare record (no seed field) still loads unchanged.
    const plain = makeSession("debate", seats, { id: "plain" });
    expect(sanitizeSession(JSON.parse(JSON.stringify(plain)))).toEqual(plain);
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
