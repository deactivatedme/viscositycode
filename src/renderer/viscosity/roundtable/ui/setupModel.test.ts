import { describe, expect, it } from "vitest";
import { XAI_DEFAULT_TEXT_MODEL } from "@/shared/viscosity/xaiContract";
import { defaultMaxRounds, defaultRolesForPattern } from "./patterns";
import { readyBrain } from "./roundtable.testFixtures";
import {
  addSeat,
  agentBrainFor,
  buildStartInput,
  changePattern,
  createSeat,
  initialSeats,
  nextReadyBrain,
  removeSeat,
  type RoundtableSetupDraft,
  uniqueLabels,
  updateSeat,
  validateSetup,
  xaiBrain,
} from "./setupModel";

const ready = [readyBrain("alpha"), readyBrain("beta", { presentationModes: ["terminal"] })];

function draft(overrides: Partial<RoundtableSetupDraft> = {}): RoundtableSetupDraft {
  return {
    title: "",
    task: "Ship it",
    projectId: "p1",
    pattern: "build-review",
    seats: initialSeats(ready, "build-review"),
    maxRounds: 4,
    worktreeMode: "current",
    branchName: "",
    ...overrides,
  };
}

describe("pattern defaults", () => {
  it("gives every pattern its seat roles", () => {
    expect(defaultRolesForPattern("build-review", 3)).toEqual(["builder", "reviewer", "reviewer"]);
    expect(defaultRolesForPattern("debate", 2)).toEqual(["member", "member"]);
    expect(defaultRolesForPattern("debate", 3)).toEqual(["member", "member", "judge"]);
    expect(defaultRolesForPattern("relay", 4)).toEqual([
      "planner",
      "builder",
      "tester",
      "reviewer",
    ]);
    expect(defaultRolesForPattern("relay", 2)).toEqual(["builder", "reviewer"]);
    expect(defaultRolesForPattern("race", 3)).toEqual(["builder", "builder", "builder"]);
    expect(defaultRolesForPattern("open", 2)).toEqual(["member", "member"]);
  });

  it("keeps the open group chat unlimited", () => {
    expect(defaultMaxRounds("build-review")).toBe(4);
    expect(defaultMaxRounds("debate")).toBe(2);
    expect(defaultMaxRounds("open")).toBeUndefined();
  });
});

describe("seats", () => {
  it("seats two different ready agents, preferring chat presentation", () => {
    const seats = initialSeats(ready, "build-review");
    expect(seats.map((seat) => seat.brain)).toEqual([
      { kind: "agent", agentKind: "alpha", model: "alpha-m1", presentationMode: "gui" },
      { kind: "agent", agentKind: "beta", model: "beta-m1", presentationMode: "terminal" },
    ]);
    expect(seats.map((seat) => seat.role)).toEqual(["builder", "reviewer"]);
  });

  it("seats nobody when no agent is ready", () => {
    expect(initialSeats([], "debate")).toEqual([]);
  });

  it("picks an unused agent first, then cycles", () => {
    const one = [createSeat(agentBrainFor(ready[0]!), "builder")];
    expect(nextReadyBrain(ready, one)?.agentKind).toBe("beta");
    const both = [...one, createSeat(agentBrainFor(ready[1]!), "reviewer")];
    expect(nextReadyBrain(ready, both)?.agentKind).toBe("alpha");
  });

  it("adds seats with the pattern's role for their position, up to five", () => {
    let current = draft({ pattern: "relay", seats: [] });
    for (let index = 0; index < 6; index += 1) current = addSeat(current, xaiBrain());
    expect(current.seats).toHaveLength(5);
    expect(current.seats.map((seat) => seat.role)).toEqual([
      "planner",
      "builder",
      "tester",
      "reviewer",
      "member",
    ]);
    const removed = removeSeat(current, current.seats[0]!.id);
    expect(removed.seats.map((seat) => seat.role)).toEqual([
      "planner",
      "builder",
      "tester",
      "reviewer",
    ]);
  });

  it("keeps roles the user picked when seats come and go", () => {
    let current = draft();
    current = updateSeat(current, current.seats[1]!.id, { role: "judge" });
    expect(current.rolesCustomized).toBe(true);
    current = addSeat(current, xaiBrain());
    expect(current.seats.map((seat) => seat.role)).toEqual(["builder", "judge", "reviewer"]);
    current = removeSeat(current, current.seats[0]!.id);
    expect(current.seats.map((seat) => seat.role)).toEqual(["judge", "reviewer"]);
    expect(changePattern(current, "open").rolesCustomized).toBe(false);
  });

  it("resets roles and rounds when the pattern changes", () => {
    const next = changePattern(draft(), "debate");
    expect(next.seats.map((seat) => seat.role)).toEqual(["member", "member"]);
    expect(next.maxRounds).toBe(2);
    expect(changePattern(next, "open").maxRounds).toBe(2);
  });
});

describe("validateSetup", () => {
  it("accepts a complete draft", () => {
    expect(validateSetup(draft())).toBeNull();
  });

  it.each([
    [{ projectId: undefined }, "no-project"],
    [{ task: "   " }, "no-task"],
    [{ seats: [createSeat(xaiBrain(), "builder")] }, "too-few-participants"],
    [
      { seats: Array.from({ length: 6 }, () => createSeat(xaiBrain(), "member")) },
      "too-many-participants",
    ],
    [
      {
        seats: [
          createSeat({ ...xaiBrain(), model: "" }, "builder"),
          createSeat(xaiBrain(), "reviewer"),
        ],
      },
      "missing-model",
    ],
    [{ maxRounds: 0 }, "invalid-rounds"],
    [{ maxRounds: 21 }, "invalid-rounds"],
    [{ maxRounds: 2.5 }, "invalid-rounds"],
  ] as const)("reports %o as %s", (overrides, problem) => {
    expect(validateSetup(draft(overrides as Partial<RoundtableSetupDraft>))).toBe(problem);
  });

  it("ignores the round limit for the open pattern", () => {
    expect(validateSetup(draft({ pattern: "open", maxRounds: 0 }))).toBeNull();
  });
});

describe("buildStartInput", () => {
  it("builds the engine input with labelled participants", () => {
    const value = draft({ title: "  Login fix ", task: " Fix login ", worktreeMode: "current" });
    const input = buildStartInput(value, ready);
    expect(input).toMatchObject({
      title: "Login fix",
      task: "Fix login",
      pattern: "build-review",
      projectId: "p1",
      maxRounds: 4,
      worktree: { mode: "current" },
    });
    expect(input.participants.map((entry) => [entry.label, entry.role])).toEqual([
      ["Provider alpha · alpha One", "builder"],
      ["Provider beta · beta One", "reviewer"],
    ]);
    expect(input.participants.map((entry) => entry.id)).toEqual(value.seats.map((seat) => seat.id));
  });

  it("asks for a new branch only when chosen, and never for a race", () => {
    expect(
      buildStartInput(draft({ worktreeMode: "new-branch", branchName: " rt/x " }), ready).worktree,
    ).toEqual({ mode: "new-branch", branchName: "rt/x" });
    expect(buildStartInput(draft({ worktreeMode: "new-branch" }), ready).worktree).toEqual({
      mode: "new-branch",
    });
    expect("worktree" in buildStartInput(draft({ pattern: "race" }), ready)).toBe(false);
  });

  it("leaves the open pattern unlimited and keeps the origin thread", () => {
    const input = buildStartInput(draft({ pattern: "open", originThreadId: "t1" }), ready);
    expect("maxRounds" in input).toBe(false);
    expect(input.originThreadId).toBe("t1");
    expect("title" in input).toBe(false);
  });

  it("labels Grok seats and numbers repeated labels", () => {
    const seats = [createSeat(xaiBrain(), "member"), createSeat(xaiBrain(), "member")];
    const input = buildStartInput(draft({ pattern: "open", seats }), ready);
    expect(input.participants.map((entry) => entry.label)).toEqual([
      `Grok · ${XAI_DEFAULT_TEXT_MODEL}`,
      `Grok · ${XAI_DEFAULT_TEXT_MODEL} 2`,
    ]);
    expect(uniqueLabels(["a", "b", "a", "a"])).toEqual(["a", "b", "a 2", "a 3"]);
  });
});
