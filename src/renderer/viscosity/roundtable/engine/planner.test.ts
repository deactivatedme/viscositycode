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

  it("gives a re-run racer and its cross-review the racer's own instructions", () => {
    const racers = [
      { ...agentSeat("a", "A"), instructions: "Focus on performance." },
      agentSeat("b", "B"),
    ];
    const rerun = planNextStep(
      makeSession("race", racers, {
        experimentId: "exp-1",
        turns: [
          doneTurn({ participantId: "a", phase: "race", status: "stopped", responseText: "" }),
          doneTurn({ participantId: "b", phase: "race", responseText: "B's work" }),
        ],
      }),
    );
    expect(rerun.kind === "run" && rerun.turns[0]!.prompt).toContain(
      "Your own instructions:\nFocus on performance.",
    );

    const review = planNextStep(
      makeSession("race", racers, {
        experimentId: "exp-1",
        turns: [
          doneTurn({ participantId: "a", phase: "race", startedAt: 1, responseText: "A's work" }),
          doneTurn({ participantId: "b", phase: "race", startedAt: 1, responseText: "B's work" }),
        ],
      }),
    );
    expect(review.kind).toBe("run");
    if (review.kind !== "run") return;
    const forA = review.turns.find((turn) => turn.participantId === "a");
    expect(forA?.phase).toBe("cross-review");
    expect(forA?.prompt).toContain("Your own instructions:\nFocus on performance.");
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

describe("planNextStep: compare", () => {
  const trio = [agentSeat("a", "Alpha"), agentSeat("b", "Beta"), agentSeat("c", "Gamma")];

  it("asks every participant at once for one independent answer", () => {
    const plan = planNextStep(makeSession("compare", trio, { maxRounds: 1 }));
    expect(plan.kind).toBe("run");
    if (plan.kind !== "run") return;
    expect(plan.turns.map((turn) => [turn.participantId, turn.round, turn.phase])).toEqual([
      ["a", 0, "answer"],
      ["b", 0, "answer"],
      ["c", 0, "answer"],
    ]);
    for (const turn of plan.turns) {
      expect(turn.prompt).toContain("Build the thing.");
      expect(turn.prompt).toContain("you will not see the other answers");
      // No verdict or pick is asked for.
      expect(turn.prompt).not.toMatch(/VERDICT:|PICK:/);
    }
  });

  it("only re-asks open slots and carries pending notes", () => {
    const session = makeSession("compare", trio, {
      turns: [
        doneTurn({ participantId: "a", phase: "answer" }),
        doneTurn({ participantId: "b", phase: "answer", status: "stopped" }),
        doneTurn({ participantId: "c", phase: "answer", status: "failed", error: "boom" }),
      ],
      notes: [{ id: "n1", text: "Prefer no new dependency", createdAt: 1 }],
    });
    const plan = planNextStep(session);
    expect(plan.kind).toBe("run");
    if (plan.kind !== "run") return;
    // The stopped answer runs again; the failed one stays failed (it is marked, not retried).
    expect(plan.turns.map((turn) => turn.participantId)).toEqual(["b"]);
    expect(plan.deliverNoteIds).toEqual(["n1"]);
    expect(plan.turns[0]!.prompt).toContain("- Prefer no new dependency");
  });

  it("is done once everyone answered, with failed answers marked", () => {
    const session = makeSession("compare", trio, {
      turns: [
        doneTurn({ participantId: "a", phase: "answer" }),
        doneTurn({ participantId: "b", phase: "answer", status: "failed", error: "quota" }),
        doneTurn({ participantId: "c", phase: "answer" }),
      ],
    });
    expect(planNextStep(session)).toEqual({
      kind: "finish",
      status: "done",
      outcome: { reason: "compared" },
    });
  });

  it("fails only when nobody answered", () => {
    const last = doneTurn({ participantId: "b", phase: "answer", status: "failed", error: "x" });
    const session = makeSession("compare", trio.slice(0, 2), {
      turns: [
        doneTurn({ participantId: "a", phase: "answer", status: "failed", error: "y" }),
        last,
      ],
    });
    expect(planNextStep(session)).toEqual({
      kind: "finish",
      status: "failed",
      reason: "turn-failed",
      turnId: last.id,
    });
  });

  it("a debate seeded with the answers goes straight to the critique round", () => {
    const debate = makeSession("debate", trio.slice(0, 2), {
      maxRounds: 1,
      seededFromSessionId: "compare-1",
      turns: [
        doneTurn({ participantId: "a", phase: "propose", responseText: "Use a schema" }),
        doneTurn({ participantId: "b", phase: "propose", responseText: "Native validation" }),
      ],
    });
    const plan = planNextStep(debate);
    expect(plan.kind).toBe("run");
    if (plan.kind !== "run") return;
    expect(plan.turns.map((turn) => [turn.participantId, turn.round, turn.phase])).toEqual([
      ["a", 1, "critique"],
      ["b", 1, "critique"],
    ]);
    expect(plan.turns[0]!.prompt).toContain("Native validation");
    expect(plan.turns[1]!.prompt).toContain("Use a schema");
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
  const settled: RoundtablePattern[] = ["build-review", "debate", "relay", "race", "compare"];

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

  it("runs the compare demo's answers side by side, with different durations", () => {
    const session = buildDemoSession({
      id: "demo-c",
      pattern: "compare",
      projectId: "p",
      now: 1e9,
    });
    expect(session.outcome).toEqual({ reason: "compared" });
    expect(new Set(session.turns.map((turn) => turn.startedAt)).size).toBe(1);
    expect(new Set(session.turns.map((turn) => turn.endedAt)).size).toBe(session.turns.length);
    expect(planNextStep(session)).toMatchObject({ kind: "finish", status: "done" });
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

describe("planNextStep: work together (open)", () => {
  const team = [
    { ...agentSeat("a", "Alpha"), instructions: "Own the backend." },
    agentSeat("b", "Beta"),
  ];
  const note = (id: string, text: string, createdAt: number) => ({ id, text, createdAt });

  function promptOf(plan: ReturnType<typeof planNextStep>): string {
    expect(plan.kind).toBe("run");
    return plan.kind === "run" ? plan.turns[0]!.prompt : "";
  }

  it("frames the team, sends instructions on the first turn and again after an edit", () => {
    const base = makeSession("open", team, {
      task: "Plan the login",
      instructions: "Use TypeScript.",
      notes: [note("n1", "Plan the login", 1)],
    });
    const first = promptOf(planNextStep(base));
    expect(first).not.toContain("(role:");
    expect(first).toContain("working together");
    expect(first).toContain("Instructions from the user for the whole team:\nUse TypeScript.");
    expect(first).toContain("Your own instructions:\nOwn the backend.");
    // The task is just the first message: no duplicated topic.
    expect(first).not.toContain("The topic of this chat");

    const answered = {
      ...base,
      notes: [...base.notes!, note("n2", "Next", 50)],
      turns: [
        doneTurn({ participantId: "a", phase: "reply", noteId: "n1", startedAt: 10, endedAt: 20 }),
        doneTurn({ participantId: "b", phase: "reply", noteId: "n1", startedAt: 20, endedAt: 30 }),
      ],
    };
    const later = promptOf(planNextStep(answered));
    expect(later).not.toContain("Use TypeScript.");
    expect(later).not.toContain("Own the backend.");

    const edited = promptOf(planNextStep({ ...answered, instructionsUpdatedAt: 40 }));
    expect(edited).toContain("Use TypeScript.");
    expect(edited).toContain("Own the backend.");
    expect(edited).toContain("they replace any earlier ones");
    expect(first).not.toContain("replace any earlier ones");

    // Clearing every instruction still tells the agent, whose thread holds the old ones.
    const { instructions: _shared, ...withoutShared } = answered;
    const cleared = promptOf(
      planNextStep({
        ...withoutShared,
        instructionsUpdatedAt: 40,
        participants: [agentSeat("a", "Alpha"), agentSeat("b", "Beta")],
      }),
    );
    expect(cleared).not.toContain("Use TypeScript.");
    expect(cleared).toContain("earlier instructions from the user no longer apply");
  });

  it("refreshes only the seats an edit changed, and says removed only to a seat that lost them", () => {
    const answered = makeSession("open", team, {
      notes: [note("n1", "Plan the login", 1), note("n2", "Next", 50)],
      turns: [
        doneTurn({ participantId: "a", phase: "reply", noteId: "n1", startedAt: 10, endedAt: 20 }),
        doneTurn({ participantId: "b", phase: "reply", noteId: "n1", startedAt: 20, endedAt: 30 }),
      ],
    });
    // Alpha answers the next message first; Beta after Alpha's reply to it.
    const alphaReplied = {
      ...answered,
      turns: [
        ...answered.turns,
        doneTurn({ participantId: "a", phase: "reply", noteId: "n2", startedAt: 60, endedAt: 70 }),
      ],
    };
    // Only Alpha's own instructions were edited.
    const alpha = promptOf(planNextStep({ ...answered, instructionsUpdatedFor: { a: 40 } }));
    expect(alpha).toContain("Own the backend.");
    expect(alpha).toContain("they replace any earlier ones");
    const beta = promptOf(planNextStep({ ...alphaReplied, instructionsUpdatedFor: { a: 40 } }));
    expect(beta).not.toContain("no longer apply");
    expect(beta).not.toContain("replace any earlier ones");

    // Alpha's instructions were removed: only Alpha hears it.
    const cleared = [agentSeat("a", "Alpha"), agentSeat("b", "Beta")];
    const removedAlpha = promptOf(
      planNextStep({ ...answered, participants: cleared, instructionsUpdatedFor: { a: 40 } }),
    );
    expect(removedAlpha).toContain("earlier instructions from the user no longer apply");
    const removedBeta = promptOf(
      planNextStep({ ...alphaReplied, participants: cleared, instructionsUpdatedFor: { a: 40 } }),
    );
    expect(removedBeta).not.toContain("no longer apply");
  });

  it("keeps a topic that differs from the first message (bot chats)", () => {
    const session = makeSession("open", team, {
      task: "Open group chat between bots",
      notes: [note("n1", "Hello", 1)],
    });
    expect(promptOf(planNextStep(session))).toContain(
      "The topic of this chat (from the user):\nOpen group chat between bots",
    );
  });

  it("gives the origin seat its instructions too", () => {
    const session = makeSession("open", team, {
      originThreadId: "chat-1",
      notes: [note("n1", "Hi", 1)],
    });
    expect(promptOf(planNextStep(session))).toContain("Your own instructions:\nOwn the backend.");
  });

  it("skips halted messages, even with a stopped reply", () => {
    const session = makeSession("open", team, {
      notes: [{ ...note("n1", "Hi", 1), halted: true as const }],
      turns: [doneTurn({ participantId: "a", phase: "reply", noteId: "n1", status: "stopped" })],
    });
    expect(planNextStep(session).kind).toBe("idle");
  });

  it("never shows a reply a later message, and newcomers skip earlier messages", () => {
    const session = makeSession("open", [...team, { ...agentSeat("c", "Gamma"), joinedAt: 5 }], {
      notes: [note("n1", "First question", 1), note("n2", "Second question", 6)],
      turns: [
        doneTurn({ participantId: "a", phase: "reply", noteId: "n1", startedAt: 2, endedAt: 3 }),
      ],
    });
    const plan = planNextStep(session);
    expect(plan.kind === "run" && plan.turns[0]!.participantId).toBe("b");
    const prompt = promptOf(plan);
    expect(prompt).not.toContain("Second question");
    expect(groupTranscript(session, "n1").map((message) => message.text)).toEqual([
      "First question",
      "text",
    ]);
    // Gamma joined after n1: once Beta answered, n2 goes to everyone, Gamma included.
    const next = planNextStep({
      ...session,
      turns: [
        ...session.turns,
        doneTurn({ participantId: "b", phase: "reply", noteId: "n1", startedAt: 3, endedAt: 4 }),
        doneTurn({ participantId: "a", phase: "reply", noteId: "n2", startedAt: 7, endedAt: 8 }),
        doneTurn({ participantId: "b", phase: "reply", noteId: "n2", startedAt: 8, endedAt: 9 }),
      ],
    });
    expect(next.kind === "run" && next.turns[0]!.participantId).toBe("c");
  });
});
