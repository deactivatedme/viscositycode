import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "@/renderer/state/appStore";
import { type FileEditorRootContext, useFileEditorStore } from "@/renderer/state/fileEditorStore";
import { useBotChatPanelStore } from "@/renderer/viscosity/bots/botChatPanelStore";
import { useRoundtableViewStore } from "@/renderer/viscosity/roundtable/ui/roundtableViewStore";
import { acquireViscosityShellFlag } from "@/renderer/viscosity/shellFlag";
import {
  closeMissionControl,
  DEFAULT_MISSION_CONTROL_PREFS,
  MISSION_CONTROL_PREFS_KEY,
  openMissionControl,
  readMissionControlPrefs,
  setMissionControlFilter,
  setMissionControlTab,
  startMissionControlViewSync,
  toggleMissionControl,
  useMissionControlViewStore,
  writeMissionControlPrefs,
} from "./missionControlViewStore";

const toast = vi.hoisted(() => ({ info: vi.fn<(message: string) => void>() }));

vi.mock("@heroui/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@heroui/react")>()),
  toast,
}));

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    data,
  };
}

let releaseShell: (() => void) | undefined;
let stopSync: (() => void) | undefined;

beforeEach(() => {
  toast.info.mockReset();
  localStorage.removeItem(MISSION_CONTROL_PREFS_KEY);
  useMissionControlViewStore.setState({ shown: false, tabId: null, filter: "all" });
  useRoundtableViewStore.setState({ openSessionId: null, shown: false, setup: null });
  useBotChatPanelStore.setState({ openBotId: null });
  useFileEditorStore.setState({ rootContext: null, overlayMode: null });
  useAppStore.setState({ view: { kind: "thread", panes: ["a"] }, pendingActiveThreadId: null });
  releaseShell = acquireViscosityShellFlag(document.documentElement);
});

afterEach(() => {
  stopSync?.();
  stopSync = undefined;
  releaseShell?.();
});

describe("mission control preferences", () => {
  it("reads stored values and falls back on anything malformed", () => {
    expect(readMissionControlPrefs(null)).toBe(DEFAULT_MISSION_CONTROL_PREFS);
    expect(
      readMissionControlPrefs(
        memoryStorage({
          [MISSION_CONTROL_PREFS_KEY]: JSON.stringify({ tabId: "subscriptions", filter: "needs" }),
        }),
      ),
    ).toEqual({ tabId: "subscriptions", filter: "needs" });
    expect(
      readMissionControlPrefs(
        memoryStorage({
          [MISSION_CONTROL_PREFS_KEY]: JSON.stringify({ tabId: "../x y", filter: "everything" }),
        }),
      ),
    ).toEqual({ tabId: null, filter: "all" });
    expect(
      readMissionControlPrefs(memoryStorage({ [MISSION_CONTROL_PREFS_KEY]: "{not json" })),
    ).toBe(DEFAULT_MISSION_CONTROL_PREFS);
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readMissionControlPrefs(throwing)).toBe(DEFAULT_MISSION_CONTROL_PREFS);
  });

  it("writes best-effort and remembers the tab and filter", () => {
    const storage = memoryStorage();
    writeMissionControlPrefs({ tabId: "agents", filter: "errors" }, storage);
    expect(JSON.parse(storage.data.get(MISSION_CONTROL_PREFS_KEY)!)).toEqual({
      tabId: "agents",
      filter: "errors",
    });
    const full = {
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(() => writeMissionControlPrefs({ tabId: null, filter: "all" }, full)).not.toThrow();

    setMissionControlFilter("needs");
    setMissionControlTab("subscriptions");
    setMissionControlTab("not a valid id!");
    expect(useMissionControlViewStore.getState()).toMatchObject({
      tabId: "subscriptions",
      filter: "needs",
    });
    expect(readMissionControlPrefs()).toEqual({ tabId: "subscriptions", filter: "needs" });
  });
});

describe("mission control view", () => {
  it("opens in front of the editor, a Roundtable and a bot chat", () => {
    useFileEditorStore.setState({
      rootContext: { projectId: "p1" } as unknown as FileEditorRootContext,
      overlayMode: "modal",
    });
    useRoundtableViewStore.setState({ openSessionId: "rt1", shown: true });
    useBotChatPanelStore.setState({ openBotId: "bot1" });

    openMissionControl({ filter: "needs", tabId: "agents" });

    expect(useMissionControlViewStore.getState()).toMatchObject({
      shown: true,
      filter: "needs",
      tabId: "agents",
    });
    expect(useFileEditorStore.getState().overlayMode).toBeNull();
    // The Roundtable keeps its tab; only its panel steps aside.
    expect(useRoundtableViewStore.getState()).toMatchObject({ openSessionId: "rt1", shown: false });
    expect(useBotChatPanelStore.getState().openBotId).toBeNull();
  });

  it("toggles and closes", () => {
    toggleMissionControl();
    expect(useMissionControlViewStore.getState().shown).toBe(true);
    toggleMissionControl();
    expect(useMissionControlViewStore.getState().shown).toBe(false);
    openMissionControl();
    closeMissionControl();
    expect(useMissionControlViewStore.getState().shown).toBe(false);
  });

  it("says where it lives outside the desktop shell", () => {
    releaseShell?.();
    releaseShell = undefined;
    openMissionControl();
    expect(useMissionControlViewStore.getState().shown).toBe(false);
    expect(toast.info).toHaveBeenCalledWith("Mission Control is available in the desktop app.");
  });

  it("steps aside when the user goes to a thread, the editor, a Roundtable or a bot", () => {
    stopSync = startMissionControlViewSync();

    openMissionControl();
    useAppStore.setState({ pendingActiveThreadId: "t1" });
    expect(useMissionControlViewStore.getState().shown).toBe(false);

    openMissionControl();
    useAppStore.setState({ view: { kind: "home" } });
    expect(useMissionControlViewStore.getState().shown).toBe(false);

    openMissionControl();
    useFileEditorStore.setState({ overlayMode: "modal" });
    expect(useMissionControlViewStore.getState().shown).toBe(false);

    openMissionControl();
    useRoundtableViewStore.setState({ openSessionId: "rt1", shown: true });
    expect(useMissionControlViewStore.getState().shown).toBe(false);

    openMissionControl();
    useBotChatPanelStore.setState({ openBotId: "bot1" });
    expect(useMissionControlViewStore.getState().shown).toBe(false);
  });

  it("is never brought forward by agent activity", () => {
    stopSync = startMissionControlViewSync();
    useAppStore.setState({ pendingActiveThreadId: "t1" });
    useRoundtableViewStore.setState({ openSessionId: "rt1", shown: true });
    expect(useMissionControlViewStore.getState().shown).toBe(false);
  });
});
