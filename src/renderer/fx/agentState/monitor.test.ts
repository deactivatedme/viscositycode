import { afterEach, describe, expect, it, vi } from "vitest";
import { createStore } from "zustand/vanilla";
import type { Thread } from "@/shared/contracts";
import { DEFAULT_FX_SETTINGS, type EffectsSettings } from "@/renderer/fx/fxSettingsStore";
import type { RuntimeChatItem } from "@/renderer/state/slices/runtimeChatItem";
import { FX_ENERGY_PROPERTY, FX_FLASH_ATTRIBUTE, FX_STATE_ATTRIBUTE } from "./domApplicator";
import {
  type AgentMonitorState,
  createAgentStateMonitor,
  DONE_FLASH_MS,
  ERROR_FLASH_MS,
} from "./monitor";
import { STREAM_SAMPLE_INTERVAL_MS } from "./streamSampler";

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

function item(
  id: string,
  type: RuntimeChatItem["type"],
  state: RuntimeChatItem["state"] = "started",
  text?: string,
): RuntimeChatItem {
  return { id, type, state, streams: text === undefined ? {} : { assistant_text: text } };
}

function emptyState(): AgentMonitorState {
  return {
    threads: [],
    view: { kind: "home" },
    runtimeItemIdsByThread: {},
    runtimeItemsByIdByThread: {},
    runtimeRequestsByThread: {},
    runtimeStructuralVersionByThread: {},
  };
}

function element(attributes: Record<string, string>, ...children: Element[]): HTMLElement {
  const node = document.createElement(attributes.tag ?? "div");
  for (const [name, value] of Object.entries(attributes)) {
    if (name !== "tag") node.setAttribute(name, value);
  }
  node.append(...children);
  return node;
}

function mountPanes(chatIds: string[], tabIds: string[]): void {
  document.body.replaceChildren(
    ...chatIds.map((id) =>
      element({ "data-poracode-thread-pane": "" }, element({ "data-thread-id": id })),
    ),
    ...tabIds.map((id) => element({ tag: "button", "data-vc-tab-id": id })),
  );
}

function createHarness(initial: Partial<AgentMonitorState> = {}, tabIds: string[] = []) {
  const store = createStore<AgentMonitorState>()(() => ({ ...emptyState(), ...initial }));
  const tabs = createStore<{ ids: readonly string[] }>()(() => ({ ids: tabIds }));
  const effects = createStore<{ effects: EffectsSettings }>()(() => ({
    effects: DEFAULT_FX_SETTINGS.effects,
  }));
  let clock = 0;
  const frames: (() => void)[] = [];
  const timers: { at: number; callback: () => void; cancelled: boolean }[] = [];
  let interval: (() => void) | null = null;
  const setEnergy = vi.fn<(value: number) => void>();
  const setToolsRunning = vi.fn<(count: number) => void>();
  const uninstallTyping = vi.fn<() => void>();
  const installTyping = vi.fn<(doc: Document) => () => void>(() => uninstallTyping);
  const monitor = createAgentStateMonitor({
    document,
    store: { getState: store.getState, subscribe: (listener) => store.subscribe(listener) },
    tabs: {
      getIds: () => tabs.getState().ids,
      subscribe: (listener) => tabs.subscribe(() => listener()),
    },
    effects: {
      get: () => effects.getState().effects,
      subscribe: (listener) => effects.subscribe(() => listener()),
    },
    setEnergy,
    setToolsRunning,
    now: () => clock,
    requestFrame: (callback) => frames.push(callback),
    cancelFrame: (handle) => {
      frames[handle - 1] = () => {};
    },
    setTimer: (callback, ms) => {
      const timer = { at: clock + ms, callback, cancelled: false };
      timers.push(timer);
      return timer as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: (handle) => {
      (handle as unknown as { cancelled: boolean }).cancelled = true;
    },
    setRepeating: (callback) => {
      interval = callback;
      return 1 as unknown as ReturnType<typeof setInterval>;
    },
    clearRepeating: () => {
      interval = null;
    },
    installTyping,
  });
  return {
    store,
    tabs,
    effects,
    monitor,
    setEnergy,
    setToolsRunning,
    installTyping,
    uninstallTyping,
    frames,
    sampling: () => interval !== null,
    tick(ms = STREAM_SAMPLE_INTERVAL_MS) {
      clock += ms;
      interval?.();
    },
    advance(ms: number) {
      clock += ms;
      for (const timer of timers.splice(0)) {
        if (timer.cancelled) continue;
        if (timer.at <= clock) timer.callback();
        else timers.push(timer);
      }
    },
    runFrames() {
      for (const callback of frames.splice(0)) callback();
    },
    setEffects(patch: Partial<EffectsSettings>) {
      effects.setState({ effects: { ...effects.getState().effects, ...patch } });
    },
  };
}

type Harness = ReturnType<typeof createHarness>;

const pane = (index = 0) =>
  document.querySelectorAll<HTMLElement>("[data-poracode-thread-pane]")[index]!;
const tab = (id: string) => document.querySelector<HTMLElement>(`[data-vc-tab-id="${id}"]`)!;

/** Replace one thread's items and bump its structural version, like the reducer does. */
function setItems(harness: Harness, threadId: string, items: RuntimeChatItem[]): void {
  const state = harness.store.getState();
  harness.store.setState({
    runtimeItemIdsByThread: {
      ...state.runtimeItemIdsByThread,
      [threadId]: items.map((entry) => entry.id),
    },
    runtimeItemsByIdByThread: {
      ...state.runtimeItemsByIdByThread,
      [threadId]: Object.fromEntries(items.map((entry) => [entry.id, entry])),
    },
    runtimeStructuralVersionByThread: {
      ...state.runtimeStructuralVersionByThread,
      [threadId]: (state.runtimeStructuralVersionByThread[threadId] ?? 0) + 1,
    },
  });
}

/** Grow an item's text without a structural bump (a content.delta). */
function streamText(harness: Harness, threadId: string, itemId: string, text: string): void {
  const state = harness.store.getState();
  const items = state.runtimeItemsByIdByThread[threadId]!;
  harness.store.setState({
    runtimeItemsByIdByThread: {
      ...state.runtimeItemsByIdByThread,
      [threadId]: { ...items, [itemId]: { ...items[itemId]!, streams: { assistant_text: text } } },
    },
  });
}

function setThread(harness: Harness, id: string, patch: Partial<Thread>): void {
  harness.store.setState({
    threads: harness.store
      .getState()
      .threads.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)),
  });
}

let current: Harness | null = null;

afterEach(() => {
  current?.monitor.stop();
  current = null;
  document.body.replaceChildren();
});

function start(initial: Partial<AgentMonitorState>, tabIds: string[] = []): Harness {
  current = createHarness(initial, tabIds);
  current.monitor.start();
  current.runFrames();
  return current;
}

describe("agent-state monitor", () => {
  it("drives pane and tab state from canonical items and terminal status", () => {
    mountPanes(["chat"], ["chat", "term"]);
    const harness = start(
      {
        threads: [thread("chat"), thread("term", { presentationMode: "terminal" })],
        view: { kind: "thread", panes: ["chat"] },
      },
      ["chat", "term"],
    );
    expect(pane().getAttribute(FX_STATE_ATTRIBUTE)).toBe("working");
    expect(tab("term").getAttribute(FX_STATE_ATTRIBUTE)).toBe("working");

    setItems(harness, "chat", [item("u", "user_message", "completed"), item("r", "reasoning")]);
    harness.runFrames();
    expect(pane().getAttribute(FX_STATE_ATTRIBUTE)).toBe("thinking");
    expect(tab("chat").getAttribute(FX_STATE_ATTRIBUTE)).toBe("thinking");

    setItems(harness, "chat", [
      item("u", "user_message", "completed"),
      item("r", "reasoning", "completed"),
      item("t", "command_execution"),
    ]);
    harness.runFrames();
    expect(pane().getAttribute(FX_STATE_ATTRIBUTE)).toBe("tool");

    setThread(harness, "term", { status: "needs_approval", attention: "needs_approval" });
    harness.runFrames();
    expect(tab("term").getAttribute(FX_STATE_ATTRIBUTE)).toBe("attention");
  });

  it("reads an open runtime request as attention", () => {
    mountPanes(["a"], []);
    const harness = start({ threads: [thread("a")], view: { kind: "thread", panes: ["a"] } });
    harness.store.setState({
      runtimeRequestsByThread: {
        a: [{ requestId: "q", threadId: "a" } as never],
      },
    });
    harness.runFrames();
    expect(pane().getAttribute(FX_STATE_ATTRIBUTE)).toBe("attention");
  });

  it("returns early on streaming deltas without scheduling DOM work", () => {
    mountPanes(["a"], []);
    const harness = start({ threads: [thread("a")], view: { kind: "thread", panes: ["a"] } });
    setItems(harness, "a", [
      item("u", "user_message", "completed"),
      item("m", "assistant_message"),
    ]);
    harness.runFrames();
    for (let step = 1; step <= 50; step += 1) streamText(harness, "a", "m", "x".repeat(step * 10));
    expect(harness.frames).toHaveLength(0);
  });

  it("samples streaming only while a visible chat thread is mid-turn", () => {
    mountPanes(["a"], []);
    const harness = start({ threads: [thread("a")], view: { kind: "thread", panes: ["a"] } });
    expect(harness.sampling()).toBe(true);
    setItems(harness, "a", [
      item("u", "user_message", "completed"),
      item("m", "assistant_message", "started", ""),
    ]);
    for (let step = 1; step <= 8; step += 1) {
      streamText(harness, "a", "m", "x".repeat(step * 60));
      harness.tick();
    }
    harness.runFrames();
    expect(pane().getAttribute(FX_STATE_ATTRIBUTE)).toBe("streaming");
    expect(Number(pane().style.getPropertyValue(FX_ENERGY_PROPERTY))).toBeGreaterThan(0.5);
    expect(harness.setEnergy.mock.lastCall?.[0]).toBeGreaterThan(0.5);
    expect(harness.monitor.snapshot()[0]!.streamRate).toBeGreaterThan(100);

    // Streaming energy off: no energy anywhere, and the pane keeps the turn edge.
    harness.setEffects({ streamingEnergy: false });
    harness.runFrames();
    expect(pane().getAttribute(FX_STATE_ATTRIBUTE)).toBe("working");
    expect(pane().style.getPropertyValue(FX_ENERGY_PROPERTY)).toBe("");
    expect(harness.setEnergy.mock.lastCall?.[0]).toBe(0);
    harness.setEffects({ streamingEnergy: true });

    // Output stops: the smoothed rate decays and the state falls back to working.
    for (let step = 0; step < 12; step += 1) harness.tick();
    harness.runFrames();
    expect(pane().getAttribute(FX_STATE_ATTRIBUTE)).toBe("working");

    setThread(harness, "a", { status: "idle", attention: "none" });
    expect(harness.sampling()).toBe(false);
    expect(harness.setEnergy.mock.lastCall?.[0]).toBe(0);
  });

  it("does not sample threads that are only running in the background", () => {
    const harness = start({ threads: [thread("bg")] });
    expect(harness.sampling()).toBe(false);
  });

  it("flashes done when a turn completes and removes it after the duration", () => {
    mountPanes(["a"], ["a"]);
    const harness = start({ threads: [thread("a")], view: { kind: "thread", panes: ["a"] } }, [
      "a",
    ]);
    setThread(harness, "a", { status: "idle", attention: "none" });
    harness.runFrames();
    expect(pane().getAttribute(FX_FLASH_ATTRIBUTE)).toBe("done");
    expect(tab("a").getAttribute(FX_FLASH_ATTRIBUTE)).toBe("done");
    expect(pane().getAttribute(FX_STATE_ATTRIBUTE)).toBe("idle");
    harness.advance(DONE_FLASH_MS - 1);
    harness.runFrames();
    expect(pane().getAttribute(FX_FLASH_ATTRIBUTE)).toBe("done");
    harness.advance(1);
    harness.runFrames();
    expect(pane().hasAttribute(FX_FLASH_ATTRIBUTE)).toBe(false);
  });

  it("flashes error on a failed turn and settles on the error state", () => {
    mountPanes(["a"], []);
    const harness = start({ threads: [thread("a")], view: { kind: "thread", panes: ["a"] } });
    setThread(harness, "a", { status: "error", attention: "error" });
    harness.runFrames();
    expect(pane().getAttribute(FX_FLASH_ATTRIBUTE)).toBe("error");
    expect(pane().getAttribute(FX_STATE_ATTRIBUTE)).toBe("error");
    harness.advance(ERROR_FLASH_MS);
    harness.runFrames();
    expect(pane().hasAttribute(FX_FLASH_ATTRIBUTE)).toBe(false);
    expect(pane().getAttribute(FX_STATE_ATTRIBUTE)).toBe("error");
  });

  it("does not flash a thread the first time it comes into view", () => {
    mountPanes(["a"], []);
    const harness = start({ threads: [thread("a", { status: "idle", attention: "none" })] });
    harness.store.setState({ view: { kind: "thread", panes: ["a"] } });
    harness.runFrames();
    expect(pane().getAttribute(FX_STATE_ATTRIBUTE)).toBe("idle");
    expect(pane().hasAttribute(FX_FLASH_ATTRIBUTE)).toBe(false);
  });

  it("respects per-effect toggles and the master switch", () => {
    mountPanes(["a"], []);
    const harness = start({ threads: [thread("a")], view: { kind: "thread", panes: ["a"] } });
    setItems(harness, "a", [item("u", "user_message", "completed"), item("t", "tool_call")]);
    harness.runFrames();
    expect(pane().getAttribute(FX_STATE_ATTRIBUTE)).toBe("tool");

    // The tool marker goes; the active turn keeps its steady edge.
    harness.setEffects({ toolIndicator: false });
    harness.runFrames();
    expect(pane().getAttribute(FX_STATE_ATTRIBUTE)).toBe("working");

    harness.setEffects({ toolIndicator: true, completionAnimation: false });
    setThread(harness, "a", { status: "idle", attention: "none" });
    harness.runFrames();
    expect(pane().getAttribute(FX_STATE_ATTRIBUTE)).toBe("idle");
    expect(pane().hasAttribute(FX_FLASH_ATTRIBUTE)).toBe(false);

    harness.setEffects({ enabled: false });
    expect(pane().hasAttribute(FX_STATE_ATTRIBUTE)).toBe(false);
    harness.runFrames();
    expect(pane().hasAttribute(FX_STATE_ATTRIBUTE)).toBe(false);
    expect(harness.setEnergy.mock.lastCall?.[0]).toBe(0);

    harness.setEffects({ enabled: true });
    harness.runFrames();
    expect(pane().getAttribute(FX_STATE_ATTRIBUTE)).toBe("idle");
  });

  it("publishes the running tool count across visible and background threads", () => {
    const harness = start({ threads: [thread("a"), thread("bg")] });
    setItems(harness, "a", [item("u", "user_message", "completed"), item("t1", "tool_call")]);
    setItems(harness, "bg", [
      item("u", "user_message", "completed"),
      item("t2", "mcp_tool_call"),
      item("t3", "file_change"),
    ]);
    expect(harness.setToolsRunning.mock.lastCall?.[0]).toBe(3);
    setThread(harness, "bg", { status: "idle", attention: "none" });
    expect(harness.setToolsRunning.mock.lastCall?.[0]).toBe(1);
  });

  it("installs the typing glow only while both switches are on", () => {
    const harness = start({});
    expect(harness.installTyping).toHaveBeenCalledTimes(1);
    harness.setEffects({ typingGlow: false });
    expect(harness.uninstallTyping).toHaveBeenCalledTimes(1);
    harness.setEffects({ typingGlow: true });
    expect(harness.installTyping).toHaveBeenCalledTimes(2);
    harness.setEffects({ enabled: false });
    expect(harness.uninstallTyping).toHaveBeenCalledTimes(2);
  });

  it("simulate() overrides the DOM only and never writes to the store", () => {
    mountPanes(["a"], ["a"]);
    const harness = start({ threads: [thread("a")], view: { kind: "thread", panes: ["a"] } }, [
      "a",
    ]);
    const before = harness.store.getState();
    harness.monitor.simulate("a", "attention", { flash: "error" });
    harness.runFrames();
    expect(pane().getAttribute(FX_STATE_ATTRIBUTE)).toBe("attention");
    expect(tab("a").getAttribute(FX_FLASH_ATTRIBUTE)).toBe("error");
    expect(harness.monitor.snapshot()[0]!.simulated).toBe("attention");
    expect(harness.store.getState()).toBe(before);

    harness.monitor.simulate("a", "streaming", { energy: 0.9 });
    harness.runFrames();
    expect(pane().style.getPropertyValue(FX_ENERGY_PROPERTY)).toBe("0.9");
    expect(harness.setEnergy.mock.lastCall?.[0]).toBe(0.9);

    harness.monitor.simulate("a", null);
    harness.runFrames();
    expect(pane().getAttribute(FX_STATE_ATTRIBUTE)).toBe("working");
  });

  it("stop() removes every attribute, timer and published value", () => {
    mountPanes(["a"], []);
    const harness = start({ threads: [thread("a")], view: { kind: "thread", panes: ["a"] } });
    setItems(harness, "a", [item("u", "user_message", "completed"), item("t", "tool_call")]);
    harness.runFrames();
    harness.monitor.stop();
    expect(pane().hasAttribute(FX_STATE_ATTRIBUTE)).toBe(false);
    expect(harness.sampling()).toBe(false);
    expect(harness.setToolsRunning.mock.lastCall?.[0]).toBe(0);
    expect(harness.setEnergy.mock.lastCall?.[0]).toBe(0);
    expect(harness.uninstallTyping).toHaveBeenCalled();
    setThread(harness, "a", { status: "error", attention: "error" });
    harness.runFrames();
    expect(pane().hasAttribute(FX_STATE_ATTRIBUTE)).toBe(false);
  });
});
