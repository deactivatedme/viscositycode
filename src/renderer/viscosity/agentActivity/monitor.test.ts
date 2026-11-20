import { describe, expect, it, vi } from "vitest";
import { createStore } from "zustand/vanilla";
import type { Thread } from "@/shared/contracts";
import type { RuntimeChatItem } from "@/renderer/state/slices/runtimeChatItem";
import { startToolsRunningMonitor, type ToolsMonitorState } from "./monitor";

function thread(id: string, patch: Partial<Thread> = {}): Thread {
  return { id, status: "working", presentationMode: "gui", archived: false, ...patch } as Thread;
}

function item(
  id: string,
  type: RuntimeChatItem["type"],
  state: RuntimeChatItem["state"] = "started",
): RuntimeChatItem {
  return { id, type, state, streams: {} };
}

function start(threads: Thread[]) {
  const store = createStore<ToolsMonitorState>()(() => ({
    threads,
    runtimeItemIdsByThread: {},
    runtimeItemsByIdByThread: {},
    runtimeStructuralVersionByThread: {},
  }));
  const setToolsRunning = vi.fn<(count: number) => void>();
  const stop = startToolsRunningMonitor(
    { getState: store.getState, subscribe: (listener) => store.subscribe(listener) },
    setToolsRunning,
  );
  function setItems(threadId: string, items: RuntimeChatItem[]): void {
    const state = store.getState();
    store.setState({
      runtimeItemIdsByThread: {
        ...state.runtimeItemIdsByThread,
        [threadId]: items.map((i) => i.id),
      },
      runtimeItemsByIdByThread: {
        ...state.runtimeItemsByIdByThread,
        [threadId]: Object.fromEntries(items.map((i) => [i.id, i])),
      },
      runtimeStructuralVersionByThread: {
        ...state.runtimeStructuralVersionByThread,
        [threadId]: (state.runtimeStructuralVersionByThread[threadId] ?? 0) + 1,
      },
    });
  }
  return { store, setToolsRunning, stop, setItems };
}

describe("startToolsRunningMonitor", () => {
  it("counts running tools across every turn-active chat thread", () => {
    const harness = start([
      thread("a"),
      thread("bg"),
      thread("pty", { presentationMode: "terminal" }),
    ]);
    harness.setItems("a", [item("u", "user_message", "completed"), item("t1", "tool_call")]);
    harness.setItems("bg", [
      item("u", "user_message", "completed"),
      item("t2", "mcp_tool_call"),
      item("t3", "file_change"),
    ]);
    harness.setItems("pty", [item("t4", "tool_call")]);
    expect(harness.setToolsRunning).toHaveBeenLastCalledWith(3);

    harness.store.setState({ threads: [thread("a"), thread("bg", { status: "idle" })] });
    expect(harness.setToolsRunning).toHaveBeenLastCalledWith(1);
  });

  it("ignores streaming deltas that only replace the item map", () => {
    const harness = start([thread("a")]);
    harness.setItems("a", [item("u", "user_message", "completed"), item("t1", "tool_call")]);
    const calls = harness.setToolsRunning.mock.calls.length;
    harness.store.setState({ runtimeItemsByIdByThread: { a: {} } });
    expect(harness.setToolsRunning.mock.calls.length).toBe(calls);
  });

  it("recounts when a running tool completes with the same item count", () => {
    const harness = start([thread("a")]);
    harness.setItems("a", [item("u", "user_message", "completed"), item("t1", "tool_call")]);
    expect(harness.setToolsRunning).toHaveBeenLastCalledWith(1);
    // runtimeEventReducer bumps the structural version on item.completed; setItems does too.
    harness.setItems("a", [
      item("u", "user_message", "completed"),
      item("t1", "tool_call", "completed"),
    ]);
    expect(harness.setToolsRunning).toHaveBeenLastCalledWith(0);
  });

  it("relies on that version bump: a completion without one is not rescanned", () => {
    const harness = start([thread("a")]);
    harness.setItems("a", [item("u", "user_message", "completed"), item("t1", "tool_call")]);
    const state = harness.store.getState();
    harness.store.setState({
      runtimeItemIdsByThread: { a: ["u", "t1"] },
      runtimeItemsByIdByThread: {
        a: { ...state.runtimeItemsByIdByThread.a, t1: item("t1", "tool_call", "completed") },
      },
    });
    expect(harness.setToolsRunning).toHaveBeenLastCalledWith(1);
  });

  it("resets the count and stops listening on stop", () => {
    const harness = start([thread("a")]);
    harness.setItems("a", [item("u", "user_message", "completed"), item("t1", "tool_call")]);
    harness.stop();
    expect(harness.setToolsRunning).toHaveBeenLastCalledWith(0);
    harness.setItems("a", [item("t2", "tool_call")]);
    expect(harness.setToolsRunning).toHaveBeenLastCalledWith(0);
  });
});
