import { describe, expect, it, vi } from "vitest";
import { planNextStep } from "./engine/planner";
import { agentSeat, makeSession } from "./engine/testFixtures";
import {
  estimateCacheValueBytes,
  MAX_BROWSER_METADATA_RECORD_BYTES,
} from "@/renderer/state/browserMetadataCacheProjection";
import { projectJsonBytes } from "@/renderer/state/remote/engine/jsonProjection";
import { CLIENT_ENGINE_AUX_STRINGIFY_MAX_BYTES } from "@/renderer/state/remote/engine/protocol";
import {
  capTurnForStorage,
  compactOpenSession,
  MAX_STORED_SESSIONS,
  OPEN_SESSION_BYTE_BUDGET,
  migrateRoundtableState,
  retainForStorage,
  ROUNDTABLE_STORE_NAME,
  ROUNDTABLE_STORE_VERSION,
  sanitizeSession,
  STORED_BYTE_BUDGET,
  storedBytes,
  useRoundtableStore,
  waitForRoundtableHydration,
} from "./roundtableStore";
import type { ParticipantProfile, RoundtableSession, RoundtableTurn } from "./types";

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

  it("loads an open chat written before Work together unchanged (pre-upgrade blob)", () => {
    // Literal JSON as the build before Work together persisted it (store
    // version 1): task equal to the first message, a stopped reply, per-seat
    // instructions, none of the new optional fields.
    const blob = JSON.parse(`{
      "sessions": {
        "chat": {
          "id": "chat", "version": 1, "title": "Plan the login", "task": "Plan the login",
          "pattern": "open", "projectId": "project-1",
          "participants": [
            { "id": "a", "label": "Alpha", "role": "member",
              "brain": { "kind": "agent", "agentKind": "kind-a", "model": "m", "presentationMode": "gui" },
              "instructions": "Focus on the backend." },
            { "id": "b", "label": "Beta", "role": "member",
              "brain": { "kind": "agent", "agentKind": "kind-b", "model": "m", "presentationMode": "gui" } }
          ],
          "threadIds": { "a": "thread-a" }, "maxRounds": 0, "status": "running",
          "turns": [
            { "id": "t1", "participantId": "a", "round": 0, "phase": "reply", "prompt": "p",
              "status": "stopped", "startedAt": 2, "endedAt": 3, "noteId": "n1" }
          ],
          "notes": [{ "id": "n1", "text": "Plan the login", "createdAt": 1 }],
          "createdAt": 1, "updatedAt": 3
        }
      }
    }`);
    const expected = structuredClone(blob.sessions);
    const migrated = migrateRoundtableState(blob, ROUNDTABLE_STORE_VERSION);
    expect(migrated.sessions).toEqual(expected);
    // As before, the stopped reply is asked again; the duplicated topic is gone.
    const plan = planNextStep(migrated.sessions.chat!);
    expect(plan.kind).toBe("run");
    const prompt = plan.kind === "run" ? plan.turns[0]!.prompt : "";
    expect(plan.kind === "run" && plan.turns[0]!.participantId).toBe("a");
    expect(prompt).not.toContain("The topic of this chat");
    expect(prompt).toContain("Your own instructions:\nFocus on the backend.");
    expect(prompt).toContain("The user's latest message:\nPlan the login");
  });

  it("keeps the Work together fields and drops malformed ones", () => {
    const valid = makeSession("open", [{ ...seats[0]!, joinedAt: 5 }, seats[1]!], {
      id: "valid",
      instructions: "Be brief.",
      instructionsUpdatedAt: 9,
      instructionsUpdatedFor: { a: 9 },
      notes: [{ id: "n1", text: "hi", createdAt: 1, halted: true }],
      turns: [turn({ phase: "reply", status: "running", unsent: true, noteId: "n1" })],
    });
    expect(sanitizeSession(JSON.parse(JSON.stringify(valid)))).toEqual(valid);
    const malformed = sanitizeSession({
      ...valid,
      instructions: 42,
      instructionsUpdatedAt: "soon",
      instructionsUpdatedFor: { a: "soon", b: Number.NaN } as never,
      participants: [{ ...seats[0]!, joinedAt: "x", instructions: 7 }, seats[1]!],
      notes: [{ id: "n1", text: "hi", createdAt: 1, halted: "yes" }],
      turns: [turn({ unsent: "yes" as never })],
    })!;
    expect(malformed).not.toHaveProperty("instructions");
    expect(malformed).not.toHaveProperty("instructionsUpdatedAt");
    expect(malformed).not.toHaveProperty("instructionsUpdatedFor");
    expect(
      sanitizeSession({ ...valid, instructionsUpdatedFor: { a: 3, b: "x" } })!
        .instructionsUpdatedFor,
    ).toEqual({ a: 3 });
    expect(sanitizeSession({ ...valid, instructionsUpdatedFor: [4] })).not.toHaveProperty(
      "instructionsUpdatedFor",
    );
    expect(malformed.participants[0]).toEqual(seats[0]);
    expect(malformed.notes?.[0]).toEqual({ id: "n1", text: "hi", createdAt: 1 });
    expect(malformed.turns[0]).not.toHaveProperty("unsent");
  });

  it("loads a Roundtable written before Playbooks unchanged (pre-upgrade blob)", () => {
    // Literal JSON as the build before Playbooks persisted it (store version
    // 1): shared and per-seat instructions, no playbook fields.
    const blob = JSON.parse(`{
      "sessions": {
        "rt": {
          "id": "rt", "version": 1, "title": "Fix login", "task": "Fix login",
          "pattern": "build-review", "projectId": "project-1",
          "instructions": "Keep it small.", "instructionsUpdatedFor": { "a": 4 },
          "participants": [
            { "id": "a", "label": "Alpha", "role": "builder",
              "brain": { "kind": "agent", "agentKind": "kind-a", "model": "m", "presentationMode": "gui" },
              "instructions": "Backend only." },
            { "id": "b", "label": "Beta", "role": "reviewer",
              "brain": { "kind": "xai", "model": "grok", "region": "global",
                "tools": { "webSearch": false, "xSearch": false } } }
          ],
          "threadIds": {}, "maxRounds": 4, "status": "running", "turns": [],
          "createdAt": 1, "updatedAt": 4
        }
      }
    }`);
    const expected = structuredClone(blob.sessions);
    const migrated = migrateRoundtableState(blob, ROUNDTABLE_STORE_VERSION);
    expect(migrated.sessions).toEqual(expected);
    expect(migrated.sessions.rt).not.toHaveProperty("playbookId");
    expect(migrated.sessions.rt!.participants[0]).not.toHaveProperty("playbookId");
  });

  it("keeps the Playbooks fields and drops malformed ones", () => {
    const valid = makeSession(
      "open",
      [
        { ...seats[0]!, playbookId: "review" },
        { ...seats[1]!, playbookId: null },
      ],
      { id: "valid", playbookId: "reversing" },
    );
    expect(sanitizeSession(JSON.parse(JSON.stringify(valid)))).toEqual(valid);
    const malformed = sanitizeSession({
      ...valid,
      playbookId: "Not An Id",
      participants: [
        { ...seats[0]!, playbookId: 7 as never },
        { ...seats[1]!, playbookId: "" },
      ],
    })!;
    expect(malformed).not.toHaveProperty("playbookId");
    expect(malformed.participants).toEqual(seats);
  });

  it("counts shared and per-seat instructions in the stored size", () => {
    const plain = makeSession("open", seats);
    const instructed = makeSession(
      "open",
      [{ ...seats[0]!, instructions: "x".repeat(500) }, seats[1]!],
      {
        instructions: "y".repeat(1_000),
      },
    );
    // 2 bytes per character, plus the keys.
    expect(storedBytes(instructed) - storedBytes(plain)).toBeGreaterThan(3_000);
  });

  it("keeps every open chat on disk, outside the finished count", () => {
    // An idle chat, a stopped one, then more newer Ask-all compares than the cap.
    const sessions: Record<string, RoundtableSession> = {
      idle: makeSession("open", seats, { id: "idle", updatedAt: 0 }),
      stopped: makeSession("open", seats, { id: "stopped", status: "stopped", updatedAt: 1 }),
    };
    for (let index = 0; index < MAX_STORED_SESSIONS + 2; index += 1) {
      const id = `compare-${index}`;
      sessions[id] = makeSession("compare", seats, { id, status: "done", updatedAt: index + 10 });
    }
    const kept = retainForStorage(sessions);
    expect(kept.idle).toBeDefined();
    expect(kept.stopped).toBeDefined();
    expect(kept["compare-0"]).toBeUndefined();
    expect(kept[`compare-${MAX_STORED_SESSIONS + 1}`]).toBeDefined();
    expect(Object.keys(kept)).toHaveLength(MAX_STORED_SESSIONS + 2);
  });

  it("saves a long open chat without its oldest answered messages", () => {
    const big = "z".repeat(15_000);
    const notes = Array.from({ length: 120 }, (_, index) => ({
      id: `n${index}`,
      text: `message ${index}`,
      createdAt: index,
    }));
    const turns = notes.map((note, index) =>
      turn({ id: `t${index}`, phase: "reply", noteId: note.id, responseText: big }),
    );
    const session = makeSession("open", seats, { notes, turns });
    const compacted = compactOpenSession(session);
    expect(storedBytes(compacted)).toBeLessThanOrEqual(OPEN_SESSION_BYTE_BUDGET);
    expect(compacted.notes!.at(-1)!.id).toBe("n119");
    expect(compacted.notes![0]!.id).not.toBe("n0");
    const keptNotes = new Set(compacted.notes!.map((note) => note.id));
    expect(compacted.turns.every((item) => keptNotes.has(item.noteId!))).toBe(true);
    expect(compactOpenSession(makeSession("open", seats))).toEqual(makeSession("open", seats));
  });

  it("leaves out old prompts before any message, but keeps xAI prompts", () => {
    const grok: ParticipantProfile = {
      ...agentSeat("g", "Grok"),
      brain: {
        kind: "xai",
        model: "grok-4.7",
        region: "global",
        tools: { webSearch: false, xSearch: false },
      },
    };
    const prompt = "p".repeat(8_000);
    const notes = Array.from({ length: 120 }, (_, index) => ({
      id: `n${index}`,
      text: `message ${index}`,
      createdAt: index,
    }));
    const turns = notes.flatMap((note, index) => [
      turn({ id: `a${index}`, phase: "reply", noteId: note.id, prompt, responseText: "ok" }),
      turn({ id: `b${index}`, participantId: "b", phase: "reply", noteId: note.id, prompt }),
      turn({ id: `g${index}`, participantId: "g", phase: "reply", noteId: note.id, prompt }),
    ]);
    const session = makeSession("open", [...seats, grok], { notes, turns });
    expect(storedBytes(session)).toBeGreaterThan(OPEN_SESSION_BYTE_BUDGET);
    const compacted = compactOpenSession(session);
    expect(storedBytes(compacted)).toBeLessThanOrEqual(OPEN_SESSION_BYTE_BUDGET);
    expect(compacted.notes).toHaveLength(120);
    expect(compacted.turns).toHaveLength(360);
    expect(compacted.turns[0]!.prompt).toBe("");
    expect(compacted.turns.filter((item) => item.participantId === "g")).toEqual(
      turns.filter((item) => item.participantId === "g"),
    );
    expect(compacted.turns.at(-2)!.prompt).toBe(prompt);
  });

  /** Both backends refuse a write over 8 MiB: SQLite via the projection, the browser cache per record. */
  function fitsBackendWrite(sessions: Record<string, RoundtableSession>): boolean {
    const value = { state: { sessions }, version: ROUNDTABLE_STORE_VERSION };
    return (
      projectJsonBytes(value, CLIENT_ENGINE_AUX_STRINGIFY_MAX_BYTES).ok &&
      estimateCacheValueBytes(value) <= MAX_BROWSER_METADATA_RECORD_BYTES
    );
  }

  /** Code-heavy text: quotes, backslashes and newlines all need JSON escapes. */
  const code = (length: number) =>
    'if (a) { return "\\\\path\\n"; }\n\t'.repeat(Math.ceil(length / 30)).slice(0, length);

  function finishedDebates(count: number): Record<string, RoundtableSession> {
    const sessions: Record<string, RoundtableSession> = {};
    for (let index = 0; index < count; index += 1) {
      const id = `debate-${index}`;
      sessions[id] = makeSession("debate", seats, {
        id,
        status: "done",
        updatedAt: 100 + index,
        turns: Array.from({ length: 6 }, (_, round) =>
          turn({ id: `${id}-${round}`, round, prompt: code(2_000), responseText: code(18_000) }),
        ),
      });
    }
    return sessions;
  }

  function longChat(id: string, updatedAt: number, messages: number): RoundtableSession {
    const notes = Array.from({ length: messages }, (_, index) => ({
      id: `${id}-n${index}`,
      text: `message ${index}`,
      createdAt: index * 10,
    }));
    const turns = notes.map((note, index) =>
      turn({
        id: `${id}-t${index}`,
        phase: "reply",
        noteId: note.id,
        responseText: code(15_000),
        startedAt: index * 10 + 1,
        endedAt: index * 10 + 2,
      }),
    );
    return makeSession("open", seats, { id, updatedAt, notes, turns });
  }

  it("keeps every save under the backend's 8 MiB write limit, newest first", () => {
    const sessions = {
      ...finishedDebates(40),
      chatA: longChat("chatA", 1, 60),
      chatB: longChat("chatB", 2, 60),
    };
    expect(fitsBackendWrite(sessions)).toBe(false);
    const kept = retainForStorage(sessions);
    expect(fitsBackendWrite(kept)).toBe(true);
    expect(storedBytes(kept)).toBeLessThanOrEqual(STORED_BYTE_BUDGET);
    // The open chats stay; finished runs fill what is left, newest first.
    expect(kept.chatA).toBeDefined();
    expect(kept.chatB).toBeDefined();
    expect(kept["debate-39"]).toBeDefined();
    expect(kept["debate-0"]).toBeUndefined();
  });

  it("trims a blob an older build saved over the new budget on the next write (pre-upgrade)", () => {
    // What the 6M-character budget let through: every record kept, over 8 MiB projected.
    const blob = JSON.parse(
      JSON.stringify({ sessions: { ...finishedDebates(40), chat: longChat("chat", 1, 40) } }),
    );
    const migrated = migrateRoundtableState(blob, ROUNDTABLE_STORE_VERSION);
    expect(Object.keys(migrated.sessions)).toHaveLength(41);
    expect(fitsBackendWrite(migrated.sessions)).toBe(false);
    const kept = retainForStorage(migrated.sessions);
    expect(fitsBackendWrite(kept)).toBe(true);
    expect(kept.chat).toEqual(migrated.sessions.chat);
    expect(kept["debate-39"]).toEqual(migrated.sessions["debate-39"]);
  });

  it("shortens the oldest open chats before leaving any session out", () => {
    const chats: Record<string, RoundtableSession> = {};
    for (let index = 0; index < 5; index += 1)
      chats[`chat-${index}`] = longChat(`chat-${index}`, index, 50);
    expect(storedBytes(chats["chat-0"])).toBeLessThan(OPEN_SESSION_BYTE_BUDGET);
    const kept = retainForStorage(chats);
    expect(Object.keys(kept).toSorted()).toEqual(Object.keys(chats).toSorted());
    expect(fitsBackendWrite(kept)).toBe(true);
    expect(kept["chat-4"]).toEqual(chats["chat-4"]);
    expect(kept["chat-0"]!.notes!.length).toBeLessThan(50);
    expect(kept["chat-0"]!.notes!.at(-1)!.id).toBe("chat-0-n49");

    // Sessions that cannot be shortened: the oldest is left out, the rest still save.
    const running: Record<string, RoundtableSession> = {};
    for (let index = 0; index < 4; index += 1) {
      const id = `run-${index}`;
      running[id] = makeSession("debate", seats, {
        id,
        updatedAt: index,
        turns: Array.from({ length: 60 }, (_, round) =>
          turn({ id: `${id}-${round}`, round, responseText: code(18_000) }),
        ),
      });
    }
    const keptRunning = retainForStorage(running);
    expect(fitsBackendWrite(keptRunning)).toBe(true);
    expect(keptRunning["run-0"]).toBeUndefined();
    expect(keptRunning["run-3"]).toBeDefined();
  });

  it("compacts an open chat without changing the prompts that follow", () => {
    const task = "Plan the login";
    const notes = Array.from({ length: 150 }, (_, index) => ({
      id: `n${index}`,
      text: index === 0 ? task : `message ${index}`,
      createdAt: index * 10,
      // Beta answers only message 1; every later one is for Alpha.
      ...(index === 1 ? { mentions: ["b"] } : index > 1 ? { mentions: ["a"] } : {}),
    }));
    const turns = notes.map((note, index) =>
      turn({
        id: `t${index}`,
        participantId: index === 1 ? "b" : "a",
        phase: "reply",
        noteId: note.id,
        prompt: "",
        responseText: code(15_000),
        startedAt: index * 10 + 1,
        endedAt: index * 10 + 2,
      }),
    );
    const instructed = [
      { ...seats[0]!, instructions: "Alpha rules." },
      { ...seats[1]!, instructions: "Beta rules." },
    ];
    const full = makeSession("open", instructed, { task, notes, turns });
    const compacted = compactOpenSession(full);
    const keptIds = compacted.notes!.map((note) => note.id);
    expect(keptIds).toContain("n0"); // the topic, so the task stays out of prompts
    expect(keptIds).toContain("n1"); // Beta's only reply, so Beta is not new again
    expect(keptIds).not.toContain("n2");
    expect(keptIds.slice(-6)).toEqual(notes.slice(-6).map((note) => note.id));

    const next = { id: "next", text: "What now?", createdAt: 10_000 };
    const withNext = (session: RoundtableSession) => ({
      ...session,
      notes: [...session.notes!, next],
    });
    const promptsOf = (session: RoundtableSession) => {
      const plan = planNextStep(session);
      return plan.kind === "run" ? plan.turns.map((planned) => planned.prompt) : [];
    };
    const alphaPrompt = promptsOf(withNext(full));
    expect(alphaPrompt).toHaveLength(1);
    expect(promptsOf(withNext(compacted))).toEqual(alphaPrompt);
    expect(alphaPrompt[0]).not.toContain("The topic of this chat");

    const alphaAnswered = (session: RoundtableSession) => ({
      ...withNext(session),
      turns: [
        ...session.turns,
        turn({
          id: "t-next",
          phase: "reply",
          noteId: "next",
          responseText: "Alpha's answer",
          startedAt: 10_001,
          endedAt: 10_002,
        }),
      ],
    });
    const betaPrompt = promptsOf(alphaAnswered(full));
    expect(betaPrompt).toHaveLength(1);
    expect(promptsOf(alphaAnswered(compacted))).toEqual(betaPrompt);
    expect(betaPrompt[0]).not.toContain("Beta rules.");
  });
});
