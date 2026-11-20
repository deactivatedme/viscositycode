import { describe, expect, it } from "vitest";
import type { RoundtableTurn } from "../roundtable/types";
import {
  buildMissionCards,
  cardMatchesFilter,
  countMissionFilters,
  countNeedsYou,
  isMissionFilter,
  type MissionCard,
  type MissionInputs,
  type MissionSession,
  type MissionThread,
  participantOwners,
  RECENT_FINISHED_WINDOW_MS,
  roundtableMissionState,
  sortMissionCards,
  threadMissionState,
} from "./missionModel";

const NOW = Date.parse("2026-11-18T12:00:00.000Z");
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

function thread(id: string, overrides: Partial<MissionThread> = {}): MissionThread {
  return {
    id,
    projectId: "p1",
    title: `Thread ${id}`,
    agentKind: "agent-x",
    status: "idle",
    archived: false,
    done: false,
    createdAt: iso(60 * 60_000),
    updatedAt: iso(30 * 60_000),
    presentationMode: "gui",
    ...overrides,
  } as MissionThread;
}

function turn(id: string, overrides: Partial<RoundtableTurn> = {}): RoundtableTurn {
  return { id, participantId: "a", round: 1, prompt: "p", status: "done", ...overrides };
}

function session(overrides: Partial<MissionSession> = {}): MissionSession {
  return {
    id: "rt1",
    title: "Fix the login bug",
    projectId: "p1",
    pattern: "build-review",
    status: "running",
    turns: [],
    threadIds: {},
    createdAt: NOW - 10 * 60_000,
    updatedAt: NOW - 60_000,
    ...overrides,
  };
}

function inputs(overrides: Partial<MissionInputs> = {}): MissionInputs {
  return {
    threads: [],
    sessions: [],
    now: NOW,
    ...overrides,
  };
}

const keys = (cards: readonly MissionCard[]) => cards.map((card) => card.key);

describe("threadMissionState", () => {
  it("maps live work, waits and errors whatever their age", () => {
    expect(threadMissionState(thread("a", { status: "working" }), NOW)?.state).toBe("working");
    expect(threadMissionState(thread("a", { status: "launching" }), NOW)?.state).toBe("working");
    expect(threadMissionState(thread("a", { status: "needs_approval" }), NOW)).toEqual({
      state: "attention",
      attentionKind: "approval",
    });
    expect(
      threadMissionState(thread("a", { status: "working", attention: "needs_reply" }), NOW),
    ).toEqual({ state: "attention", attentionKind: "reply" });
    expect(threadMissionState(thread("a", { status: "error" }), NOW)?.state).toBe("error");
  });

  it("keeps finished threads for the recent window only", () => {
    const recent = thread("a", { status: "finished", lastTurnEndedAt: iso(5 * 60_000) });
    const old = thread("b", {
      status: "finished",
      lastTurnEndedAt: iso(RECENT_FINISHED_WINDOW_MS + 1),
    });
    expect(threadMissionState(recent, NOW)?.state).toBe("done");
    expect(threadMissionState(old, NOW)).toBeNull();
    expect(threadMissionState(thread("c", { status: "idle" }), NOW)).toBeNull();
  });

  it("drops archived threads and reads a recent failed turn as an error", () => {
    expect(threadMissionState(thread("a", { status: "working", archived: true }), NOW)).toBeNull();
    const failed = thread("b", {
      status: "idle",
      lastTurnEndedAt: iso(60_000),
      interruptedTurn: "error",
    });
    expect(threadMissionState(failed, NOW)?.state).toBe("error");
  });
});

describe("buildMissionCards", () => {
  it("builds thread cards with timing, stop and the first error line", () => {
    const cards = buildMissionCards(
      inputs({
        threads: [
          thread("w", { status: "working", activeTurnStartedAt: iso(90_000) }),
          thread("t", { status: "working", presentationMode: "terminal" }),
          thread("e", { status: "error", errorMessage: "\n  Rate limited\nretry later" }),
        ],
      }),
    );
    const byKey = new Map(cards.map((card) => [card.key, card]));
    const working = byKey.get("thread:w");
    expect(working).toMatchObject({ state: "working", canStop: true, startedAt: NOW - 90_000 });
    // Terminal threads stop in their own terminal.
    expect(byKey.get("thread:t")).toMatchObject({ canStop: false, presentation: "terminal" });
    expect(byKey.get("thread:e")).toMatchObject({ state: "error", errorText: "Rate limited" });
  });

  it("lets a live Roundtable stand for its participant threads", () => {
    const cards = buildMissionCards(
      inputs({
        threads: [
          thread("pa", { status: "working" }),
          thread("pb", { status: "needs_reply" }),
          thread("solo", { status: "working" }),
        ],
        sessions: [session({ threadIds: { a: "pa", b: "pb" } })],
      }),
    );
    expect(keys(cards).toSorted()).toEqual(["roundtable:rt1", "thread:solo"]);
    // A participant waiting for the user makes the Roundtable wait too.
    expect(cards.find((card) => card.kind === "roundtable")).toMatchObject({
      state: "attention",
      reviewThreadId: "pb",
      canStop: true,
    });
  });

  it("points Review request at the waiting turn's participant", () => {
    const value = session({
      threadIds: { a: "pa", b: "pb" },
      turns: [
        turn("t1", { participantId: "b", status: "waiting-approval", startedAt: NOW - 5_000 }),
      ],
    });
    const [card] = buildMissionCards(
      inputs({ threads: [thread("pa"), thread("pb")], sessions: [value] }),
    );
    expect(card).toMatchObject({
      state: "attention",
      reviewThreadId: "pb",
      startedAt: NOW - 5_000,
    });
  });

  it("never points Review request at a deleted or archived participant thread", () => {
    const value = session({
      threadIds: { a: "pa", b: "pb" },
      turns: [turn("t1", { participantId: "b", status: "waiting-approval" })],
    });
    // Deleted: the waiting participant's thread is gone, so the card opens the Roundtable.
    const [deleted] = buildMissionCards(inputs({ threads: [thread("pa")], sessions: [value] }));
    expect(deleted).toMatchObject({ state: "attention", reviewThreadId: undefined });
    // Archived: same, and another participant that waits for the user takes over.
    const [archived] = buildMissionCards(
      inputs({
        threads: [thread("pa", { status: "needs_reply" }), thread("pb", { archived: true })],
        sessions: [value],
      }),
    );
    expect(archived).toMatchObject({ reviewThreadId: "pa" });
  });

  it("after a Roundtable ends, shows only the participants the user keeps using", () => {
    const cards = buildMissionCards(
      inputs({
        threads: [
          thread("pa", { status: "finished", lastTurnEndedAt: iso(60_000) }),
          thread("pb", { status: "working" }),
        ],
        sessions: [session({ status: "done", threadIds: { a: "pa", b: "pb" } })],
      }),
    );
    expect(keys(cards).toSorted()).toEqual(["roundtable:rt1", "thread:pb"]);
  });

  describe("participant threads shared by two Roundtables", () => {
    // A finished comparison and the debate seeded from it continue in the same threads.
    const comparison = (overrides: Partial<MissionSession> = {}) =>
      session({
        id: "cmp",
        status: "done",
        threadIds: { a: "pa", b: "pb" },
        createdAt: NOW - 30 * 60_000,
        updatedAt: NOW - 20 * 60_000,
        ...overrides,
      });
    const debate = (overrides: Partial<MissionSession> = {}) =>
      session({
        id: "deb",
        status: "running",
        threadIds: { a: "pa", b: "pb" },
        createdAt: NOW - 10 * 60_000,
        updatedAt: NOW - 60_000,
        ...overrides,
      });

    it("gives each thread to the live session, else the most recent one", () => {
      const owners = participantOwners([
        comparison({ threadIds: { a: "pa", b: "pb", c: "pc" } }),
        debate(),
        session({ id: "draft", status: "draft", threadIds: { a: "pa" }, createdAt: NOW }),
      ]);
      expect(Object.fromEntries(owners)).toEqual({ pa: "deb", pb: "deb", pc: "cmp" });
      // A live session keeps its threads even against a newer finished one.
      const reversed = participantOwners([
        comparison({ status: "running" }),
        debate({ status: "done" }),
      ]);
      expect(Object.fromEntries(reversed)).toEqual({ pa: "cmp", pb: "cmp" });
      // Two finished ones: the newer (the debate) owns them.
      const ended = participantOwners([debate({ status: "stopped" }), comparison()]);
      expect(Object.fromEntries(ended)).toEqual({ pa: "deb", pb: "deb" });
    });

    it("shows a waiting participant once, under the running debate", () => {
      const sources = {
        threads: [thread("pa", { status: "needs_approval" }), thread("pb", { status: "working" })],
        sessions: [comparison(), debate()],
      };
      const cards = buildMissionCards(inputs(sources));
      expect(keys(cards).toSorted()).toEqual(["roundtable:cmp", "roundtable:deb"]);
      expect(cards.find((card) => card.key === "roundtable:cmp")).toMatchObject({
        state: "done",
        reviewThreadId: undefined,
      });
      expect(cards.find((card) => card.key === "roundtable:deb")).toMatchObject({
        state: "attention",
        reviewThreadId: "pa",
      });
      expect(countNeedsYou(sources)).toBe(1);
    });

    it("never counts one wait twice when both sessions are live", () => {
      // A retried comparison and its debate both running over the same threads.
      const sources = {
        threads: [thread("pa", { status: "needs_approval" }), thread("pb", { status: "working" })],
        sessions: [
          comparison({
            status: "running",
            turns: [turn("t1", { participantId: "a", status: "waiting-approval" })],
          }),
          debate({ turns: [turn("t2", { participantId: "a", status: "waiting-approval" })] }),
        ],
      };
      const cards = buildMissionCards(inputs(sources));
      expect(keys(cards).toSorted()).toEqual(["roundtable:cmp", "roundtable:deb"]);
      expect(cards.find((card) => card.key === "roundtable:cmp")).toMatchObject({
        state: "working",
        reviewThreadId: undefined,
      });
      expect(cards.find((card) => card.key === "roundtable:deb")).toMatchObject({
        state: "attention",
        reviewThreadId: "pa",
      });
      expect(countNeedsYou(sources)).toBe(1);
    });

    it("after both end, shows each participant the user keeps using once", () => {
      const cards = buildMissionCards(
        inputs({
          threads: [
            thread("pa", { status: "finished", lastTurnEndedAt: iso(60_000) }),
            thread("pb", { status: "needs_reply" }),
          ],
          sessions: [comparison(), debate({ status: "done" })],
        }),
      );
      expect(keys(cards).toSorted()).toEqual(["roundtable:cmp", "roundtable:deb", "thread:pb"]);
      expect(
        countNeedsYou({
          threads: [thread("pb", { status: "needs_reply" })],
          sessions: [comparison(), debate({ status: "done" })],
        }),
      ).toBe(1);
    });
  });

  it("skips drafts and Roundtables that ended long ago", () => {
    expect(roundtableMissionState(session({ status: "draft" }), NOW)).toBeNull();
    expect(
      roundtableMissionState(
        session({ status: "failed", updatedAt: NOW - RECENT_FINISHED_WINDOW_MS - 1 }),
        NOW,
      ),
    ).toBeNull();
    expect(roundtableMissionState(session({ status: "failed" }), NOW)).toBe("error");
    expect(roundtableMissionState(session({ status: "stopped" }), NOW)).toBe("done");
    expect(roundtableMissionState(session({ status: "paused" }), NOW)).toBe("idle");
  });

  it("shows a team chat waiting for the next message as idle, and replying as working", () => {
    const notes = [{ id: "n1", text: "Hi", createdAt: NOW - 5_000 }];
    const reply = (status: RoundtableTurn["status"]) =>
      turn("t1", { round: 0, phase: "reply", noteId: "n1", status, startedAt: NOW - 4_000 });
    const idle = session({ pattern: "open", notes, turns: [reply("done")] });
    expect(roundtableMissionState(idle, NOW)).toBe("idle");
    const [card] = buildMissionCards(inputs({ sessions: [idle] }));
    // Its Stop only interrupts replies, so there is nothing to stop while it waits.
    expect(card).toMatchObject({ state: "idle", startedAt: undefined, canStop: false });
    const busy = session({ pattern: "open", notes, turns: [reply("running")] });
    expect(roundtableMissionState(busy, NOW)).toBe("working");
    const [busyCard] = buildMissionCards(inputs({ sessions: [busy] }));
    expect(busyCard).toMatchObject({ pattern: "open", canStop: true });
  });
});

describe("sorting and filters", () => {
  it("puts waits first, then errors, work and finished cards, newest first", () => {
    const cards = buildMissionCards(
      inputs({
        threads: [
          thread("done", { status: "finished", lastTurnEndedAt: iso(60_000) }),
          thread("old-work", { status: "working", activeTurnStartedAt: iso(10 * 60_000) }),
          thread("new-work", { status: "working", activeTurnStartedAt: iso(60_000) }),
          thread("err", { status: "error" }),
          thread("wait", { status: "needs_approval" }),
        ],
      }),
    );
    expect(keys(sortMissionCards(cards))).toEqual([
      "thread:wait",
      "thread:err",
      "thread:new-work",
      "thread:old-work",
      "thread:done",
    ]);
  });

  it("counts and filters by state", () => {
    const cards = buildMissionCards(
      inputs({
        threads: [
          thread("a", { status: "needs_approval" }),
          thread("b", { status: "working" }),
          thread("c", { status: "error" }),
          thread("d", { status: "finished", lastTurnEndedAt: iso(60_000) }),
        ],
        sessions: [session({ id: "paused", status: "paused" })],
      }),
    );
    expect(countMissionFilters(cards)).toEqual({
      all: 5,
      needs: 1,
      working: 1,
      errors: 1,
      done: 1,
    });
    expect(cards.filter((card) => cardMatchesFilter(card, "done")).map((card) => card.key)).toEqual(
      ["thread:d"],
    );
    expect(isMissionFilter("needs")).toBe(true);
    expect(isMissionFilter("nope")).toBe(false);
  });
});

describe("countNeedsYou", () => {
  it("counts each wait once, without a clock", () => {
    expect(
      countNeedsYou({
        threads: [
          thread("solo", {
            status: "needs_reply",
            lastTurnEndedAt: iso(10 * RECENT_FINISHED_WINDOW_MS),
          }),
          thread("pa", { status: "needs_approval" }),
          thread("chat", { status: "needs_approval" }),
          thread("busy", { status: "working" }),
          thread("archived", { status: "needs_approval", archived: true }),
        ],
        // The Roundtable and its waiting participant count as one.
        sessions: [
          session({
            threadIds: { a: "pa" },
            turns: [turn("t1", { status: "waiting-approval" })],
          }),
        ],
      }),
    ).toBe(3);
    expect(countNeedsYou({ threads: [], sessions: [] })).toBe(0);
  });
});
