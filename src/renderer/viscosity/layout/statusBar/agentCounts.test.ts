import { describe, expect, it } from "vitest";
import {
  type CountedThread,
  EMPTY_AGENT_STATE_COUNTS,
  countAgentStates,
  getAgentStateCounts,
  nextThreadToOpen,
  selectErrorCount,
  selectWaitingCount,
  selectWorkingCount,
} from "./agentCounts";

function thread(
  id: string,
  status: CountedThread["status"],
  overrides: Partial<CountedThread> = {},
): CountedThread {
  return { id, status, done: false, archived: false, ...overrides };
}

describe("countAgentStates", () => {
  it("counts working, waiting and errored threads", () => {
    const counts = countAgentStates([
      thread("w1", "working"),
      thread("w2", "launching"),
      thread("a1", "needs_approval"),
      thread("r1", "needs_reply"),
      thread("e1", "error"),
      thread("i1", "idle"),
      thread("f1", "finished"),
      thread("x1", "inactive"),
    ]);
    expect(counts).toEqual({
      working: 2,
      waiting: 2,
      errors: 1,
      waitingIds: ["a1", "r1"],
      errorIds: ["e1"],
    });
  });

  it("lets attention override a working status", () => {
    const counts = countAgentStates([
      thread("t1", "working", { attention: "needs_approval" }),
      thread("t2", "idle", { attention: "needs_reply" }),
    ]);
    expect(counts.working).toBe(0);
    expect(counts.waitingIds).toEqual(["t1", "t2"]);
  });

  it("skips archived and done threads", () => {
    expect(
      countAgentStates([
        thread("a", "working", { archived: true }),
        thread("b", "error", { done: true }),
        thread("c", "needs_reply", { archived: true }),
      ]),
    ).toBe(EMPTY_AGENT_STATE_COUNTS);
  });
});

describe("agent count selectors", () => {
  it("memoizes per threads array and returns primitives", () => {
    const threads = [thread("w", "working"), thread("a", "needs_reply"), thread("e", "error")];
    expect(getAgentStateCounts(threads)).toBe(getAgentStateCounts(threads));
    const state = { threads };
    expect(selectWorkingCount(state)).toBe(1);
    expect(selectWaitingCount(state)).toBe(1);
    expect(selectErrorCount(state)).toBe(1);
  });

  it("recounts when the threads array changes", () => {
    const before = [thread("a", "working")];
    const after = [thread("a", "needs_approval")];
    expect(selectWorkingCount({ threads: before })).toBe(1);
    expect(selectWorkingCount({ threads: after })).toBe(0);
    expect(selectWaitingCount({ threads: after })).toBe(1);
  });
});

describe("nextThreadToOpen", () => {
  it("opens the first waiting thread, then cycles from the one on screen", () => {
    expect(nextThreadToOpen([], null)).toBeNull();
    expect(nextThreadToOpen(["a", "b"], null)).toBe("a");
    expect(nextThreadToOpen(["a", "b"], "other")).toBe("a");
    expect(nextThreadToOpen(["a", "b"], "a")).toBe("b");
    expect(nextThreadToOpen(["a", "b"], "b")).toBe("a");
  });
});
