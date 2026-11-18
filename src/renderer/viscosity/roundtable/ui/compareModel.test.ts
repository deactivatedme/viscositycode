import { afterEach, describe, expect, it } from "vitest";
import type { CompareAnswer } from "../api";
import { participant, turn } from "./roundtable.testFixtures";
import {
  answerDurationMs,
  COMPARE_BODY_ATTRIBUTE,
  compareProgress,
  installScrollSync,
  syncedScrollTop,
} from "./compareModel";

describe("compare progress", () => {
  it("counts answered and settled columns", () => {
    const answers: CompareAnswer[] = [
      { participant: participant("a"), turn: turn("t1", { status: "done" }) },
      { participant: participant("b"), turn: turn("t2", { status: "failed" }) },
      { participant: participant("c"), turn: turn("t3", { status: "running" }) },
      { participant: participant("d"), turn: undefined },
    ];
    expect(compareProgress(answers)).toEqual({ settled: 2, answered: 1, total: 4 });
  });
});

describe("answer duration", () => {
  it("measures finished answers and running ones up to now", () => {
    const finished = turn("t", { status: "done", startedAt: 1_000, endedAt: 39_000 });
    expect(answerDurationMs(finished, 99_000)).toBe(38_000);
    const running = turn("t", { status: "running", startedAt: 1_000 });
    expect(answerDurationMs(running, 6_000)).toBe(5_000);
    expect(answerDurationMs({ ...running, status: "waiting-approval" }, 2_000)).toBe(1_000);
  });

  it("has none before the start or without an end", () => {
    expect(answerDurationMs(undefined, 5)).toBeNull();
    expect(answerDurationMs(turn("t", { status: "pending" }), 5)).toBeNull();
    expect(answerDurationMs(turn("t", { status: "stopped", startedAt: 1 }), 5)).toBeNull();
    // A clock skew never shows a negative time.
    expect(answerDurationMs(turn("t", { startedAt: 10, endedAt: 5 }), 5)).toBe(0);
  });
});

describe("scroll sync", () => {
  it("keeps the same relative position", () => {
    const source = { scrollTop: 250, scrollHeight: 1_100, clientHeight: 600 };
    expect(syncedScrollTop(source, { scrollHeight: 2_600, clientHeight: 600 })).toBe(1_000);
    // A column that does not scroll stays at the top.
    expect(syncedScrollTop(source, { scrollHeight: 400, clientHeight: 600 })).toBe(0);
    expect(
      syncedScrollTop({ ...source, scrollHeight: 600 }, { scrollHeight: 900, clientHeight: 600 }),
    ).toBe(0);
    // Overscroll (elastic scrolling) is clamped.
    expect(
      syncedScrollTop({ ...source, scrollTop: 900 }, { scrollHeight: 2_600, clientHeight: 600 }),
    ).toBe(2_000);
  });

  let cleanup: (() => void) | undefined;
  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    document.body.replaceChildren();
  });

  function column(scrollHeight: number): HTMLElement {
    const body = document.createElement("div");
    body.setAttribute(COMPARE_BODY_ATTRIBUTE, "");
    Object.defineProperty(body, "scrollHeight", { value: scrollHeight });
    Object.defineProperty(body, "clientHeight", { value: 100 });
    return body;
  }

  it("follows the column the user scrolls and ignores its own writes", () => {
    const container = document.createElement("div");
    const [first, second, third] = [column(300), column(500), column(100)];
    container.append(first!, second!, third!);
    document.body.append(container);
    cleanup = installScrollSync(container);

    first!.dispatchEvent(new Event("pointerover", { bubbles: true }));
    first!.scrollTop = 100;
    first!.dispatchEvent(new Event("scroll"));
    expect(second!.scrollTop).toBe(200);
    expect(third!.scrollTop).toBe(0);

    // The sync's own write to the second column fires a scroll event: ignored.
    second!.scrollTop = 400;
    second!.dispatchEvent(new Event("scroll"));
    expect(first!.scrollTop).toBe(100);

    // Once the user points at the second column, it leads.
    second!.dispatchEvent(new Event("pointerover", { bubbles: true }));
    second!.dispatchEvent(new Event("scroll"));
    expect(first!.scrollTop).toBe(200);

    cleanup();
    cleanup = undefined;
    first!.scrollTop = 0;
    first!.dispatchEvent(new Event("scroll"));
    expect(second!.scrollTop).toBe(400);
  });
});
