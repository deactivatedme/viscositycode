import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "@/renderer/state/appStore";
import { type FileEditorRootContext, useFileEditorStore } from "@/renderer/state/fileEditorStore";
import { acquireViscosityShellFlag } from "@/renderer/viscosity/shellFlag";
import {
  closeRoundtableSetup,
  closeRoundtableView,
  hideRoundtablePanel,
  openRoundtableSetup,
  openRoundtableTab,
  openRoundtableView,
  showRoundtablePanel,
  startRoundtableViewSync,
  useRoundtableViewStore,
} from "./roundtableViewStore";

const toast = vi.hoisted(() => ({ info: vi.fn<(message: string) => void>() }));

vi.mock("@heroui/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@heroui/react")>()),
  toast,
}));

let releaseShell: (() => void) | undefined;

beforeEach(() => {
  toast.info.mockReset();
  useRoundtableViewStore.setState({ openSessionId: null, shown: false, setup: null });
  useFileEditorStore.setState({ rootContext: null, overlayMode: null });
  useAppStore.setState({ view: { kind: "thread", panes: ["a"] }, pendingActiveThreadId: null });
  releaseShell = acquireViscosityShellFlag(document.documentElement);
});

afterEach(() => {
  releaseShell?.();
});

describe("roundtable view store", () => {
  it("opens a session in front of the editor panel", () => {
    useFileEditorStore.setState({
      rootContext: { projectId: "p1" } as unknown as FileEditorRootContext,
      overlayMode: "modal",
    });
    openRoundtableView("rt1");
    expect(useRoundtableViewStore.getState()).toMatchObject({ openSessionId: "rt1", shown: true });
    expect(useFileEditorStore.getState().overlayMode).toBeNull();
  });

  it("hides the panel but keeps its tab, and closes both", () => {
    openRoundtableView("rt1");
    hideRoundtablePanel();
    expect(useRoundtableViewStore.getState()).toMatchObject({ openSessionId: "rt1", shown: false });
    showRoundtablePanel();
    expect(useRoundtableViewStore.getState().shown).toBe(true);
    closeRoundtableView();
    expect(useRoundtableViewStore.getState()).toMatchObject({ openSessionId: null, shown: false });
    showRoundtablePanel();
    expect(useRoundtableViewStore.getState().shown).toBe(false);
  });

  it("adds a started session's tab without bringing it forward", () => {
    useFileEditorStore.setState({
      rootContext: { projectId: "p1" } as unknown as FileEditorRootContext,
      overlayMode: "modal",
    });
    openRoundtableTab("rt1");
    expect(useRoundtableViewStore.getState()).toMatchObject({ openSessionId: "rt1", shown: false });
    // Nothing on screen changed: the editor panel stays in front.
    expect(useFileEditorStore.getState().overlayMode).toBe("modal");
    // A Roundtable the user is reading is never replaced.
    openRoundtableView("rt2");
    openRoundtableTab("rt3");
    expect(useRoundtableViewStore.getState()).toMatchObject({ openSessionId: "rt2", shown: true });
  });

  it("opens a fresh setup dialog each time", () => {
    openRoundtableSetup({ task: "Review this" });
    const first = useRoundtableViewStore.getState().setup;
    expect(first?.request).toEqual({ task: "Review this" });
    openRoundtableSetup();
    expect(useRoundtableViewStore.getState().setup?.nonce).not.toBe(first?.nonce);
    closeRoundtableSetup();
    expect(useRoundtableViewStore.getState().setup).toBeNull();
  });

  it("shows a desktop-only note outside the desktop shell", () => {
    releaseShell?.();
    releaseShell = undefined;
    openRoundtableView("rt1");
    openRoundtableSetup();
    expect(useRoundtableViewStore.getState()).toMatchObject({
      openSessionId: null,
      shown: false,
      setup: null,
    });
    expect(toast.info).toHaveBeenCalledTimes(2);
  });

  it("steps aside when the user opens a thread, changes view or shows the editor", () => {
    const stop = startRoundtableViewSync();
    try {
      openRoundtableView("rt1");
      useAppStore.setState({ pendingActiveThreadId: "a" });
      expect(useRoundtableViewStore.getState().shown).toBe(false);

      showRoundtablePanel();
      useAppStore.setState({ view: { kind: "draft" } as never });
      expect(useRoundtableViewStore.getState().shown).toBe(false);

      showRoundtablePanel();
      useFileEditorStore.setState({ overlayMode: "modal" });
      expect(useRoundtableViewStore.getState()).toMatchObject({
        openSessionId: "rt1",
        shown: false,
      });
    } finally {
      stop();
    }
  });

  it("steps aside for a new-thread draft, even when the view kind does not change", () => {
    const stop = startRoundtableViewSync();
    try {
      useAppStore.setState({ view: { kind: "draft" } as never });
      openRoundtableView("rt1");
      // Cmd+N or the sidebar's New thread on a draft view: same kind, new visit.
      useAppStore.setState((state) => ({ draftVisit: state.draftVisit + 1 }));
      expect(useRoundtableViewStore.getState()).toMatchObject({
        openSessionId: "rt1",
        shown: false,
      });
    } finally {
      stop();
    }
  });

  it("hides when the open draft moves to another project", () => {
    const stop = startRoundtableViewSync();
    try {
      useAppStore.setState({ view: { kind: "draft", projectId: "p1" } });
      openRoundtableView("rt1");
      useAppStore.getState().moveDraft("p2");
      expect(useRoundtableViewStore.getState().shown).toBe(false);
    } finally {
      stop();
    }
  });

  it("stays in front through store updates that are not navigation", () => {
    const stop = startRoundtableViewSync();
    try {
      openRoundtableView("rt1");
      useAppStore.setState({ threads: [] });
      useAppStore.setState({ view: { kind: "thread", panes: ["a", "b"] } });
      expect(useRoundtableViewStore.getState().shown).toBe(true);
    } finally {
      stop();
    }
  });
});
