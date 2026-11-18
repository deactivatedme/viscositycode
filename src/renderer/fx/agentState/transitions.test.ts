import { afterEach, describe, expect, it, vi } from "vitest";
import { createStore } from "zustand/vanilla";
import type { Thread } from "@/shared/contracts";
import { DEFAULT_FX_SETTINGS, type EffectsSettings } from "@/renderer/fx/fxSettingsStore";
import { type AgentMonitorState, createAgentStateMonitor } from "./monitor";
import { type AgentFxTransition, emitAgentFxTransition, onAgentFxTransition } from "./transitions";

function thread(id: string, patch: Partial<Thread> = {}): Thread {
  return {
    id,
    status: "working",
    attention: "working",
    presentationMode: "gui",
    archived: false,
    ...patch,
  } as Thread;
}

function createHarness(initial: Partial<AgentMonitorState> = {}) {
  const store = createStore<AgentMonitorState>()(() => ({
    threads: [],
    view: { kind: "home" },
    runtimeItemIdsByThread: {},
    runtimeItemsByIdByThread: {},
    runtimeRequestsByThread: {},
    runtimeStructuralVersionByThread: {},
    ...initial,
  }));
  const effects = createStore<{ effects: EffectsSettings }>()(() => ({
    effects: DEFAULT_FX_SETTINGS.effects,
  }));
  const transitions: AgentFxTransition[] = [];
  const monitor = createAgentStateMonitor({
    document,
    store: { getState: store.getState, subscribe: (listener) => store.subscribe(listener) },
    tabs: { getIds: () => [], subscribe: () => () => undefined },
    effects: {
      get: () => effects.getState().effects,
      subscribe: (listener) => effects.subscribe(() => listener()),
    },
    setEnergy: () => undefined,
    setToolsRunning: () => undefined,
    requestFrame: () => 0,
    cancelFrame: () => undefined,
    setTimer: () => 0 as unknown as ReturnType<typeof setTimeout>,
    clearTimer: () => undefined,
    setRepeating: () => 0 as unknown as ReturnType<typeof setInterval>,
    clearRepeating: () => undefined,
    installTyping: () => () => undefined,
    onTransition: (transition) => transitions.push(transition),
  });
  return {
    store,
    effects,
    monitor,
    transitions,
    setThreads(threads: Thread[]) {
      store.setState({ threads });
    },
  };
}

const paneView = (...panes: [string, ...string[]]): AgentMonitorState["view"] => ({
  kind: "thread",
  panes,
});

describe("agent transitions from the monitor", () => {
  let stop: (() => void) | null = null;

  afterEach(() => {
    stop?.();
    stop = null;
  });

  it("reports nothing for the states threads already have at start", () => {
    const h = createHarness({
      threads: [
        thread("w"),
        thread("a", { status: "needs_approval", attention: "needs_approval" }),
        thread("e", { status: "error", attention: "error" }),
      ],
      view: paneView("a", "e"),
    });
    h.monitor.start();
    stop = () => h.monitor.stop();
    expect(h.transitions).toEqual([]);
  });

  it("reports a background thread finishing, though it leaves tracking", () => {
    const h = createHarness({ threads: [thread("bg")] });
    h.monitor.start();
    stop = () => h.monitor.stop();
    expect(h.monitor.snapshot().map((entry) => entry.threadId)).toEqual(["bg"]);

    h.setThreads([thread("bg", { status: "idle", attention: "none" })]);
    expect(h.transitions).toEqual([{ threadId: "bg", kind: "done" }]);
    expect(h.monitor.snapshot()).toEqual([]);
  });

  it("reports a background thread failing", () => {
    const h = createHarness({ threads: [thread("bg")] });
    h.monitor.start();
    stop = () => h.monitor.stop();
    h.setThreads([thread("bg", { status: "error", attention: "error" })]);
    expect(h.transitions).toEqual([{ threadId: "bg", kind: "error" }]);
  });

  it("reports a thread in a pane finishing or failing once, with its flash", () => {
    const h = createHarness({ threads: [thread("p"), thread("q")], view: paneView("p", "q") });
    h.monitor.start();
    stop = () => h.monitor.stop();
    h.setThreads([
      thread("p", { status: "idle", attention: "none" }),
      thread("q", { status: "error", attention: "error" }),
    ]);
    expect(h.transitions).toEqual([
      { threadId: "p", kind: "done" },
      { threadId: "q", kind: "error" },
    ]);
    const flashes = Object.fromEntries(
      h.monitor.snapshot().map((entry) => [entry.threadId, entry.flash]),
    );
    expect(flashes).toEqual({ p: "done", q: "error" });
  });

  it("reports when a working thread starts waiting for approval, and again for the next request", () => {
    const h = createHarness({ threads: [thread("bg")] });
    h.monitor.start();
    stop = () => h.monitor.stop();
    h.setThreads([thread("bg", { status: "needs_approval", attention: "needs_approval" })]);
    expect(h.transitions).toEqual([{ threadId: "bg", kind: "attention" }]);

    // Still waiting (approval → reply): not a new transition.
    h.setThreads([thread("bg", { status: "needs_reply", attention: "needs_reply" })]);
    expect(h.transitions).toHaveLength(1);

    h.setThreads([thread("bg")]);
    h.setThreads([thread("bg", { status: "needs_approval", attention: "needs_approval" })]);
    expect(h.transitions).toEqual([
      { threadId: "bg", kind: "attention" },
      { threadId: "bg", kind: "attention" },
    ]);
  });

  it("reports a turn that settles with an open question as attention, not done", () => {
    const h = createHarness({ threads: [thread("p"), thread("bg")], view: paneView("p") });
    h.monitor.start();
    stop = () => h.monitor.stop();
    h.setThreads([
      thread("p", { status: "idle", attention: "needs_reply" }),
      thread("bg", { status: "idle", attention: "needs_reply" }),
    ]);
    expect(h.transitions).toEqual([
      { threadId: "bg", kind: "attention" },
      { threadId: "p", kind: "attention" },
    ]);
    // The pane still shows the usual completion flash.
    expect(h.monitor.snapshot().find((entry) => entry.threadId === "p")?.flash).toBe("done");
  });

  it("does not announce a wait twice when the turn settles while still waiting", () => {
    const h = createHarness({ threads: [thread("bg")] });
    h.monitor.start();
    stop = () => h.monitor.stop();
    h.setThreads([thread("bg", { status: "needs_reply", attention: "needs_reply" })]);
    h.setThreads([thread("bg", { status: "idle", attention: "needs_reply" })]);
    expect(h.transitions).toEqual([{ threadId: "bg", kind: "attention" }]);
  });

  it("reports a background thread that goes straight from idle to an approval", () => {
    const h = createHarness({ threads: [thread("bg", { status: "idle", attention: "none" })] });
    h.monitor.start();
    stop = () => h.monitor.stop();
    h.setThreads([thread("bg", { status: "needs_approval", attention: "needs_approval" })]);
    expect(h.transitions).toEqual([{ threadId: "bg", kind: "attention" }]);
  });

  it("stays quiet for a waiting thread that is opened, or that is new to the store", () => {
    const waiting = thread("w", { status: "needs_approval", attention: "needs_approval" });
    const h = createHarness({ threads: [] });
    h.monitor.start();
    stop = () => h.monitor.stop();
    // Appears already waiting (e.g. a host reconnects): nothing new happened here.
    h.setThreads([waiting]);
    h.store.setState({ view: paneView("w") });
    expect(h.transitions).toEqual([]);
  });

  it("reports an open request on a chat thread as attention", () => {
    const h = createHarness({ threads: [thread("c")], view: paneView("c") });
    h.monitor.start();
    stop = () => h.monitor.stop();
    h.store.setState({
      runtimeRequestsByThread: {
        c: [{ id: "r1" }],
      } as unknown as AgentMonitorState["runtimeRequestsByThread"],
    });
    expect(h.transitions).toEqual([{ threadId: "c", kind: "attention" }]);
  });

  it("stays quiet when a restart cuts a turn off or a pane simply closes", () => {
    const h = createHarness({ threads: [thread("s"), thread("idle", { status: "idle" })] });
    h.store.setState({ view: paneView("idle") });
    h.monitor.start();
    stop = () => h.monitor.stop();
    h.setThreads([
      thread("s", { status: "idle", attention: "none", interruptedTurn: "restart" }),
      thread("idle", { status: "idle" }),
    ]);
    h.store.setState({ view: { kind: "home" } });
    expect(h.transitions).toEqual([]);
  });

  it("publishes whatever the effect switches say", () => {
    const h = createHarness({ threads: [thread("bg")] });
    h.effects.setState({ effects: { ...DEFAULT_FX_SETTINGS.effects, enabled: false } });
    h.monitor.start();
    stop = () => h.monitor.stop();
    h.setThreads([thread("bg", { status: "idle", attention: "none" })]);
    expect(h.transitions).toEqual([{ threadId: "bg", kind: "done" }]);
  });
});

describe("onAgentFxTransition", () => {
  it("delivers to every listener, survives a failing one and unsubscribes", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const seen: string[] = [];
    const offBroken = onAgentFxTransition(() => {
      throw new Error("listener bug");
    });
    const offGood = onAgentFxTransition((transition) => seen.push(transition.kind));
    emitAgentFxTransition({ threadId: "t", kind: "error" });
    expect(seen).toEqual(["error"]);
    offBroken();
    offGood();
    emitAgentFxTransition({ threadId: "t", kind: "done" });
    expect(seen).toEqual(["error"]);
    warn.mockRestore();
  });
});
