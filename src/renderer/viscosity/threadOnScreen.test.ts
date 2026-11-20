/**
 * ViscosityCode: "is the user already looking at it?" for notifications. A
 * thread in a pane of this window is on screen, unless a center panel (an open
 * Roundtable or Mission Control) covers the split view.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AppView } from "@/shared/contracts";
import { useSideChatPanelStore } from "@/renderer/components/thread/SideChat/sideChatPanelStore";
import { useAppStore } from "@/renderer/state/appStore";
import { type FileEditorRootContext, useFileEditorStore } from "@/renderer/state/fileEditorStore";
import { usePanelStore } from "@/renderer/state/panelStore";
import { useMissionControlViewStore } from "@/renderer/viscosity/missionControl/missionControlViewStore";
import { useRoundtableStore } from "@/renderer/viscosity/roundtable/roundtableStore";
import type { RoundtableSession } from "@/renderer/viscosity/roundtable/types";
import { useRoundtableViewStore } from "@/renderer/viscosity/roundtable/ui/roundtableViewStore";
import { useZenModeStore } from "@/renderer/viscosity/zen/zenModeStore";
import { setOwnWindowThreadIds } from "@/renderer/state/auxiliaryThreadWindows";
import { isSplitViewCovered, isThreadOnScreen, isThreadShownInView } from "./threadOnScreen";

const splitView: AppView = { kind: "thread", panes: ["t1", "t2"] };
let previousView: AppView;

beforeEach(() => {
  previousView = useAppStore.getState().view;
  useAppStore.setState({ view: splitView });
});

afterEach(() => {
  useAppStore.setState({ view: previousView });
  useRoundtableViewStore.setState({ openSessionId: null, shown: false });
  useMissionControlViewStore.setState({ shown: false });
  useRoundtableStore.setState({ sessions: {} });
  useZenModeStore.setState({ active: false });
  useSideChatPanelStore.setState({ entry: null });
  usePanelStore.setState({ sideChatPanelOpen: false, rightPanelTab: "git", rightPanelSplit: null });
  useAppStore.setState({ focusedPaneId: null });
  useFileEditorStore.setState({ overlayMode: null, rootContext: null });
});

describe("isThreadOnScreen", () => {
  it("counts a thread shown in a pane of this window", () => {
    expect(isSplitViewCovered()).toBe(false);
    expect(isThreadOnScreen("t1")).toBe(true);
    expect(isThreadOnScreen("t2")).toBe(true);
    expect(isThreadOnScreen("elsewhere")).toBe(false);
  });

  it("counts no pane's thread while an open Roundtable covers the split view", () => {
    useRoundtableViewStore.setState({ openSessionId: "rt-1", shown: true });
    expect(isSplitViewCovered()).toBe(true);
    expect(isThreadOnScreen("t1")).toBe(false);
    // A Roundtable tab that steps aside (the user went back to a thread) covers nothing.
    useRoundtableViewStore.setState({ shown: false });
    expect(isThreadOnScreen("t1")).toBe(true);
    // Without an open session the panel shows nothing either.
    useRoundtableViewStore.setState({ openSessionId: null, shown: true });
    expect(isThreadOnScreen("t1")).toBe(true);
  });

  it("counts no pane's thread while Mission Control covers the split view", () => {
    useMissionControlViewStore.setState({ shown: true });
    expect(isSplitViewCovered()).toBe(true);
    expect(isThreadOnScreen("t2")).toBe(false);
    useMissionControlViewStore.setState({ shown: false });
    expect(isThreadOnScreen("t2")).toBe(true);
  });

  it("counts no pane's thread while the inline editor covers the split view", () => {
    const rootContext = { projectId: "p1" } as FileEditorRootContext;
    useFileEditorStore.setState({ overlayMode: "modal", rootContext });
    expect(isThreadOnScreen("t1")).toBe(false);
    // Without a root the editor panel renders nothing over the panes.
    useFileEditorStore.setState({ rootContext: null });
    expect(isThreadOnScreen("t1")).toBe(true);
  });
});

describe("isThreadOnScreen fork rules", () => {
  it("counts the shown Roundtable's participant threads, not the covered panes", () => {
    useRoundtableStore.setState({
      sessions: {
        "rt-1": {
          id: "rt-1",
          task: "",
          participants: [],
          turns: [],
          threadIds: { a: "p1" },
        } as unknown as RoundtableSession,
      },
    });
    useRoundtableViewStore.setState({ openSessionId: "rt-1", shown: true });
    expect(isThreadOnScreen("p1")).toBe(true);
    expect(isThreadOnScreen("t1")).toBe(false);
    useRoundtableViewStore.setState({ shown: false });
    expect(isThreadOnScreen("p1")).toBe(false);
    expect(isThreadOnScreen("t1")).toBe(true);
  });

  it("counts only the focused pane in Zen mode", () => {
    useAppStore.setState({ focusedPaneId: "t2" });
    useZenModeStore.setState({ active: true });
    expect(isThreadOnScreen("t2")).toBe(true);
    expect(isThreadOnScreen("t1")).toBe(false);
  });

  it("counts the side chat thread while the right panel shows it", () => {
    useAppStore.setState({ focusedPaneId: "t1" });
    useSideChatPanelStore.setState({
      entry: { id: "sc", source: { id: "t1" }, existingThreadId: "s1" } as never,
    });
    usePanelStore.setState({ sideChatPanelOpen: true, rightPanelTab: "sideChat" });
    expect(isThreadOnScreen("s1")).toBe(true);
    usePanelStore.setState({ rightPanelTab: "git" });
    expect(isThreadOnScreen("s1")).toBe(false);
    usePanelStore.setState({ rightPanelTab: "sideChat" });
    // Scoped to the focused pane's thread, and hidden by Zen.
    useAppStore.setState({ focusedPaneId: "t2" });
    expect(isThreadOnScreen("s1")).toBe(false);
    useAppStore.setState({ focusedPaneId: "t1" });
    useZenModeStore.setState({ active: true });
    expect(isThreadOnScreen("s1")).toBe(false);
  });

  it("counts the side chat the panel falls back to when the requested tab cannot show", () => {
    useAppStore.setState({ focusedPaneId: "t1" });
    useSideChatPanelStore.setState({
      entry: { id: "sc", source: { id: "t1" }, existingThreadId: "s1" } as never,
    });
    // The browser closed out-of-band and left rightPanelTab pointing at it.
    usePanelStore.setState({
      sideChatPanelOpen: true,
      rightPanelTab: "browser",
      browserPanelOpen: false,
    });
    expect(isThreadOnScreen("s1")).toBe(true);
    usePanelStore.setState({ browserPanelOpen: true });
    expect(isThreadOnScreen("s1")).toBe(false);
    usePanelStore.setState({ browserPanelOpen: false });
  });

  it("counts every pane in Zen mode while no focused pane is known", () => {
    useZenModeStore.setState({ active: true });
    expect(isThreadOnScreen("t1")).toBe(true);
    expect(isThreadOnScreen("t2")).toBe(true);
    useAppStore.setState({ focusedPaneId: "stale" });
    expect(isThreadOnScreen("t2")).toBe(true);
  });
});

describe("isThreadShownInView", () => {
  it("covers split panes and the candidates of an open experiment", () => {
    const candidates = (experimentId: string) => (experimentId === "x1" ? ["c1", "c2"] : []);
    expect(isThreadShownInView(splitView, "t2", candidates)).toBe(true);
    expect(
      isThreadShownInView(
        { kind: "experiment", experimentId: "x1", projectId: "p" },
        "c2",
        candidates,
      ),
    ).toBe(true);
    expect(isThreadShownInView({ kind: "home" }, "t1", candidates)).toBe(false);
  });
});

describe("isThreadOnScreen and thread windows", () => {
  afterEach(() => setOwnWindowThreadIds([]));

  it("never counts a thread that lives in its own window", () => {
    expect(isThreadOnScreen("t1")).toBe(true);
    setOwnWindowThreadIds(["t1"]);
    expect(isThreadOnScreen("t1")).toBe(false);
  });
});
