import { describe, expect, it, vi } from "vitest";
import type { RuntimeChatItem } from "@/renderer/state/slices/runtimeChatItem";
import {
  createMissionActivityTracker,
  deriveMissionActivity,
  lastTextLine,
  MAX_STEP_LENGTH,
  NO_ACTIVITY,
  type ThreadActivitySource,
  toolStepLabel,
} from "./missionActivity";

function item(
  id: string,
  type: RuntimeChatItem["type"],
  overrides: Partial<RuntimeChatItem> = {},
): RuntimeChatItem {
  return { id, type, state: "completed", streams: {}, ...overrides };
}

function scan(items: RuntimeChatItem[]) {
  return deriveMissionActivity(
    items.map((entry) => entry.id),
    Object.fromEntries(items.map((entry) => [entry.id, entry])),
  );
}

describe("toolStepLabel", () => {
  it("reads canonical payload fields only", () => {
    expect(
      toolStepLabel(item("a", "command_execution", { payload: { command: "bun test\n--watch" } })),
    ).toBe("bun test");
    expect(
      toolStepLabel(item("b", "file_change", { payload: { path: "/repo/src/app/main.ts" } })),
    ).toBe("main.ts");
    expect(
      toolStepLabel(item("c", "web_search", { payload: { query: "zustand selectors" } })),
    ).toBe("zustand selectors");
    expect(toolStepLabel(item("d", "tool_call", { payload: { name: "Read" } }))).toBe("Read");
    expect(toolStepLabel(item("e", "tool_call", { payload: "not a record" }))).toBeNull();
  });

  it("collapses whitespace and clips long labels", () => {
    const long = "x".repeat(MAX_STEP_LENGTH + 40);
    const label = toolStepLabel(item("a", "tool_call", { payload: { title: long } }));
    expect(label).toHaveLength(MAX_STEP_LENGTH);
    expect(label?.endsWith("…")).toBe(true);
  });
});

describe("lastTextLine", () => {
  it("returns the last meaningful line without markdown markers", () => {
    expect(lastTextLine("First line\n\n- Running the migration now  \n")).toBe(
      "Running the migration now",
    );
    expect(lastTextLine("## Plan\n```")).toBe("Plan");
    expect(lastTextLine("  \n ")).toBeNull();
  });
});

describe("deriveMissionActivity", () => {
  it("prefers a running tool over text and stops at the latest user message", () => {
    const activity = scan([
      item("old", "command_execution", { state: "started", payload: { command: "old" } }),
      item("u", "user_message"),
      item("m", "assistant_message", { streams: { assistant_text: "Let me check." } }),
      item("t", "tool_call", { state: "started", payload: { name: "Grep" } }),
    ]);
    expect(activity).toEqual({ live: "tool", step: { kind: "tool", text: "Grep" } });
  });

  it("reports thinking, then streaming with the newest assistant line", () => {
    expect(scan([item("u", "user_message"), item("r", "reasoning", { state: "updated" })])).toEqual(
      { live: "thinking", step: null },
    );
    expect(
      scan([
        item("u", "user_message"),
        item("m", "assistant_message", {
          state: "updated",
          streams: { assistant_text: "Done reading.\nNow writing the fix" },
        }),
      ]),
    ).toEqual({ live: "streaming", step: { kind: "text", text: "Now writing the fix" } });
  });

  it("skips sub-agent children and falls back to the last finished tool", () => {
    expect(
      scan([
        item("u", "user_message"),
        item("p", "tool_call", { payload: { title: "Explore the repo" } }),
        item("c", "command_execution", { state: "started", parentItemId: "p" }),
      ]),
    ).toEqual({ live: null, step: { kind: "tool", text: "Explore the repo" } });
    expect(scan([])).toBe(NO_ACTIVITY);
  });
});

describe("createMissionActivityTracker", () => {
  function setup() {
    const sources = new Map<string, ThreadActivitySource>();
    let tick: (() => void) | undefined;
    let paused = false;
    const startTimer = vi.fn<(callback: () => void, ms: number) => unknown>((callback) => {
      tick = callback;
      return 1;
    });
    const stopTimer = vi.fn<(handle: unknown) => void>();
    const tracker = createMissionActivityTracker({
      read: (threadId) => sources.get(threadId),
      setInterval: startTimer,
      clearInterval: stopTimer,
      isPaused: () => paused,
    });
    return {
      sources,
      tracker,
      startTimer,
      stopTimer,
      tick: () => tick?.(),
      pause: (value: boolean) => {
        paused = value;
      },
    };
  }

  function source(text: string, version: number, turnActive: boolean): ThreadActivitySource {
    const items = {
      u: item("u", "user_message"),
      m: item("m", "assistant_message", { state: "updated", streams: { assistant_text: text } }),
    };
    return { ids: ["u", "m"], items, structuralVersion: version, turnActive };
  }

  it("samples followed threads and notifies only when the line changes", () => {
    const { sources, tracker, startTimer, tick } = setup();
    sources.set("t1", source("Reading files", 1, true));
    const listener = vi.fn<() => void>();
    const unsubscribe = tracker.subscribe("t1", listener);
    expect(startTimer).toHaveBeenCalledOnce();
    expect(tracker.get("t1").step?.text).toBe("Reading files");

    tick();
    expect(listener).not.toHaveBeenCalled();

    sources.set("t1", source("Reading files\nWriting the fix", 1, true));
    tick();
    expect(listener).toHaveBeenCalledOnce();
    expect(tracker.get("t1").step?.text).toBe("Writing the fix");
    unsubscribe();
  });

  it("skips idle threads whose structure did not change, and pauses while hidden", () => {
    const { sources, tracker, tick, pause } = setup();
    sources.set("t1", source("One", 1, false));
    const listener = vi.fn<() => void>();
    tracker.subscribe("t1", listener);

    // Same structural version and no open turn: not re-derived.
    sources.set("t1", source("Two", 1, false));
    tick();
    expect(listener).not.toHaveBeenCalled();

    pause(true);
    sources.set("t1", source("Three", 2, false));
    tick();
    expect(listener).not.toHaveBeenCalled();

    pause(false);
    tick();
    expect(listener).toHaveBeenCalledOnce();
    expect(tracker.get("t1").step?.text).toBe("Three");
  });

  it("stops its timer when the last card unsubscribes", () => {
    const { sources, tracker, stopTimer } = setup();
    sources.set("t1", source("One", 1, true));
    const first = tracker.subscribe("t1", () => {});
    const second = tracker.subscribe("t2", () => {});
    expect(tracker.followed().toSorted()).toEqual(["t1", "t2"]);
    first();
    expect(stopTimer).not.toHaveBeenCalled();
    second();
    expect(stopTimer).toHaveBeenCalledOnce();
    expect(tracker.followed()).toEqual([]);
  });

  it("keeps the same snapshot when a card resubscribes and nothing changed", () => {
    const { sources, tracker } = setup();
    sources.set("t1", source("One", 1, true));
    const unsubscribe = tracker.subscribe("t1", () => {});
    const before = tracker.get("t1");
    unsubscribe();
    expect(tracker.get("t1")).toBe(before);
    const again = tracker.subscribe("t1", () => {});
    expect(tracker.get("t1")).toBe(before);
    again();

    sources.set("t1", source("Two", 2, true));
    tracker.subscribe("t1", () => {});
    expect(tracker.get("t1").step?.text).toBe("Two");
    expect(tracker.get("unknown")).toBe(NO_ACTIVITY);
  });
});
