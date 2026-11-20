import { describe, expect, it } from "vitest";
import type { StartRoundtableInput } from "../api";
import type { RoundtableSession } from "../types";
import { createSessionRecord, validateSeed, validateStartInput } from "./session";
import { agentSeat, makeSession } from "./testFixtures";

const trio = [agentSeat("a", "Alpha"), agentSeat("b", "Beta"), agentSeat("c", "Gamma")];

function input(overrides: Partial<StartRoundtableInput> = {}): StartRoundtableInput {
  return {
    task: "Pick a validation approach.",
    pattern: "compare",
    projectId: "project-1",
    participants: trio,
    ...overrides,
  };
}

function finishedComparison(overrides: Partial<RoundtableSession> = {}): RoundtableSession {
  return makeSession("compare", trio, {
    id: "cmp",
    status: "done",
    maxRounds: 1,
    threadIds: { a: "thread-a", b: "thread-b", c: "thread-c" },
    worktreePath: "/repo",
    turns: [
      {
        id: "ta",
        participantId: "a",
        round: 0,
        phase: "answer",
        prompt: "p",
        status: "done",
        responseText: "Use a schema",
      },
      {
        id: "tb",
        participantId: "b",
        round: 0,
        phase: "answer",
        prompt: "p",
        status: "failed",
        error: "quota",
      },
      {
        id: "tc",
        participantId: "c",
        round: 0,
        phase: "answer",
        prompt: "p",
        status: "done",
        responseText: "Native validation",
      },
    ],
    ...overrides,
  });
}

describe("compare sessions", () => {
  it("start with one answer each and no turns", () => {
    validateStartInput(input());
    const record = createSessionRecord(input(), { id: "s1", now: 5 });
    expect(record).toMatchObject({
      id: "s1",
      pattern: "compare",
      maxRounds: 1,
      status: "running",
      turns: [],
      threadIds: {},
    });
    expect(record.seededFromSessionId).toBeUndefined();
  });

  it("still need two participants", () => {
    expect(() => validateStartInput(input({ participants: trio.slice(0, 1) }))).toThrow(
      /seats 2 to 5/,
    );
  });
});

describe("a debate seeded from a comparison", () => {
  const seeded = input({
    pattern: "debate",
    participants: [trio[0]!, trio[2]!],
    seedFromSessionId: "cmp",
  });

  it("is only a debate", () => {
    expect(() => validateStartInput({ ...seeded, pattern: "relay" })).toThrow(
      /Only a debate can start from a comparison/,
    );
    expect(() => validateStartInput(seeded)).not.toThrow();
  });

  it("checks the comparison it starts from", () => {
    expect(() => validateSeed(seeded, undefined)).toThrow(/no longer available/);
    expect(() => validateSeed(seeded, finishedComparison({ status: "running" }))).toThrow(
      /Wait for the comparison to finish/,
    );
    expect(() => validateSeed(seeded, finishedComparison({ pattern: "relay" }))).toThrow(
      /Only a comparison can seed a debate/,
    );
    expect(() =>
      validateSeed({ ...seeded, participants: [trio[0]!, trio[1]!] }, finishedComparison()),
    ).toThrow(/Every debater must have answered/);
    expect(() => validateSeed(seeded, finishedComparison())).not.toThrow();
    // Without a seed there is nothing to check.
    expect(() => validateSeed(input(), undefined)).not.toThrow();
  });

  it("starts from the answers, in the comparison's threads", () => {
    let next = 0;
    const record = createSessionRecord(seeded, {
      id: "deb",
      now: 9,
      worktreePath: "/repo",
      seed: finishedComparison(),
      newId: () => `seed-${++next}`,
    });
    expect(record.seededFromSessionId).toBe("cmp");
    expect(record.threadIds).toEqual({ a: "thread-a", c: "thread-c" });
    expect(record.maxRounds).toBe(2);
    expect(
      record.turns.map((turn) => [turn.id, turn.participantId, turn.phase, turn.responseText]),
    ).toEqual([
      ["seed-1", "a", "propose", "Use a schema"],
      ["seed-2", "c", "propose", "Native validation"],
    ]);
  });

  it("ignores a seed the request did not ask for", () => {
    const record = createSessionRecord(input({ pattern: "debate" }), {
      id: "deb",
      now: 9,
      seed: finishedComparison(),
    });
    expect(record.turns).toEqual([]);
    expect(record.threadIds).toEqual({});
    expect(record.seededFromSessionId).toBeUndefined();
  });
});

describe("work together sessions", () => {
  it("store trimmed shared instructions and omit blank ones; open needs no task", () => {
    const record = (instructions?: string) =>
      createSessionRecord(
        input({
          pattern: "open",
          task: "",
          ...(instructions === undefined ? {} : { instructions }),
        }),
        { id: "s", now: 1 },
      );
    expect(() => validateStartInput(input({ pattern: "open", task: "" }))).not.toThrow();
    expect(record("  Be brief. ").instructions).toBe("Be brief.");
    expect(record("   ")).not.toHaveProperty("instructions");
    expect(record()).not.toHaveProperty("instructions");
  });
});

describe("playbooks", () => {
  const review = { id: "review", label: "Review", instructions: "Read.", readOnly: true as const };
  const debug = { id: "debug", label: "Debug", instructions: "Repro first." };

  it("refuses a read-only table playbook for a pattern whose seats must edit", () => {
    const catalog = [review, debug];
    for (const pattern of ["build-review", "relay", "race"] as const) {
      expect(() => validateStartInput(input({ pattern, playbookId: "review" }), catalog)).toThrow(
        /"Review" playbook/,
      );
    }
    expect(() =>
      validateStartInput(
        input({ pattern: "debate", implementWinner: true, playbookId: "review" }),
        catalog,
      ),
    ).toThrow(/"Review" playbook/);
    expect(() =>
      validateStartInput(input({ pattern: "debate", playbookId: "review" }), catalog),
    ).not.toThrow();
    expect(() =>
      validateStartInput(input({ pattern: "build-review", playbookId: "debug" }), catalog),
    ).not.toThrow();
    // A read-only seat (a reviewer) is fine.
    expect(() =>
      validateStartInput(
        input({
          pattern: "build-review",
          participants: [trio[0]!, { ...trio[1]!, playbookId: "review" }],
        }),
        catalog,
      ),
    ).not.toThrow();
  });

  it("refuses a table playbook that is no longer in the catalog", () => {
    expect(() =>
      validateStartInput(input({ pattern: "open", playbookId: "gone" }), [debug]),
    ).toThrow(/no longer available/);
    expect(() =>
      validateStartInput(input({ pattern: "open", playbookId: "debug" }), [debug]),
    ).not.toThrow();
  });

  it("checks each editing seat's own playbook, not only the table's", () => {
    const catalog = [review, debug];
    // No table playbook, but the builder (first seat without roles) is read-only.
    expect(() =>
      validateStartInput(
        input({
          pattern: "build-review",
          participants: [{ ...trio[0]!, playbookId: "review" }, trio[1]!],
        }),
        catalog,
      ),
    ).toThrow(/"Review" playbook keeps Alpha/);
    // Read-only table, but the builder overrides it.
    expect(() =>
      validateStartInput(
        input({
          pattern: "build-review",
          playbookId: "review",
          participants: [{ ...trio[0]!, playbookId: "debug" }, trio[1]!],
        }),
        catalog,
      ),
    ).not.toThrow();
  });

  it("keeps the table's playbook id and each seat's own choice in the record", () => {
    const record = createSessionRecord(
      input({
        playbookId: "debug",
        participants: [
          { ...trio[0]!, playbookId: null },
          { ...trio[1]!, playbookId: "review" },
        ],
      }),
      { id: "s", now: 1 },
    );
    expect(record.playbookId).toBe("debug");
    expect(record.participants.map((participant) => participant.playbookId)).toEqual([
      null,
      "review",
    ]);
    expect(
      createSessionRecord(input({ playbookId: "Bad Id" }), { id: "s", now: 1 }),
    ).not.toHaveProperty("playbookId");
  });
});
