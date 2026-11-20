import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resumeEachWhenListed,
  threadIdsToResume,
  type ThreadPresenceSource,
  waitForThreads,
} from "./resumeGate";
import { agentSeat, makeSession } from "./testFixtures";

function presence(initial: string[] = []) {
  const listed = new Set(initial);
  const listeners = new Set<() => void>();
  const source: ThreadPresenceSource = {
    has: (threadId) => listed.has(threadId),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    source,
    listeners,
    add(threadId: string) {
      listed.add(threadId);
      for (const listener of listeners) listener();
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("resume gate after a reload", () => {
  const seats = [agentSeat("a", "Alpha"), agentSeat("b", "Beta")];

  it("lists the threads of running and paused sessions only", () => {
    const sessions = [
      makeSession("build-review", seats, { id: "s1", threadIds: { a: "t1", b: "t2" } }),
      makeSession("debate", seats, { id: "s2", status: "paused", threadIds: { a: "t3" } }),
      makeSession("relay", seats, { id: "s3", status: "done", threadIds: { a: "t4" } }),
      makeSession("open", seats, { id: "s4", status: "stopped", threadIds: { b: "t5" } }),
    ];
    expect(threadIdsToResume(sessions)).toEqual(["t1", "t2", "t3"]);
  });

  it("resumes at once when every thread is already listed", async () => {
    const { source, listeners } = presence(["t1"]);
    await expect(waitForThreads(["t1"], source)).resolves.toBeUndefined();
    expect(listeners.size).toBe(0);
  });

  it("waits until the host catalog lists the threads", async () => {
    vi.useFakeTimers();
    const { source, listeners, add } = presence();
    let resumed = false;
    void waitForThreads(["t1", "t2"], source).then(() => {
      resumed = true;
    });
    add("t1");
    await Promise.resolve();
    expect(resumed).toBe(false);
    add("t2");
    await vi.waitFor(() => expect(resumed).toBe(true));
    expect(listeners.size).toBe(0);
  });

  it("resumes anyway after the timeout when a thread never appears", async () => {
    vi.useFakeTimers();
    const { source, listeners } = presence();
    let resumed = false;
    void waitForThreads(["gone"], source, 1_000).then(() => {
      resumed = true;
    });
    await vi.advanceTimersByTimeAsync(999);
    expect(resumed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(resumed).toBe(true);
    expect(listeners.size).toBe(0);
  });

  it("resumes each session when its own threads are listed; a deleted thread delays only its session", async () => {
    vi.useFakeTimers();
    const { source } = presence(["t1"]);
    const sessions = [
      makeSession("open", seats, { id: "ok", threadIds: { a: "t1" } }),
      makeSession("open", seats, { id: "deleted", threadIds: { a: "gone" } }),
    ];
    const resumed: string[] = [];
    resumeEachWhenListed(
      sessions,
      source,
      (id) => sessions.find((session) => session.id === id),
      (session) => resumed.push(session.id),
      1_000,
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(resumed).toEqual(["ok"]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(resumed).toEqual(["ok", "deleted"]);
  });
});
