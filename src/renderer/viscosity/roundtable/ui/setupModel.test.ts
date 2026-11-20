import { describe, expect, it } from "vitest";
import { AGENT_PROFILE_DRIVERS, agentProfileKind } from "@/shared/contracts";
import { XAI_DEFAULT_TEXT_MODEL } from "@/shared/viscosity/xaiContract";
import {
  defaultMaxRounds,
  defaultRolesForPattern,
  MAX_PARTICIPANTS,
  patternIsAnswerOnly,
} from "./patterns";
import { readyBrain } from "./roundtable.testFixtures";
import {
  addSeat,
  agentBrainFor,
  askAllSeatingKey,
  buildStartInput,
  changePattern,
  createSeat,
  initialSeats,
  nextReadyBrain,
  removeSeat,
  type RoundtableSetupDraft,
  roundsApply,
  seatAllReady,
  seatFromProfile,
  setSeatPlaybook,
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
    instructions: "",
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

  it("lets an open chat start without a first message", () => {
    expect(validateSetup(draft({ pattern: "open", task: "  " }))).toBeNull();
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

  it("passes trimmed instructions for everyone and per seat, and leaves blank ones out", () => {
    const value = draft({ pattern: "open", task: "", instructions: "  Answer in Portuguese. " });
    const edited = updateSeat(value, value.seats[0]!.id, { instructions: " Focus on tests " });
    expect(edited.rolesCustomized).toBeUndefined();
    const input = buildStartInput(
      updateSeat(edited, value.seats[1]!.id, { instructions: "  " }),
      ready,
    );
    expect(input).toMatchObject({ task: "", instructions: "Answer in Portuguese." });
    expect(input.participants[0]!.instructions).toBe("Focus on tests");
    expect("instructions" in input.participants[1]!).toBe(false);
    expect("instructions" in buildStartInput(draft(), ready)).toBe(false);
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

describe("ask all (compare)", () => {
  // Profile kinds of one registered driver: several accounts of one provider.
  const driver = AGENT_PROFILE_DRIVERS[0]!.driver;
  const many = [
    readyBrain("alpha"),
    readyBrain(agentProfileKind(driver, "work")),
    readyBrain(agentProfileKind(driver, "personal")),
    readyBrain("beta"),
    readyBrain("gamma"),
    readyBrain("delta"),
    readyBrain("epsilon"),
  ];

  it("seats a different provider before a second account of one already seated", () => {
    const pooled = [
      readyBrain(agentProfileKind(driver, "work")),
      readyBrain(driver),
      readyBrain("beta"),
    ];
    expect(
      initialSeats(pooled, "open").map(
        (seat) => seat.brain.kind === "agent" && seat.brain.agentKind,
      ),
    ).toEqual([agentProfileKind(driver, "work"), "beta"]);
    const one = [createSeat(agentBrainFor(pooled[0]!), "member")];
    expect(nextReadyBrain(pooled, one)?.agentKind).toBe("beta");
    // Every provider seated: the unused second account comes before a repeat.
    const two = [...one, createSeat(agentBrainFor(pooled[2]!), "member")];
    expect(nextReadyBrain(pooled, two)?.agentKind).toBe(driver);
  });

  it("seats every ready provider once (one account each), up to five", () => {
    const seats = initialSeats(many, "compare");
    expect(seats.map((seat) => seat.brain.kind === "agent" && seat.brain.agentKind)).toEqual([
      "alpha",
      agentProfileKind(driver, "work"),
      "beta",
      "gamma",
      "delta",
    ]);
    expect(seats.every((seat) => seat.role === "member")).toBe(true);
    expect(initialSeats(ready, "compare")).toHaveLength(2);
    expect(initialSeats([], "compare")).toEqual([]);
  });

  it("keys the ask-all seating by the seats it would make, not by the list's identity", () => {
    const seatedBrains = JSON.stringify(initialSeats(many, "compare").map((seat) => seat.brain));
    expect(askAllSeatingKey(many)).toBe(seatedBrains);
    expect(askAllSeatingKey([...many])).toBe(askAllSeatingKey(many));
    // A second account of a seated provider, or a sixth provider, seats nobody new.
    expect(askAllSeatingKey([...many, readyBrain("zeta")])).toBe(askAllSeatingKey(many));
    expect(askAllSeatingKey([readyBrain("alpha")])).not.toBe(askAllSeatingKey(ready));
    expect(askAllSeatingKey([])).toBe("[]");
  });

  it("adds the providers not seated yet when switching to it", () => {
    const start = draft({ seats: [createSeat(agentBrainFor(readyBrain("beta")), "builder")] });
    const next = seatAllReady(changePattern(start, "compare"), [readyBrain("alpha"), ...ready]);
    expect(next.seats.map((seat) => seat.brain.kind === "agent" && seat.brain.agentKind)).toEqual([
      "beta",
      "alpha",
    ]);
    expect(next.seats.map((seat) => seat.role)).toEqual(["member", "member"]);
    const full = draft({
      seats: Array.from({ length: MAX_PARTICIPANTS }, () => createSeat(xaiBrain(), "member")),
    });
    expect(seatAllReady(full, many)).toBe(full);
  });

  it("asks for no rounds and no checkout, and starts with one answer each", () => {
    expect(roundsApply("compare")).toBe(false);
    expect(patternIsAnswerOnly("compare")).toBe(true);
    expect(patternIsAnswerOnly("debate")).toBe(false);
    const value = changePattern(draft({ worktreeMode: "new-branch", maxRounds: 0 }), "compare");
    expect(validateSetup(value)).toBeNull();
    const input = buildStartInput(value, ready);
    expect(input.pattern).toBe("compare");
    expect("maxRounds" in input).toBe(false);
    expect("worktree" in input).toBe(false);
    expect(input.participants.map((entry) => entry.role)).toEqual(["member", "member"]);
  });
});

describe("playbooks", () => {
  const review = { id: "review", label: "Review", instructions: "Read.", readOnly: true as const };

  it("carries the table's playbook and each seat's own choice to the engine", () => {
    const value = draft({ playbookId: "debug" });
    const [first, second] = value.seats;
    const edited = setSeatPlaybook(setSeatPlaybook(value, first!.id, "review"), second!.id, null);
    const input = buildStartInput(edited, ready);
    expect(input.playbookId).toBe("debug");
    expect(input.participants.map((entry) => entry.playbookId)).toEqual(["review", null]);
    // Back to the table's: the seat field is removed, not set to undefined.
    const reset = setSeatPlaybook(edited, first!.id, undefined);
    expect("playbookId" in reset.seats[0]!).toBe(false);
    expect("playbookId" in buildStartInput(draft(), ready)).toBe(false);
    expect(seatFromProfile(input.participants[1]!).playbookId).toBeNull();
  });

  it("blocks a read-only table playbook where seats must edit", () => {
    expect(validateSetup(draft({ playbookId: "review" }), [review])).toBe("read-only-playbook");
    expect(
      validateSetup(draft({ pattern: "open", task: "", playbookId: "review" }), [review]),
    ).toBeNull();
    // Unknown to the catalog: nothing is bound, so nothing blocks.
    expect(validateSetup(draft({ playbookId: "review" }))).toBeNull();
    const [builderSeat, reviewerSeat] = draft().seats;
    // The builder's own read-only playbook blocks; the reviewer's does not.
    expect(
      validateSetup(draft({ seats: [{ ...builderSeat!, playbookId: "review" }, reviewerSeat!] }), [
        review,
      ]),
    ).toBe("read-only-playbook");
    expect(
      validateSetup(draft({ seats: [builderSeat!, { ...reviewerSeat!, playbookId: "review" }] }), [
        review,
      ]),
    ).toBeNull();
    // A read-only table is fine once the builder chooses none.
    expect(
      validateSetup(
        draft({
          playbookId: "review",
          seats: [{ ...builderSeat!, playbookId: null }, reviewerSeat!],
        }),
        [review],
      ),
    ).toBeNull();
  });
});
