import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project, Thread } from "@/shared/contracts";
import { useAppStore } from "@/renderer/state/appStore";
import type { RuntimeChatItem } from "@/renderer/state/slices/runtimeChatItem";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import type { PoolMemberView } from "@/renderer/viscosity/accountPools/poolModel";
import { viscosityCommands } from "@/renderer/viscosity/commands/viscosityCommands";
import { getActivityBarItem } from "@/renderer/viscosity/layout/activityBar/activityBarRegistry";
import { getStatusBarItems } from "@/renderer/viscosity/layout/statusBar/statusBarRegistry";
import { useRoundtableStore } from "@/renderer/viscosity/roundtable/roundtableStore";
import type { RoundtableSession } from "@/renderer/viscosity/roundtable/types";
import { useRoundtableViewStore } from "@/renderer/viscosity/roundtable/ui/roundtableViewStore";
import { acquireViscosityShellFlag } from "@/renderer/viscosity/shellFlag";
// Registers the tab, the activity/status bar items and the palette command.
import "../index";
import {
  MISSION_CONTROL_PREFS_KEY,
  openMissionControl,
  useMissionControlViewStore,
} from "../missionControlViewStore";
import { registerMissionControlTab } from "../tabs";
import { AgentsTab } from "./AgentsTab";
import { MissionControlHost } from "./MissionControlHost";
// Loaded up front so the lazy panel resolves without a transform pause.
import "./MissionControlPanel";
import { MissionControlStatusItem } from "./MissionControlStatusItem";

const mocks = vi.hoisted(() => ({
  activateThreadTab: vi.fn<(threadId: string) => void>(),
  interruptThread: vi.fn<(input: { threadId: string }) => Promise<void>>(async () => {}),
}));

vi.mock("@/renderer/viscosity/layout/tabs/tabActions", () => ({
  activateThreadTab: mocks.activateThreadTab,
}));

// The desktop shell is on unless a test turns it off (the window going compact).
const shell = vi.hoisted(() => ({ enabled: true, listeners: new Set<() => void>() }));
vi.mock("@/renderer/viscosity/layout/tabs/shellGate", async () => {
  const { useSyncExternalStore } = await import("react");
  const subscribe = (listener: () => void) => {
    shell.listeners.add(listener);
    return () => {
      shell.listeners.delete(listener);
    };
  };
  return {
    useViscosityShellEnabled: () => useSyncExternalStore(subscribe, () => shell.enabled),
  };
});

function setShellEnabled(enabled: boolean): void {
  act(() => {
    shell.enabled = enabled;
    for (const listener of shell.listeners) listener();
  });
}

vi.mock("@/renderer/bridge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/renderer/bridge")>()),
  readBridge: () => ({ interruptThread: mocks.interruptThread }),
}));

vi.mock("../missionPools", () => ({
  useMissionPoolViews: () =>
    new Map([
      [
        "agent-x",
        { agentKind: "agent-x", label: "Work", percentLeft: 62, tone: "ok" } as PoolMemberView,
      ],
    ]),
}));

vi.mock("@/renderer/viscosity/accountPools/poolHooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/renderer/viscosity/accountPools/poolHooks")>()),
  useAccountLabelResolver: () => (agentKind: string) =>
    agentKind === "agent-x" ? "Agent X" : "Agent Y",
}));

const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

function thread(id: string, overrides: Partial<Thread>): Thread {
  return {
    id,
    projectId: "p1",
    title: id,
    agentKind: "agent-x",
    status: "idle",
    archived: false,
    done: false,
    presentationMode: "gui",
    createdAt: iso(3_600_000),
    updatedAt: iso(60_000),
    ...overrides,
  } as Thread;
}

const THREADS: Thread[] = [
  thread("t-done", { title: "Write docs", status: "finished", lastTurnEndedAt: iso(90_000) }),
  thread("t-work", {
    title: "Refactor store",
    agentKind: "agent-y",
    status: "working",
    activeTurnStartedAt: iso(30_000),
  }),
  thread("t-err", { title: "Broken build", status: "error", errorMessage: "Rate limited" }),
  thread("t-wait", { title: "Approve deploy", status: "needs_approval" }),
];

function runtimeItem(id: string, overrides: Partial<RuntimeChatItem>): RuntimeChatItem {
  return { id, type: "user_message", state: "completed", streams: {}, ...overrides };
}

function cardKeys(): string[] {
  return screen
    .getAllByRole("listitem")
    .map((element) => element.getAttribute("data-vc-mc-card") ?? "");
}

function card(key: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-vc-mc-card="${key}"]`);
  if (!element) throw new Error(`No card ${key}`);
  return element;
}

let releaseShell: (() => void) | undefined;
const originalGetAnimations = Object.getOwnPropertyDescriptor(Element.prototype, "getAnimations");

beforeAll(() => {
  // JSDOM has no Web Animations API; the tab indicator inspects active animations.
  Object.defineProperty(Element.prototype, "getAnimations", {
    configurable: true,
    value: () => [],
  });
});

afterAll(() => {
  if (originalGetAnimations) {
    Object.defineProperty(Element.prototype, "getAnimations", originalGetAnimations);
  } else {
    Reflect.deleteProperty(Element.prototype, "getAnimations");
  }
});

beforeEach(() => {
  shell.enabled = true;
  mocks.activateThreadTab.mockReset();
  mocks.interruptThread.mockClear();
  localStorage.removeItem(MISSION_CONTROL_PREFS_KEY);
  document.documentElement.dataset.windowKind = "main";
  releaseShell = acquireViscosityShellFlag(document.documentElement);
  useMissionControlViewStore.setState({ shown: false, tabId: null, filter: "all" });
  useRoundtableStore.setState({ sessions: {} });
  useRoundtableViewStore.setState({ openSessionId: null, shown: false, setup: null });
  useAppStore.setState({
    threads: THREADS,
    projects: [{ id: "p1", name: "Viscosity" } as Project],
    view: { kind: "thread", panes: ["t-done"] },
    pendingActiveThreadId: null,
    runtimeItemIdsByThread: { "t-work": ["u", "tool"] },
    runtimeItemsByIdByThread: {
      "t-work": {
        u: runtimeItem("u", {}),
        tool: runtimeItem("tool", {
          type: "command_execution",
          state: "started",
          payload: { command: "bun test" },
        }),
      },
    },
  });
});

afterEach(() => {
  releaseShell?.();
  delete document.documentElement.dataset.windowKind;
});

describe("Mission Control registration", () => {
  it("adds the Agents tab, the activity and status bar items and the palette command", () => {
    const item = getActivityBarItem("mission-control");
    expect(item).toMatchObject({ order: 110, position: "top", toggle: true });
    expect(getStatusBarItems().some((entry) => entry.id === "mission-control")).toBe(true);

    const command = viscosityCommands().find(
      (entry) => entry.id === "viscosity.missionControl.open",
    );
    expect(command).toBeDefined();
    void command?.run();
    expect(useMissionControlViewStore.getState()).toMatchObject({ shown: true, tabId: "agents" });

    item?.action?.();
    expect(useMissionControlViewStore.getState().shown).toBe(false);
  });
});

describe("AgentsTab", () => {
  it("shows waits first with live state, project, step and account", () => {
    render(<AgentsTab />);
    expect(cardKeys()).toEqual(["thread:t-wait", "thread:t-err", "thread:t-work", "thread:t-done"]);

    const waiting = card("thread:t-wait");
    expect(waiting).toHaveAttribute("data-vc-fx-state", "attention");
    expect(waiting).toHaveAttribute("data-vc-agent-kind", "agent-x");
    expect(within(waiting).getByText("Needs approval")).toBeInTheDocument();
    expect(within(waiting).getByText("Viscosity")).toBeInTheDocument();
    expect(within(waiting).getByText("Account Work, 62% of usage left")).toBeInTheDocument();

    const working = card("thread:t-work");
    expect(working).toHaveAttribute("data-vc-fx-state", "tool");
    expect(within(working).getByText("Running a tool")).toBeInTheDocument();
    expect(within(working).getByText("bun test")).toBeInTheDocument();
    expect(within(working).getByText(/^Running \d+s$/)).toBeInTheDocument();
    // Only pooled accounts show one.
    expect(within(working).queryByText(/usage left/)).toBeNull();

    expect(within(card("thread:t-err")).getByText("Rate limited")).toBeInTheDocument();
    expect(within(card("thread:t-done")).getByText("Finished 1m ago")).toBeInTheDocument();
  });

  it("offers Review request only for waits, and it only opens the thread", () => {
    useMissionControlViewStore.setState({ shown: true });
    render(<AgentsTab />);
    expect(screen.getAllByRole("button", { name: /^Review request/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Review request: Approve deploy" }));
    expect(mocks.activateThreadTab).toHaveBeenCalledExactlyOnceWith("t-wait");
    expect(mocks.interruptThread).not.toHaveBeenCalled();
    expect(useMissionControlViewStore.getState().shown).toBe(false);
  });

  it("stops a working chat thread with the composer's interrupt", async () => {
    render(<AgentsTab />);
    expect(screen.getAllByRole("button", { name: /^Stop / })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Stop Refactor store" }));
    await waitFor(() =>
      expect(mocks.interruptThread).toHaveBeenCalledExactlyOnceWith({ threadId: "t-work" }),
    );
  });

  it("keeps keyboard focus on the card while stopping and after Stop goes away", async () => {
    render(<AgentsTab />);
    const stopButton = screen.getByRole("button", { name: "Stop Refactor store" });
    act(() => stopButton.focus());
    fireEvent.click(stopButton);
    await waitFor(() => expect(mocks.interruptThread).toHaveBeenCalledTimes(1));
    expect(document.activeElement).toBe(stopButton);

    act(() => {
      useAppStore.setState({
        threads: THREADS.map((entry): Thread =>
          entry.id === "t-work" ? { ...entry, status: "idle", lastTurnEndedAt: iso(0) } : entry,
        ),
      });
    });
    expect(screen.queryByRole("button", { name: /^Stop / })).toBeNull();
    expect(document.activeElement).toBe(
      within(card("thread:t-work")).getByRole("button", { name: "Refactor store" }),
    );
  });

  it("filters by state, remembers the filter, and explains an empty filter", () => {
    render(<AgentsTab />);
    fireEvent.click(screen.getByText("Needs you"));
    expect(cardKeys()).toEqual(["thread:t-wait"]);
    expect(useMissionControlViewStore.getState().filter).toBe("needs");
    expect(JSON.parse(localStorage.getItem(MISSION_CONTROL_PREFS_KEY) ?? "{}")).toMatchObject({
      filter: "needs",
    });

    fireEvent.click(screen.getByText("Done"));
    expect(cardKeys()).toEqual(["thread:t-done"]);

    act(() => {
      useAppStore.setState({ threads: THREADS.filter((entry) => entry.id !== "t-done") });
    });
    expect(screen.getByText("Nothing finished recently")).toBeInTheDocument();
  });

  it("says when nothing is running", () => {
    useAppStore.setState({ threads: [] });
    render(<AgentsTab />);
    expect(screen.getByText("No agents running")).toBeInTheDocument();
  });

  it("is one tab stop; arrows move between cards and Enter opens one", () => {
    render(<AgentsTab />);
    const stops = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-vc-mc-focus]"));
    expect(stops.map((element) => element.textContent)).toEqual([
      "Approve deploy",
      "Broken build",
      "Refactor store",
      "Write docs",
    ]);
    expect(stops.map((element) => element.tabIndex)).toEqual([0, -1, -1, -1]);
    expect(stops[0]).toHaveAccessibleDescription("Needs approval");

    stops[0]!.focus();
    fireEvent.keyDown(stops[0]!, { key: "ArrowRight" });
    expect(document.activeElement).toBe(stops[1]);
    expect(stops.map((element) => element.tabIndex)).toEqual([-1, 0, -1, -1]);

    fireEvent.keyDown(stops[1]!, { key: "End" });
    expect(document.activeElement).toBe(stops[3]);
    fireEvent.keyDown(stops[3]!, { key: "Home" });
    expect(document.activeElement).toBe(stops[0]);

    // A native button: Enter activates it as a click.
    fireEvent.click(stops[3]!);
    expect(mocks.activateThreadTab).toHaveBeenCalledExactlyOnceWith("t-done");
  });

  it("shows a live Roundtable once, waiting when a participant waits", () => {
    const session: RoundtableSession = {
      id: "rt1",
      version: 1,
      title: "Pick a cache",
      task: "Compare caches",
      pattern: "debate",
      projectId: "p1",
      participants: [],
      threadIds: { a: "t-wait", b: "t-work" },
      maxRounds: 2,
      status: "running",
      turns: [],
      createdAt: Date.now() - 60_000,
      updatedAt: Date.now() - 1_000,
    };
    useRoundtableStore.setState({ sessions: { rt1: session } });
    render(<AgentsTab />);
    expect(cardKeys()).toEqual(["roundtable:rt1", "thread:t-err", "thread:t-done"]);
    const roundtable = card("roundtable:rt1");
    expect(within(roundtable).getByText("Waiting for you")).toBeInTheDocument();
    fireEvent.click(within(roundtable).getByRole("button", { name: /^Review request/ }));
    expect(mocks.activateThreadTab).toHaveBeenCalledExactlyOnceWith("t-wait");
  });
});

describe("AgentsTab Work together", () => {
  it("labels a team chat's Stop as Stop replies", () => {
    const session: RoundtableSession = {
      id: "rt-open",
      version: 1,
      title: "Team chat",
      task: "Talk it through",
      pattern: "open",
      projectId: "p1",
      participants: [],
      threadIds: {},
      maxRounds: 2,
      status: "running",
      turns: [{ id: "u1", participantId: "a", round: 1, prompt: "Hi", status: "running" }],
      createdAt: Date.now() - 60_000,
      updatedAt: Date.now() - 1_000,
    };
    useRoundtableStore.setState({ sessions: { "rt-open": session } });
    render(<AgentsTab />);
    const stop = within(card("roundtable:rt-open")).getByRole("button", {
      name: "Stop replies in Team chat",
    });
    expect(stop).toHaveTextContent("Stop replies");
  });
});

describe("MissionControlHost", () => {
  it("shows the registered tabs over the split view and steps aside on Escape", async () => {
    const unregister = registerMissionControlTab({
      id: "extra",
      label: { id: "extra", message: "Extra" },
      order: 20,
      component: () => <p>Extra content</p>,
    });
    render(<MissionControlHost />);
    expect(document.querySelector("[data-vc-mission-control]")).toBeNull();

    act(() => openMissionControl());
    const panel = await screen.findByRole(
      "region",
      { name: "Mission Control" },
      { timeout: 10_000 },
    );
    expect(panel).toHaveAttribute("data-vc-cover-panel");
    const tabs = within(panel).getAllByRole("tab");
    // The feature entry also brings in the Subscriptions tab (registered on import).
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Agents", "Subscriptions", "Extra"]);
    expect(
      await within(panel).findByText("Approve deploy", {}, { timeout: 10_000 }),
    ).toBeInTheDocument();

    fireEvent.click(within(panel).getByRole("tab", { name: "Extra" }));
    expect(await within(panel).findByText("Extra content")).toBeInTheDocument();
    expect(useMissionControlViewStore.getState().tabId).toBe("extra");

    fireEvent.keyDown(panel, { key: "Escape" });
    expect(useMissionControlViewStore.getState().shown).toBe(false);
    await waitFor(() => expect(document.querySelector("[data-vc-mission-control]")).toBeNull());
    unregister();
  });

  /** The center body as the frame draws it: the panes, then the host over them. */
  function CenterBody(props: { withHost: boolean }) {
    return (
      <div data-vc-center-body="">
        <div data-testid="panes">
          <button type="button">Pane</button>
        </div>
        {props.withHost ? <MissionControlHost /> : null}
      </div>
    );
  }

  async function openPanel(): Promise<HTMLElement> {
    act(() => openMissionControl());
    const panel = await screen.findByRole(
      "region",
      { name: "Mission Control" },
      { timeout: 10_000 },
    );
    expect(screen.getByTestId("panes")).toHaveAttribute("inert");
    return panel;
  }

  it("closes cleanly when the shell turns off while it is open", async () => {
    render(<CenterBody withHost />);
    await openPanel();

    setShellEnabled(false);
    expect(useMissionControlViewStore.getState().shown).toBe(false);
    expect(document.querySelector("[data-vc-mission-control]")).toBeNull();
    expect(screen.getByTestId("panes")).not.toHaveAttribute("inert");

    // Wide again: it does not come back over whatever the user opened meanwhile.
    setShellEnabled(true);
    expect(useMissionControlViewStore.getState().shown).toBe(false);
    expect(document.querySelector("[data-vc-mission-control]")).toBeNull();
    expect(screen.getByTestId("panes")).not.toHaveAttribute("inert");
  });

  it("closes cleanly when the compact layout drops the host", async () => {
    const view = render(<CenterBody withHost />);
    await openPanel();

    view.rerender(<CenterBody withHost={false} />);
    expect(useMissionControlViewStore.getState().shown).toBe(false);
    expect(screen.getByTestId("panes")).not.toHaveAttribute("inert");

    view.rerender(<CenterBody withHost />);
    expect(document.querySelector("[data-vc-mission-control]")).toBeNull();
    // The view sync is installed again: the panel still steps aside for a Roundtable.
    await openPanel();
    act(() => useRoundtableViewStore.setState({ shown: true }));
    expect(useMissionControlViewStore.getState().shown).toBe(false);
    await waitFor(() => expect(document.querySelector("[data-vc-mission-control]")).toBeNull());
    expect(screen.getByTestId("panes")).not.toHaveAttribute("inert");
  });
});

describe("MissionControlStatusItem", () => {
  it("counts what needs the user and opens the board on Needs you", () => {
    const { rerender } = render(<MissionControlStatusItem />);
    const button = screen.getByRole("button", { name: "Open Mission Control: 1 needs you" });
    fireEvent.click(button);
    expect(useMissionControlViewStore.getState()).toMatchObject({
      shown: true,
      filter: "needs",
      tabId: "agents",
    });

    act(() => {
      useAppStore.setState({ threads: THREADS.filter((entry) => entry.id !== "t-wait") });
    });
    rerender(<MissionControlStatusItem />);
    expect(screen.queryByRole("button", { name: /need/ })).toBeNull();
  });
});
