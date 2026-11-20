import { describe, expect, it } from "vitest";
import type { SavedPlaybook } from "@/shared/viscosity/playbook";
import { agentSeat } from "./engine/testFixtures";
import {
  mergePlaybookCatalog,
  resolveSeatPlaybook,
  roundtablePlaybookCatalog,
  seatPlaybookId,
  readOnlyEditingSeat,
  withSeatPlaybookInstructions,
} from "./playbooks";

const review: SavedPlaybook = {
  id: "review",
  label: "Review",
  instructions: "Read.",
  readOnly: true,
};
const debug: SavedPlaybook = { id: "debug", label: "Debug", instructions: "Repro first." };

describe("seat playbooks", () => {
  it("lets a seat override the table, null meaning none, absent meaning the table's", () => {
    expect(seatPlaybookId({ playbookId: "debug" }, {})).toBe("debug");
    expect(seatPlaybookId({ playbookId: "debug" }, { playbookId: "review" })).toBe("review");
    expect(seatPlaybookId({ playbookId: "debug" }, { playbookId: null })).toBeUndefined();
    expect(seatPlaybookId({}, {})).toBeUndefined();
    expect(resolveSeatPlaybook({ playbookId: "debug" }, {}, [review, debug])).toBe(debug);
    // A playbook deleted from the catalog binds nothing.
    expect(resolveSeatPlaybook({ playbookId: "gone" }, {}, [review, debug])).toBeUndefined();
  });

  it("puts an edited built-in in its built-in's place and custom playbooks after", () => {
    const edited = { ...review, label: "Strict review" };
    const custom = { id: "c-0000beef", label: "Mine", instructions: "Mine." };
    expect(mergePlaybookCatalog([review, debug], [custom, edited])).toEqual([
      edited,
      debug,
      custom,
    ]);
  });

  it("offers the ten built-ins with no saved playbooks", () => {
    const ids = roundtablePlaybookCatalog().map((playbook) => playbook.id);
    expect(ids).toHaveLength(10);
    expect(ids).toContain("reversing");
  });

  it("appends the playbook to an API seat's own instructions", () => {
    expect(withSeatPlaybookInstructions(undefined, undefined)).toBeUndefined();
    expect(withSeatPlaybookInstructions("Be brief.", undefined)).toBe("Be brief.");
    expect(withSeatPlaybookInstructions(undefined, debug)).toBe('Playbook "Debug":\nRepro first.');
    expect(withSeatPlaybookInstructions(" Be brief. ", debug)).toBe(
      'Be brief.\n\nPlaybook "Debug":\nRepro first.',
    );
  });

  it("refuses a read-only playbook only on a seat that must edit", () => {
    const catalog = [review, debug];
    const builder = agentSeat("b", "Builder", "builder");
    const reviewer = agentSeat("r", "Reviewer", "reviewer");
    const judge = agentSeat("j", "Judge", "judge");
    const blocked = (
      pattern: "build-review" | "relay" | "race" | "debate" | "open" | "compare",
      participants: ReturnType<typeof agentSeat>[],
      extra: { playbookId?: string; implementWinner?: boolean } = {},
    ) => readOnlyEditingSeat({ pattern, participants, ...extra }, catalog)?.seat.id;

    // Read-only table: every editing seat inherits it.
    for (const pattern of ["build-review", "relay", "race"] as const) {
      expect(blocked(pattern, [builder, reviewer], { playbookId: "review" })).toBe("b");
    }
    expect(
      blocked("debate", [builder, reviewer], { playbookId: "review", implementWinner: true }),
    ).toBe("b");
    expect(blocked("debate", [builder, reviewer], { playbookId: "review" })).toBeUndefined();
    expect(blocked("open", [builder, reviewer], { playbookId: "review" })).toBeUndefined();
    expect(blocked("compare", [builder, reviewer], { playbookId: "review" })).toBeUndefined();
    expect(blocked("build-review", [builder, reviewer], { playbookId: "debug" })).toBeUndefined();

    // No table playbook, read-only builder: refused; read-only reviewer: fine.
    expect(blocked("build-review", [reviewer, { ...builder, playbookId: "review" }])).toBe("b");
    expect(
      blocked("build-review", [builder, { ...reviewer, playbookId: "review" }]),
    ).toBeUndefined();
    // Without a builder role the first seat builds.
    expect(blocked("build-review", [{ ...reviewer, playbookId: "review" }, judge])).toBe("r");
    // Relay: any stage; race: any racer but not the seated judge.
    expect(blocked("relay", [builder, { ...reviewer, playbookId: "review" }])).toBe("r");
    expect(
      blocked("race", [builder, reviewer, { ...judge, playbookId: "review" }]),
    ).toBeUndefined();
    expect(blocked("race", [builder, { ...reviewer, playbookId: "review" }, judge])).toBe("r");

    // Read-only table whose editing seats choose otherwise: allowed.
    expect(
      blocked("build-review", [{ ...builder, playbookId: "debug" }, reviewer], {
        playbookId: "review",
      }),
    ).toBeUndefined();
    expect(
      blocked(
        "relay",
        [
          { ...builder, playbookId: null },
          { ...reviewer, playbookId: "debug" },
        ],
        {
          playbookId: "review",
        },
      ),
    ).toBeUndefined();
  });
});
