import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "@/renderer/state/appStore";
import { continueWithThread } from "./compareActions";
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
});

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
