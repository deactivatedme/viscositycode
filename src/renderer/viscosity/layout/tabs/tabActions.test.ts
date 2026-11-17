import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppView, Project, Thread } from "@/shared/contracts";
import { useAppStore } from "@/renderer/state/appStore";
import { type FileEditorRootContext, useFileEditorStore } from "@/renderer/state/fileEditorStore";
import { useOpenTabsStore } from "./openTabsStore";
import {
  activateThreadTab,
  closeThreadTab,
  openNewThreadTab,
  showThreadInFocusedPane,
  toggleEditorTab,
} from "./tabActions";

const threadActions = vi.hoisted(() => ({
  openThread: vi.fn<(threadId: string) => void>(),
  openNewThread: vi.fn<(projectId?: string) => void>(),
}));

vi.mock("@/renderer/actions/threadActions", () => threadActions);

function thread(id: string, overrides: Partial<Thread> = {}): Thread {
  return {
    id,
    projectId: "p1",
    title: id,
    status: "idle",
    archived: false,
    done: false,
    ...overrides,
  } as Thread;
}

const THREADS = ["a", "b", "c", "d"].map((id) => thread(id));

function setView(view: AppView, focusedPaneId: string | null = null, threads = THREADS) {
  useAppStore.setState({
    threads,
    projects: [{ id: "p1", name: "Project" } as Project],
    view,
    focusedPaneId,
  });
}

function panes(): readonly string[] {
  const view = useAppStore.getState().view;
  return view.kind === "thread" ? view.panes : [];
}

const EDITOR_ROOT = {
  projectId: "p1",
  projectName: "Project",
  rootLabel: "Project",
} as FileEditorRootContext;

beforeEach(() => {
  threadActions.openThread.mockReset();
  threadActions.openNewThread.mockReset();
  useOpenTabsStore.setState({ ids: ["a", "b", "c", "d"] });
  useFileEditorStore.setState({ rootContext: null, overlayMode: null });
});

describe("showThreadInFocusedPane", () => {
  it("uses the sidebar's openThread for a single pane", () => {
    setView({ kind: "thread", panes: ["a"] }, "a");
    showThreadInFocusedPane("b");
    expect(panes()).toEqual(["a"]);
    expect(threadActions.openThread).toHaveBeenCalledWith("b");
  });

  it("swaps the thread into the focused pane of a split before opening it", () => {
    setView({ kind: "thread", panes: ["a", "b"] }, "b");
    showThreadInFocusedPane("c");
    expect(panes()).toEqual(["a", "c"]);
    expect(threadActions.openThread).toHaveBeenCalledWith("c");
  });

  it("leaves grouped threads to openThread", () => {
    setView({ kind: "thread", panes: ["a", "b"] }, "b", [
      ...THREADS.filter((item) => item.id !== "c"),
      thread("c", { groupId: "g1" }),
    ]);
    showThreadInFocusedPane("c");
    expect(panes()).toEqual(["a", "b"]);
    expect(threadActions.openThread).toHaveBeenCalledWith("c");
  });
});

describe("closeThreadTab", () => {
  it("only removes the tab of a thread that is not on screen", () => {
    setView({ kind: "thread", panes: ["a"] }, "a");
    closeThreadTab("c");
    expect(useOpenTabsStore.getState().ids).toEqual(["a", "b", "d"]);
    expect(panes()).toEqual(["a"]);
    expect(threadActions.openThread).not.toHaveBeenCalled();
  });

  it("shows the next tab in the focused pane when closing the visible thread", () => {
    setView({ kind: "thread", panes: ["b"] }, "b");
    closeThreadTab("b");
    expect(useOpenTabsStore.getState().ids).toEqual(["a", "c", "d"]);
    expect(threadActions.openThread).toHaveBeenCalledWith("c");
  });

  it("puts the next tab into the focused pane of a split", () => {
    setView({ kind: "thread", panes: ["a", "b"] }, "b");
    closeThreadTab("b");
    expect(panes()).toEqual(["a", "c"]);
    expect(threadActions.openThread).toHaveBeenCalledWith("c");
  });

  it("closes the pane when no other tab can take it", () => {
    useOpenTabsStore.setState({ ids: ["a", "b"] });
    setView({ kind: "thread", panes: ["a", "b"] }, "b");
    closeThreadTab("b");
    expect(panes()).toEqual(["a"]);
    expect(threadActions.openThread).not.toHaveBeenCalled();
  });

  it("closes the pane of a thread shown outside the focused pane", () => {
    setView({ kind: "thread", panes: ["a", "b"] }, "a");
    closeThreadTab("b");
    expect(useOpenTabsStore.getState().ids).toEqual(["a", "c", "d"]);
    expect(panes()).toEqual(["a"]);
    expect(threadActions.openThread).not.toHaveBeenCalled();
  });
});

describe("tab strip actions and the file editor panel", () => {
  it("activating a thread tab hides the inline editor panel", () => {
    useFileEditorStore.setState({ rootContext: EDITOR_ROOT, overlayMode: "modal" });
    setView({ kind: "thread", panes: ["a"] }, "a");
    activateThreadTab("b");
    expect(useFileEditorStore.getState().overlayMode).toBeNull();
    expect(threadActions.openThread).toHaveBeenCalledWith("b");
  });

  it("leaves the full-screen editor alone", () => {
    useFileEditorStore.setState({ rootContext: EDITOR_ROOT, overlayMode: "fullscreen" });
    openNewThreadTab();
    expect(useFileEditorStore.getState().overlayMode).toBe("fullscreen");
    expect(threadActions.openNewThread).toHaveBeenCalledWith();
  });

  it("toggles the inline editor panel only when the editor has a root", () => {
    toggleEditorTab();
    expect(useFileEditorStore.getState().overlayMode).toBeNull();

    useFileEditorStore.setState({ rootContext: EDITOR_ROOT });
    toggleEditorTab();
    expect(useFileEditorStore.getState().overlayMode).toBe("modal");
    toggleEditorTab();
    expect(useFileEditorStore.getState().overlayMode).toBeNull();
  });
});
