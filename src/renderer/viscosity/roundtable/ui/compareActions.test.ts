import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Thread } from "@/shared/contracts";
import { useAppStore } from "@/renderer/state/appStore";
import { FOLLOW_UP_ANSWER_CAP, continueWithThread, followUpMessage } from "./compareActions";
import { participant, turn } from "./roundtable.testFixtures";
import { useRoundtableViewStore } from "./roundtableViewStore";

const threads = vi.hoisted(() => ({
  openThread: vi.fn<(threadId: string, options?: { standalone?: boolean }) => void>(),
}));
vi.mock("@/renderer/actions/threadActions", () => threads);
const tabs = vi.hoisted(() => ({ hideEditorPanel: vi.fn<() => void>() }));
vi.mock("@/renderer/viscosity/layout/tabs/tabActions", () => tabs);

beforeEach(() => {
  threads.openThread.mockReset();
  tabs.hideEditorPanel.mockReset();
  useRoundtableViewStore.setState({ openSessionId: "cmp", shown: true, setup: null });
  useAppStore.setState({ threads: [answerThread()] });
});

function answerThread(archived = false): Thread {
  return { id: "answer-thread", projectId: "p1", archived } as Thread;
}

describe("continueWithThread", () => {
  it("opens the thread through the normal open path, not a pane swap", () => {
    // The open path focuses the composer, warms history and reopens an
    // inactive runtime; swapping the id into a pane would skip all of that.
    const view = { kind: "thread" as const, panes: ["t1", "t2"] as [string, ...string[]] };
    useAppStore.setState({ view, focusedPaneId: "t2" });
    continueWithThread("answer-thread");
    expect(threads.openThread).toHaveBeenCalledTimes(1);
    expect(threads.openThread).toHaveBeenCalledWith("answer-thread", { standalone: true });
    expect(useAppStore.getState().view).toBe(view);
    expect(useAppStore.getState().focusedPaneId).toBe("t2");
  });

  it("steps the editor and the Roundtable panel aside (the Roundtable stays open)", () => {
    useAppStore.setState({ view: { kind: "home" } });
    continueWithThread("answer-thread");
    expect(tabs.hideEditorPanel).toHaveBeenCalledTimes(1);
    expect(useRoundtableViewStore.getState()).toMatchObject({ openSessionId: "cmp", shown: false });
    expect(threads.openThread).toHaveBeenCalledWith("answer-thread", { standalone: true });
  });

  it("opens the thread on its own from a group view (not its whole Roundtable group)", () => {
    useAppStore.setState({
      view: { kind: "thread", panes: ["a", "b"], activeGroupId: "group-1" },
      focusedPaneId: "a",
    });
    continueWithThread("answer-thread");
    expect(threads.openThread).toHaveBeenCalledWith("answer-thread", { standalone: true });
  });
});

describe("continueWithThread and dead threads", () => {
  it("does nothing for a deleted or archived thread", () => {
    useAppStore.setState({ threads: [answerThread(true)] });
    continueWithThread("answer-thread");
    continueWithThread("deleted-thread");
    expect(threads.openThread).not.toHaveBeenCalled();
    expect(tabs.hideEditorPanel).not.toHaveBeenCalled();
    expect(useRoundtableViewStore.getState().shown).toBe(true);
  });
});

describe("followUpMessage", () => {
  it("quotes the task and each participant's latest answer, without live mentions", () => {
    const text = followUpMessage({
      task: "Which cache?",
      participants: [participant("a"), participant("b"), participant("c")],
      turns: [
        turn("a0", { participantId: "a", responseText: "Old" }),
        turn("a1", { participantId: "a", responseText: "Redis, ask @agent-b" }),
        turn("b0", { participantId: "b", responseText: "x".repeat(FOLLOW_UP_ANSWER_CAP + 10) }),
        turn("c0", { participantId: "c", status: "failed" }),
      ],
    });
    expect(text.startsWith("Earlier task:\n\n> Which cache?")).toBe(true);
    expect(text).toContain("Agent A answered:\n\n> Redis, ask @\u200Bagent-b");
    expect(text).not.toContain("Old");
    expect(text).toContain(`> ${"x".repeat(FOLLOW_UP_ANSWER_CAP)}…`);
    expect(text).not.toContain("Agent C answered");
    expect(text.endsWith("My follow-up:\n\n")).toBe(true);
  });

  it("is empty when there is nothing to quote", () => {
    expect(followUpMessage({ task: " ", participants: [participant("a")], turns: [] })).toBe("");
  });
});
