/**
 * ViscosityCode: "is the user already looking at it?" for the sound pack. A
 * thread in a pane of this window is on screen, unless a center panel (an open
 * Roundtable, a bot chat or Mission Control) covers the split view.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AppView } from "@/shared/contracts";
import { useAppStore } from "@/renderer/state/appStore";
import { useBotChatPanelStore } from "@/renderer/viscosity/bots/botChatPanelStore";
import { useMissionControlViewStore } from "@/renderer/viscosity/missionControl/missionControlViewStore";
import { useRoundtableViewStore } from "@/renderer/viscosity/roundtable/ui/roundtableViewStore";
import { isSplitViewCovered, isThreadOnScreen, isThreadShownInView } from "./visibility";

const splitView: AppView = { kind: "thread", panes: ["t1", "t2"] };
let previousView: AppView;

beforeEach(() => {
  previousView = useAppStore.getState().view;
  useAppStore.setState({ view: splitView });
});

afterEach(() => {
  useAppStore.setState({ view: previousView });
  useRoundtableViewStore.setState({ openSessionId: null, shown: false });
  useBotChatPanelStore.setState({ openBotId: null });
  useMissionControlViewStore.setState({ shown: false });
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

  it("counts no pane's thread while a bot chat covers the split view", () => {
    useBotChatPanelStore.setState({ openBotId: "bot-1" });
    expect(isSplitViewCovered()).toBe(true);
    expect(isThreadOnScreen("t1")).toBe(false);
    useBotChatPanelStore.setState({ openBotId: null });
    expect(isThreadOnScreen("t1")).toBe(true);
  });

  it("counts no pane's thread while Mission Control covers the split view", () => {
    useMissionControlViewStore.setState({ shown: true });
    expect(isSplitViewCovered()).toBe(true);
    expect(isThreadOnScreen("t2")).toBe(false);
    useMissionControlViewStore.setState({ shown: false });
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
