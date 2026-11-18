import { describe, expect, it, vi } from "vitest";
import type { RoundtableTurn, TurnResult } from "../types";
import { planNextStep } from "./planner";
import type { RaceAdapter } from "./runner";
import { agentSeat, deferred, harness, makeSession, said } from "./testFixtures";

function phases(turns: readonly RoundtableTurn[]): string[] {
  return turns.map((turn) => `${turn.participantId}:${turn.phase}:${turn.round}`);
}

describe("build ↔ review", () => {
  it("loops until the reviewer approves and quotes the review to the builder", async () => {
    const session = makeSession("build-review", [
      agentSeat("b", "Builder", "builder"),
      agentSeat("r", "Reviewer", "reviewer"),
    ]);
    const {
      runner,
      session: current,
      log,
    } = harness(session, {
      b: (_call, index) => said(index === 0 ? "Built v1" : "Built v2 with tests"),
      r: (_call, index) =>
        said(index === 0 ? "- add tests\nVERDICT: REVISE" : "All good.\nVERDICT: APPROVE"),
    });
    await runner.kick(session.id);
    const result = current();
    expect(phases(result.turns)).toEqual(["b:build:0", "r:review:0", "b:build:1", "r:review:1"]);
    expect(result.turns.map((turn) => turn.verdict)).toEqual([
      undefined,
      "revise",
      undefined,
      "approve",
    ]);
    expect(result.status).toBe("done");
    expect(result.outcome).toEqual({ reason: "approved" });
    expect(result.winnerParticipantId).toBe("b");
    // The reviewer sees the builder's answer as quoted data, and the task each turn.
    expect(log[1]!.prompt).toContain("> Built v1");
    expect(log[1]!.prompt).toContain("Build the thing.");
    // The builder's revision prompt carries the review.
    expect(log[2]!.prompt).toContain("> - add tests");
  });

  it("stops at maxRounds when the reviewer keeps asking for changes", async () => {
    const session = makeSession(
      "build-review",
      [agentSeat("b", "Builder", "builder"), agentSeat("r", "Reviewer", "reviewer")],
      { maxRounds: 2 },
    );
    const { runner, session: current } = harness(session, {
      b: () => said("built"),
      r: () => said("VERDICT: REVISE"),
    });
    await runner.kick(session.id);
    expect(current().turns).toHaveLength(4);
    expect(current().status).toBe("done");
    expect(current().outcome).toEqual({ reason: "max-rounds" });
  });

  it("runs several reviewers in parallel and needs every approval", async () => {
    const session = makeSession("build-review", [
      agentSeat("b", "Builder", "builder"),
      agentSeat("r1", "R1", "reviewer"),
      agentSeat("r2", "R2", "reviewer"),
    ]);
    const { runner, session: current } = harness(session, {
      b: () => said("built"),
      r1: () => said("VERDICT: APPROVE"),
      r2: (_call, index) => said(index === 0 ? "VERDICT: REVISE" : "VERDICT: APPROVE"),
    });
    await runner.kick(session.id);
    expect(phases(current().turns)).toEqual([
      "b:build:0",
      "r1:review:0",
      "r2:review:0",
      "b:build:1",
      "r1:review:1",
      "r2:review:1",
    ]);
    expect(current().outcome?.reason).toBe("approved");
  });
});

describe("debate", () => {
  const seats = [agentSeat("a", "Alpha"), agentSeat("b", "Beta"), agentSeat("c", "Gamma")];

  it("proposes in parallel, critiques, votes, and lets the winner implement", async () => {
    const session = makeSession("debate", seats, { maxRounds: 1, implementWinner: true });
    const votes: Record<string, string> = { a: "PICK: Beta", b: "PICK: Gamma", c: "PICK: Beta" };
    const {
      runner,
      session: current,
      log,
    } = harness(
      session,
      Object.fromEntries(
        seats.map((seat) => [
          seat.id,
          (call: { prompt: string }) =>
            said(
              call.prompt.includes("Vote for the best")
                ? votes[seat.id]!
                : call.prompt.includes("Your proposal was chosen")
                  ? "implemented"
                  : `proposal of ${seat.label}`,
            ),
        ]),
      ),
    );
    await runner.kick(session.id);
    const result = current();
    expect(phases(result.turns)).toEqual([
      "a:propose:0",
      "b:propose:0",
      "c:propose:0",
      "a:critique:1",
      "b:critique:1",
      "c:critique:1",
      "a:decide:2",
      "b:decide:2",
      "c:decide:2",
      "b:implement:3",
    ]);
    expect(result.winnerParticipantId).toBe("b");
    expect(result.outcome).toEqual({ reason: "vote" });
    // Critiques see the others' latest proposals, attributed and quoted.
    const alphaCritique = log.find(
      (call) => call.participantId === "a" && call.prompt.includes("Critique round"),
    )!;
    expect(alphaCritique.prompt).toContain("Here is what Beta said");
    expect(alphaCritique.prompt).toContain("> proposal of Gamma");
    expect(alphaCritique.prompt).not.toContain("Here is what Alpha said");
    // A voter is never offered its own proposal.
    const alphaVote = log.find(
      (call) => call.participantId === "a" && call.prompt.includes("Vote"),
    )!;
    expect(alphaVote.prompt).not.toContain("Here is what Alpha said");
  });

  it("lets a judge decide when one is seated", async () => {
    const session = makeSession(
      "debate",
      [agentSeat("a", "Alpha"), agentSeat("b", "Beta"), agentSeat("j", "Judge", "judge")],
      { maxRounds: 0 },
    );
    const { runner, session: current } = harness(session, {
      a: () => said("A plan"),
      b: () => said("B plan"),
      j: () => said("Beta is simpler.\nPICK: Beta"),
    });
    await runner.kick(session.id);
    expect(phases(current().turns)).toEqual(["a:propose:0", "b:propose:0", "j:decide:1"]);
    expect(current().winnerParticipantId).toBe("b");
    expect(current().outcome?.reason).toBe("judge");
    expect(current().outcome?.rationale).toContain("Beta is simpler.");
  });

  it("breaks a tied vote toward the first proposer", async () => {
    const session = makeSession("debate", [agentSeat("a", "Alpha"), agentSeat("b", "Beta")], {
      maxRounds: 0,
    });
    const { runner, session: current } = harness(session, {
      a: (call) => said(call.prompt.includes("Vote") ? "PICK: Beta" : "A"),
      b: (call) => said(call.prompt.includes("Vote") ? "PICK: Alpha" : "B"),
    });
    await runner.kick(session.id);
    expect(current().winnerParticipantId).toBe("a");
  });

  it("drops a proposer that fails while two remain", async () => {
    const session = makeSession("debate", seats, { maxRounds: 0 });
    const { runner, session: current } = harness(session, {
      a: (call) => said(call.prompt.includes("Vote") ? "PICK: Gamma" : "A"),
      b: () => ({ status: "failed", text: "", error: "quota" }),
      c: (call) => said(call.prompt.includes("Vote") ? "PICK: Alpha" : "C"),
    });
    await runner.kick(session.id);
    expect(current().status).toBe("done");
    expect(current().turns.filter((turn) => turn.participantId === "b")).toHaveLength(1);
    expect(current().winnerParticipantId).toBe("a");
  });
});

describe("relay", () => {
  it("passes each stage's output on and sends a REVISE back to the builder", async () => {
    const session = makeSession(
      "relay",
      [
        agentSeat("p", "Planner", "planner"),
        agentSeat("b", "Builder", "builder"),
        agentSeat("t", "Tester", "tester"),
        agentSeat("r", "Reviewer", "reviewer"),
      ],
      { maxRounds: 3 },
    );
    const {
      runner,
      session: current,
      log,
    } = harness(session, {
      p: () => said("PLAN"),
      b: (_call, index) => said(`BUILD ${index}`),
      t: (_call, index) => said(`TESTS ${index}`),
      r: (_call, index) =>
        said(index === 0 ? "missing edge case\nVERDICT: REVISE" : "VERDICT: APPROVE"),
    });
    await runner.kick(session.id);
    expect(phases(current().turns)).toEqual([
      "p:plan:0",
      "b:build:0",
      "t:test:0",
      "r:review:0",
      "b:build:1",
      "t:test:1",
      "r:review:1",
    ]);
    expect(current().outcome).toEqual({ reason: "approved" });
    expect(log[1]!.prompt).toContain("> PLAN");
    expect(log[2]!.prompt).toContain("> BUILD 0");
    expect(log[4]!.prompt).toContain("> missing edge case");
    expect(log[4]!.prompt).toContain("The reviewer sent the work back");
  });
});

describe("race", () => {
  it("launches an experiment, cross-reviews and crowns through the experiment judge", async () => {
    const session = makeSession("race", [agentSeat("a", "Alpha"), agentSeat("b", "Beta")]);
    const launch = vi.fn<RaceAdapter["launch"]>(async () => ({
      experimentId: "exp-1",
      threadIds: { a: "thread-a", b: "thread-b" },
    }));
    const crown = vi.fn<RaceAdapter["crown"]>(async () => ({
      winnerThreadId: "thread-b",
      rationale: "cleaner diff",
    }));
    const {
      runner,
      session: current,
      log,
    } = harness(
      session,
      {
        a: () => said("Beta is better\nPICK: Beta"),
        b: () => said("Alpha lacks tests\nPICK: Alpha"),
      },
      {
        race: { launch, crown },
        awaitResults: { a: () => said("alpha result"), b: () => said("beta result") },
      },
    );
    await runner.kick(session.id);
    const result = current();
    expect(launch).toHaveBeenCalledTimes(1);
    expect(result.experimentId).toBe("exp-1");
    expect(result.threadIds).toEqual({ a: "thread-a", b: "thread-b" });
    expect(phases(result.turns)).toEqual([
      "a:race:0",
      "b:race:0",
      "a:cross-review:1",
      "b:cross-review:1",
    ]);
    expect(log.find((call) => call.participantId === "a")!.prompt).toContain("> beta result");
    expect(crown).toHaveBeenCalledTimes(1);
    expect(result.winnerParticipantId).toBe("b");
    expect(result.outcome).toEqual({ reason: "crown", rationale: "cleaner diff" });
  });

  it("falls back to the cross-review votes when no crown is made", async () => {
    const session = makeSession("race", [
      agentSeat("a", "Alpha"),
      agentSeat("b", "Beta"),
      agentSeat("c", "Gamma"),
    ]);
    const { runner, session: current } = harness(
      session,
      {
        a: () => said("PICK: Gamma"),
        b: () => said("PICK: Gamma"),
        c: () => said("PICK: Alpha"),
      },
      {
        race: {
          launch: async () => ({
            experimentId: "exp-2",
            threadIds: { a: "ta", b: "tb", c: "tc" },
          }),
          crown: async () => undefined,
        },
        awaitResults: { a: () => said("A"), b: () => said("B"), c: () => said("C") },
      },
    );
    await runner.kick(session.id);
    expect(current().winnerParticipantId).toBe("c");
    expect(current().outcome).toEqual({ reason: "vote" });
  });

  it("interrupts racers that started after the user stopped the launch", async () => {
    const session = makeSession("race", [agentSeat("a", "Alpha"), agentSeat("b", "Beta")]);
    const launched = deferred<{ experimentId: string; threadIds: Record<string, string> }>();
    const launch = vi.fn<RaceAdapter["launch"]>(() => launched.promise);
    const settleA = deferred<TurnResult>();
    const settleB = deferred<TurnResult>();
    const {
      runner,
      drivers,
      session: current,
    } = harness(
      session,
      {},
      {
        race: { launch, crown: async () => undefined },
        awaitResults: { a: () => settleA.promise, b: () => settleB.promise },
      },
    );
    const loop = runner.kick(session.id);
    await vi.waitFor(() => expect(launch).toHaveBeenCalledTimes(1));
    await runner.stop(session.id);
    launched.resolve({ experimentId: "exp-1", threadIds: { a: "ta", b: "tb" } });
    await vi.waitFor(() => {
      expect(drivers.get("a")?.stopCalls).toBe(1);
      expect(drivers.get("b")?.stopCalls).toBe(1);
    });
    settleA.resolve({ status: "stopped", text: "" });
    settleB.resolve({ status: "stopped", text: "" });
    await loop;
    expect(current().status).toBe("stopped");
    expect(current().experimentId).toBe("exp-1");
    expect(current().turns.map((turn) => turn.status)).toEqual(["stopped", "stopped"]);
  });

  it("fails cleanly when the experiment cannot launch", async () => {
    const session = makeSession("race", [agentSeat("a", "Alpha"), agentSeat("b", "Beta")]);
    const { runner, session: current } = harness(
      session,
      {},
      {
        race: { launch: () => Promise.reject(new Error("no git")), crown: async () => undefined },
      },
    );
    await runner.kick(session.id);
    expect(current().status).toBe("failed");
    expect(current().error).toBe("no git");
  });
});

describe("open group chat", () => {
  const seats = [agentSeat("a", "Alpha"), agentSeat("b", "Beta"), agentSeat("c", "Gamma")];

  it("waits for the user, answers mentions, and lets peers react at most twice", async () => {
    const session = makeSession("open", seats);
    const {
      runner,
      session: current,
      log,
    } = harness(session, {
      a: (_call, index) => said(index === 0 ? "Sure. @Beta what do you think?" : "Agreed, @Beta."),
      b: (_call, index) =>
        said(index === 0 ? "Hi! @Alpha please weigh in." : `Beta again ${index}. @Alpha`),
      c: () => said("Gamma here."),
    });
    await runner.kick(session.id);
    expect(current().turns).toHaveLength(0);
    expect(planNextStep(current()).kind).toBe("idle");

    runner.post(session.id, "Hello @Beta", ["b"]);
    await runner.kick(session.id);
    const replies = current().turns;
    // Beta answers, Alpha reacts (round 1), Beta reacts (round 2) — no third reaction.
    expect(phases(replies)).toEqual(["b:reply:0", "a:reply:1", "b:reply:2"]);
    expect(replies.every((turn) => turn.noteId === current().notes![0]!.id)).toBe(true);
    expect(log[1]!.prompt).toContain("Beta addressed you");
    expect(log[1]!.prompt).toContain("> Hi! @Alpha please weigh in.");
    expect(current().status).toBe("running");

    runner.post(session.id, "Everyone: summary please", undefined);
    await runner.kick(session.id);
    const second = current().turns.slice(3);
    expect(second.slice(0, 3).map((turn) => turn.participantId)).toEqual(["a", "b", "c"]);
    // Later speakers see the earlier replies in the transcript.
    const gammaPrompt = log.filter((call) => call.participantId === "c").at(-1)!.prompt;
    expect(gammaPrompt).toContain("User:\n> Everyone: summary please");
    expect(gammaPrompt).toContain("Alpha:\n>");
  });
});

describe("controls", () => {
  const seats = () => [
    agentSeat("b", "Builder", "builder"),
    agentSeat("r", "Reviewer", "reviewer"),
  ];

  it("pause lets the running turn finish, then waits until resumed", async () => {
    const gate = deferred<ReturnType<typeof said>>();
    const session = makeSession("build-review", seats());
    const { runner, session: current } = harness(session, {
      b: (_call, index) => (index === 0 ? gate.promise : said("again")),
      r: () => said("VERDICT: APPROVE"),
    });
    const loop = runner.kick(session.id);
    await vi.waitFor(() => expect(current().turns).toHaveLength(1));
    runner.pause(session.id);
    gate.resolve(said("built"));
    await loop;
    expect(current().status).toBe("paused");
    expect(current().turns.map((turn) => turn.status)).toEqual(["done"]);

    runner.resume(session.id);
    await vi.waitFor(() => expect(current().status).toBe("done"));
    expect(phases(current().turns)).toEqual(["b:build:0", "r:review:0"]);
  });

  it("stop interrupts the running participant and ends the session", async () => {
    const session = makeSession("build-review", seats());
    const {
      runner,
      session: current,
      drivers,
    } = harness(session, {
      b: () => new Promise(() => {}),
    });
    const loop = runner.kick(session.id);
    await vi.waitFor(() => expect(drivers.get("b")?.calls).toHaveLength(1));
    await runner.stop(session.id);
    await loop;
    expect(drivers.get("b")!.stopCalls).toBe(1);
    expect(drivers.get("b")!.disposed).toBe(true);
    expect(current().status).toBe("stopped");
    expect(current().turns[0]!.status).toBe("stopped");
  });

  it("a failed turn fails the session; resume retries it", async () => {
    const session = makeSession("build-review", seats());
    // A finished (failed) session releases its drivers; the retry gets a new one.
    let builderCalls = 0;
    const { runner, session: current } = harness(session, {
      b: () =>
        builderCalls++ === 0
          ? { status: "failed", text: "", error: "Rate limited" }
          : said("built"),
      r: () => said("VERDICT: APPROVE"),
    });
    await runner.kick(session.id);
    expect(current().status).toBe("failed");
    expect(current().error).toBe("Rate limited");

    runner.resume(session.id);
    await vi.waitFor(() => expect(current().status).toBe("done"));
    expect(current().turns.map((turn) => turn.status)).toEqual(["stopped", "done", "done"]);
    expect(current().error).toBeUndefined();
  });

  it("a steering note reaches the next participant's prompt once", async () => {
    const gate = deferred<ReturnType<typeof said>>();
    const session = makeSession("build-review", seats());
    const {
      runner,
      session: current,
      log,
    } = harness(session, {
      b: () => gate.promise,
      r: () => said("VERDICT: APPROVE"),
    });
    const loop = runner.kick(session.id);
    await vi.waitFor(() => expect(current().turns).toHaveLength(1));
    runner.post(session.id, "Prefer the existing helper.", undefined);
    gate.resolve(said("built"));
    await loop;
    expect(log[1]!.prompt).toContain("- Prefer the existing helper.");
    expect(current().notes![0]!.deliveredTurnId).toBe(current().turns[1]!.id);
    expect(log[0]!.prompt).not.toContain("Prefer the existing helper.");
  });

  it("after a reload, waits for in-flight turns instead of sending them again", async () => {
    const session = makeSession("build-review", seats(), {
      threadIds: { b: "thread-b" },
      turns: [
        {
          id: "t-1",
          participantId: "b",
          round: 0,
          phase: "build",
          prompt: "p",
          status: "running",
          startedAt: 1,
        },
      ],
    });
    const {
      runner,
      session: current,
      log,
    } = harness(
      session,
      { r: () => said("VERDICT: APPROVE") },
      { awaitResults: { b: () => said("finished while away") } },
    );
    runner.resumeAfterReload([session]);
    await vi.waitFor(() => expect(current().status).toBe("done"));
    expect(current().turns[0]).toMatchObject({
      status: "done",
      responseText: "finished while away",
    });
    expect(log.map((call) => call.participantId)).toEqual(["r"]);
  });

  it("marks a turn waiting for approval and back", async () => {
    const gate = deferred<ReturnType<typeof said>>();
    let attention: ((waiting: boolean) => void) | undefined;
    const session = makeSession("build-review", seats());
    const { runner, session: current } = harness(session, {
      b: (call) => {
        attention = call.options?.onAttention;
        return gate.promise;
      },
      r: () => said("VERDICT: APPROVE"),
    });
    const loop = runner.kick(session.id);
    await vi.waitFor(() => expect(attention).toBeDefined());
    attention!(true);
    expect(current().turns[0]!.status).toBe("waiting-approval");
    attention!(false);
    expect(current().turns[0]!.status).toBe("running");
    gate.resolve(said("built"));
    await loop;
    expect(current().status).toBe("done");
  });
});

describe("origin thread", () => {
  it("keeps the origin as the first participant and gives the others its context", async () => {
    const session = makeSession(
      "build-review",
      [agentSeat("o", "Origin", "builder"), agentSeat("r", "Reviewer", "reviewer")],
      { originThreadId: "origin-thread", threadIds: { o: "origin-thread" } },
    );
    const { runner, log } = harness(
      session,
      { o: () => said("built"), r: () => said("VERDICT: APPROVE") },
      {
        readOriginContext: async () => ({
          threadId: "origin-thread",
          text: "What we discussed",
          mention: true,
        }),
      },
    );
    await runner.kick(session.id);
    const [builder, reviewer] = log;
    expect(builder!.prompt).not.toContain("What we discussed");
    expect(builder!.options?.contextThreadIds).toBeUndefined();
    expect(reviewer!.prompt).toContain("> What we discussed");
    expect(reviewer!.prompt).toContain("read_thread");
    expect(reviewer!.options?.contextThreadIds).toEqual(["origin-thread"]);
  });
});
