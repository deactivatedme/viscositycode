import { describe, expect, it } from "vitest";
import { agentSeat, makeSession } from "../engine/testFixtures";
import type { RoundtableTurn } from "../types";
import { isChatIdle } from "./patterns";

const seats = [agentSeat("a", "Alpha"), agentSeat("b", "Beta")];
const reply = (status: RoundtableTurn["status"]): RoundtableTurn => ({
  id: "t",
  participantId: "a",
  round: 0,
  prompt: "p",
  phase: "reply",
  status,
});

describe("isChatIdle", () => {
  it("is true only for a running open chat with no reply in flight", () => {
    expect(isChatIdle(makeSession("open", seats, { turns: [reply("done")] }))).toBe(true);
    for (const status of ["pending", "running", "waiting-approval"] as const) {
      expect(isChatIdle(makeSession("open", seats, { turns: [reply(status)] }))).toBe(false);
    }
    expect(isChatIdle(makeSession("open", seats, { status: "stopped" }))).toBe(false);
    expect(isChatIdle(makeSession("build-review", seats))).toBe(false);
  });

  it("is false while a message waits for its first reply, unless it was halted", () => {
    const note = { id: "n1", text: "Hi", createdAt: 1 };
    expect(isChatIdle(makeSession("open", seats, { notes: [note] }))).toBe(false);
    expect(isChatIdle(makeSession("open", seats, { notes: [{ ...note, halted: true }] }))).toBe(
      true,
    );
    const answered = { ...reply("done"), noteId: "n1" };
    expect(isChatIdle(makeSession("open", seats, { notes: [note], turns: [answered] }))).toBe(true);
  });
});
