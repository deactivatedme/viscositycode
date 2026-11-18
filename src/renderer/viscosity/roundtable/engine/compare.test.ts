import { describe, expect, it } from "vitest";
import type { RoundtableSession, RoundtableTurn } from "../types";
import {
  answeredParticipants,
  canSeedDebate,
  compareAnswers,
  hasActiveSeededDebate,
  latestSeededDebate,
  seedDebateTurns,
  seedProblem,
  seedThreadIds,
  seedWorkspace,
} from "./compare";
import { agentSeat, harness, makeSession, said } from "./testFixtures";

function answer(participantId: string, overrides: Partial<RoundtableTurn> = {}): RoundtableTurn {
  return {
    id: `t-${participantId}-${overrides.status ?? "done"}`,
    participantId,
    round: 0,
    phase: "answer",
    prompt: `Prompt for ${participantId}`,
    status: "done",
    responseText: `Answer from ${participantId}`,
    startedAt: 100,
    endedAt: 200,
    ...overrides,
  };
}

const trio = [agentSeat("a", "Alpha"), agentSeat("b", "Beta"), agentSeat("c", "Gamma")];

function comparison(overrides: Partial<RoundtableSession> = {}): RoundtableSession {
  return makeSession("compare", trio, {
    id: "cmp",
    maxRounds: 1,
    status: "done",
    threadIds: { a: "thread-a", b: "thread-b", c: "thread-c" },
    worktreePath: "/repo",
    turns: [
      answer("a"),
      answer("b", { status: "failed", error: "quota", responseText: "" }),
      answer("c"),
    ],
    ...overrides,
  });
}

describe("compare answers", () => {
  it("lists one entry per seat, in seat order, with its newest answer", () => {
    const session = comparison({
      turns: [
        answer("c"),
        answer("a", { id: "old", status: "stopped" }),
        answer("a", { id: "new" }),
        // Other phases are never an answer.
        { ...answer("b"), id: "other", phase: "reply" },
      ],
    });
    expect(
      compareAnswers(session).map((entry) => [entry.participant.id, entry.turn?.id ?? null]),
    ).toEqual([
      ["a", "new"],
      ["b", null],
      ["c", "t-c-done"],
    ]);
    expect(answeredParticipants(session).map((participant) => participant.id)).toEqual(["a", "c"]);
  });
});

describe("seeding a debate", () => {
  it("needs a finished comparison and two answers from the debaters", () => {
    expect(seedProblem(comparison(), ["a", "c"])).toBeNull();
    expect(seedProblem(comparison({ pattern: "debate" }), ["a", "c"])).toBe("not-a-comparison");
    expect(seedProblem(comparison({ status: "running" }), ["a", "c"])).toBe("still-running");
    expect(seedProblem(comparison({ status: "paused" }), ["a", "c"])).toBe("still-running");
    expect(seedProblem(comparison({ status: "stopped" }), ["a", "c"])).toBeNull();
    // b's answer failed.
    expect(seedProblem(comparison(), ["a", "b"])).toBe("not-answered");
    expect(seedProblem(comparison(), ["a"])).toBe("too-few-answers");
  });

  it("offers a debate only when two answers are in and the comparison ended", () => {
    expect(canSeedDebate(comparison())).toBe(true);
    expect(canSeedDebate(comparison({ status: "running" }))).toBe(false);
    expect(
      canSeedDebate(comparison({ turns: [answer("a"), answer("b", { status: "failed" })] })),
    ).toBe(false);
  });

  it("turns each answer into a finished opening proposal", () => {
    let id = 0;
    const turns = seedDebateTurns(comparison(), [{ id: "a" }, { id: "c" }], () => `seed-${++id}`);
    expect(turns).toEqual([
      {
        id: "seed-1",
        participantId: "a",
        round: 0,
        phase: "propose",
        prompt: "Prompt for a",
        status: "done",
        responseText: "Answer from a",
        startedAt: 100,
        endedAt: 200,
      },
      {
        id: "seed-2",
        participantId: "c",
        round: 0,
        phase: "propose",
        prompt: "Prompt for c",
        status: "done",
        responseText: "Answer from c",
        startedAt: 100,
        endedAt: 200,
      },
    ]);
  });

  it("keeps each debater's thread and the comparison's checkout", () => {
    expect(seedThreadIds(comparison(), [{ id: "a" }, { id: "c" }])).toEqual({
      a: "thread-a",
      c: "thread-c",
    });
    expect(seedWorkspace(comparison({ worktreeBranch: "rt/cmp" }))).toEqual({
      worktreePath: "/repo",
      worktreeBranch: "rt/cmp",
    });
    const { worktreePath: _path, ...currentCheckout } = comparison();
    expect(seedWorkspace(currentCheckout)).toEqual({});
  });

  it("finds the newest debate seeded from a comparison and whether one is active", () => {
    const sessions = {
      d1: makeSession("debate", trio, {
        id: "d1",
        status: "done",
        createdAt: 10,
        seededFromSessionId: "cmp",
      }),
      d2: makeSession("debate", trio, {
        id: "d2",
        status: "running",
        createdAt: 20,
        seededFromSessionId: "cmp",
      }),
      other: makeSession("debate", trio, { id: "other", createdAt: 30 }),
    };
    expect(latestSeededDebate(sessions, "cmp")?.id).toBe("d2");
    expect(hasActiveSeededDebate(sessions, "cmp")).toBe(true);
    expect(hasActiveSeededDebate({ d1: sessions.d1 }, "cmp")).toBe(false);
    expect(latestSeededDebate(sessions, "missing")).toBeUndefined();
  });
});

describe("compare runs", () => {
  it("sends every answer in parallel and finishes when all are in, marking failures", async () => {
    const session = makeSession("compare", trio, { maxRounds: 1 });
    const {
      runner,
      session: current,
      log,
    } = harness(session, {
      a: () => said("Answer A"),
      b: () => Promise.reject(new Error("out of usage")),
      c: () => said("Answer C"),
    });
    await runner.kick(session.id);
    const result = current();
    // One batch: every answer started at the same moment.
    expect(new Set(result.turns.map((turn) => turn.startedAt)).size).toBe(1);
    expect(log.map((call) => call.participantId)).toEqual(["a", "b", "c"]);
    expect(result.turns.map((turn) => [turn.participantId, turn.phase, turn.status])).toEqual([
      ["a", "answer", "done"],
      ["b", "answer", "failed"],
      ["c", "answer", "done"],
    ]);
    expect(result.turns[1]!.error).toBe("out of usage");
    expect(result.status).toBe("done");
    expect(result.outcome).toEqual({ reason: "compared" });
    expect(result.winnerParticipantId).toBeUndefined();
  });
});
