import { describe, expect, it, vi } from "vitest";
import { sanitizeSession } from "../roundtableStore";
import type { RoundtablePattern, RoundtableTurn } from "../types";
import { buildDemoSession } from "./devHook";
import { groupTranscript, interpretTurn, planNextStep, seatedJudge } from "./planner";
import { agentSeat, makeSession } from "./testFixtures";

vi.mock("@/renderer/state/dbStorage", () => ({
  createDbStorage: () => ({ getItem: () => null, setItem: () => {}, removeItem: () => {} }),
}));

function doneTurn(overrides: Partial<RoundtableTurn>): RoundtableTurn {
  return {
    id: crypto.randomUUID(),
    participantId: "b",
    round: 0,
    prompt: "",
    status: "done",
    responseText: "text",
    ...overrides,
  };
}

const builderReviewer = [
  agentSeat("b", "Builder", "builder"),
  agentSeat("r", "Reviewer", "reviewer"),
];

describe("planNextStep", () => {
  it("resumes from stored turns alone", () => {
    const session = makeSession("build-review", builderReviewer, {
      turns: [
        doneTurn({ participantId: "b", phase: "build", responseText: "v1" }),
        doneTurn({ participantId: "r", phase: "review", verdict: "revise", responseText: "fix X" }),
      ],
    });
    const plan = planNextStep(session);
    expect(plan.kind).toBe("run");
    if (plan.kind !== "run") return;
    expect(plan.turns).toHaveLength(1);
    expect(plan.turns[0]).toMatchObject({ participantId: "b", round: 1, phase: "build" });
    expect(plan.turns[0]!.prompt).toContain("> fix X");
  });

  it("re-runs a stopped turn and fails on a failed one", () => {
    const stopped = makeSession("build-review", builderReviewer, {
      turns: [doneTurn({ phase: "build", status: "stopped" })],
    });
    const rerun = planNextStep(stopped);
    expect(rerun.kind === "run" && rerun.turns[0]!.phase).toBe("build");

    const failedTurn = doneTurn({ phase: "build", status: "failed", error: "boom" });
    const failed = makeSession("build-review", builderReviewer, { turns: [failedTurn] });
    expect(planNextStep(failed)).toEqual({
      kind: "finish",
      status: "failed",
      reason: "turn-failed",
      turnId: failedTurn.id,
    });
  });

  it("carries undelivered steering notes into the next prompts", () => {
    const session = makeSession("build-review", builderReviewer, {
      notes: [
        { id: "n1", text: "already used", createdAt: 1, deliveredTurnId: "x" },
        { id: "n2", text: "Keep it small", createdAt: 2 },
      ],
    });
    const plan = planNextStep(session);
    expect(plan.kind === "run" && plan.deliverNoteIds).toEqual(["n2"]);
    expect(plan.kind === "run" && plan.turns[0]!.prompt).toContain("- Keep it small");
    expect(plan.kind === "run" && plan.turns[0]!.prompt).not.toContain("already used");
  });

  it("asks for a race launch with every non-judge racer", () => {
    const session = makeSession("race", [
      agentSeat("a", "A"),
      agentSeat("b", "B"),
      agentSeat("j", "J", "judge"),
    ]);
    const plan = planNextStep(session);
    expect(plan).toMatchObject({ kind: "race-launch", participantIds: ["a", "b"] });
  });

  it("is idle in an open chat with no new message, and ignores unknown mentions", () => {
    const seats = [agentSeat("a", "A"), agentSeat("b", "B")];
    expect(planNextStep(makeSession("open", seats)).kind).toBe("idle");
    const plan = planNextStep(
      makeSession("open", seats, {
        notes: [{ id: "n", text: "hi", mentions: ["ghost"], createdAt: 1 }],
      }),
    );
    // An unknown mention falls back to everyone, in seating order.
    expect(plan.kind === "run" && plan.turns.map((turn) => turn.participantId)).toEqual(["a"]);
  });

  it("only seats a judge when two others remain", () => {
    expect(seatedJudge([agentSeat("a", "A"), agentSeat("j", "J", "judge")])).toBeUndefined();
    expect(
      seatedJudge([agentSeat("a", "A"), agentSeat("b", "B"), agentSeat("j", "J", "judge")])?.id,
    ).toBe("j");
  });
});

describe("interpretTurn", () => {
  const session = makeSession("debate", [agentSeat("a", "Alpha"), agentSeat("b", "Beta")]);

  it("parses verdicts for reviews and picks for decisions", () => {
    expect(
      interpretTurn(session, { participantId: "a", phase: "review" }, "VERDICT: APPROVE"),
    ).toEqual({
      verdict: "approve",
    });
    expect(interpretTurn(session, { participantId: "a", phase: "decide" }, "PICK: Beta")).toEqual({
      verdict: "pick",
      pickedParticipantId: "b",
    });
    // A participant cannot pick itself.
    expect(interpretTurn(session, { participantId: "a", phase: "decide" }, "PICK: Alpha")).toEqual(
      {},
    );
    expect(
      interpretTurn(session, { participantId: "a", phase: "build" }, "VERDICT: APPROVE"),
    ).toEqual({});
  });
});

describe("demo sessions (dev hook)", () => {
  const settled: RoundtablePattern[] = ["build-review", "debate", "relay", "race"];

  it.each([...settled, "open" as const])(
    "seeds a valid %s session with finished turns",
    (pattern) => {
      const session = buildDemoSession({
        id: `demo-${pattern}`,
        pattern,
        projectId: "p",
        now: 1e9,
      });
      expect(sanitizeSession(session)).toEqual(session);
      expect(session.turns.length).toBeGreaterThan(0);
      expect(session.turns.every((turn) => turn.status === "done")).toBe(true);
    },
  );

  it.each(settled)("finishes the %s demo with an outcome", (pattern) => {
    const session = buildDemoSession({ id: `demo-${pattern}`, pattern, projectId: "p", now: 1e9 });
    expect(session.status).toBe("done");
    expect(session.outcome).toBeDefined();
  });

  it("leaves the group-chat demo open and waiting for the user", () => {
    const session = buildDemoSession({
      id: "demo-open",
      pattern: "open",
      projectId: "p",
      now: 1e9,
    });
    expect(planNextStep(session).kind).toBe("idle");
    expect(groupTranscript(session)[0]).toEqual({
      name: "User",
      text: "How should the signup form show validation errors?",
    });
  });
});
