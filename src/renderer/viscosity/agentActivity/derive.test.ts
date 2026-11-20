import { describe, expect, it } from "vitest";
import type { Thread } from "@/shared/contracts";
import type { RuntimeChatItem } from "@/renderer/state/slices/runtimeChatItem";
import { deriveThreadActivity, getTurnActiveThreadIds, IDLE_ACTIVITY } from "./derive";

function item(
  id: string,
  type: RuntimeChatItem["type"],
  state: RuntimeChatItem["state"] = "started",
): RuntimeChatItem {
  return { id, type, state, streams: {} };
}

function turn(...items: RuntimeChatItem[]) {
  return {
    ids: items.map((entry) => entry.id),
    items: Object.fromEntries(items.map((entry) => [entry.id, entry])),
  };
}

describe("deriveThreadActivity", () => {
  it("returns the shared idle value for empty or missing data", () => {
    expect(deriveThreadActivity(undefined, undefined)).toBe(IDLE_ACTIVITY);
    expect(deriveThreadActivity([], {})).toBe(IDLE_ACTIVITY);
  });

  it("counts every open tool-like canonical item in the current turn", () => {
    const { ids, items } = turn(
      item("u1", "user_message", "completed"),
      item("t1", "tool_call"),
      item("t2", "mcp_tool_call", "updated"),
      item("t3", "command_execution"),
      item("t4", "file_change"),
      item("t5", "web_search"),
      item("t6", "dynamic_tool_call", "completed"),
    );
    expect(deriveThreadActivity(ids, items).runningTools).toBe(5);
  });

  it("stops at the latest user message so stale items from older turns do not count", () => {
    const { ids, items } = turn(
      item("stale", "tool_call"),
      item("staleReasoning", "reasoning"),
      item("u2", "user_message", "completed"),
      item("a1", "assistant_message", "completed"),
    );
    expect(deriveThreadActivity(ids, items)).toBe(IDLE_ACTIVITY);
  });

  it("reads an open reasoning item as thinking until assistant text starts after it", () => {
    const thinking = turn(item("u", "user_message", "completed"), item("r", "reasoning"));
    expect(deriveThreadActivity(thinking.ids, thinking.items).thinking).toBe(true);

    const answered = turn(
      item("u", "user_message", "completed"),
      item("r", "reasoning", "updated"),
      item("a", "assistant_message"),
    );
    const activity = deriveThreadActivity(answered.ids, answered.items);
    expect(activity.thinking).toBe(false);
    expect(activity.streamItemId).toBe("a");
  });

  it("only reports the newest assistant message, and only while it is open", () => {
    const { ids, items } = turn(
      item("u", "user_message", "completed"),
      item("a1", "assistant_message"),
      item("t", "tool_call", "completed"),
      item("a2", "assistant_message", "completed"),
    );
    expect(deriveThreadActivity(ids, items).streamItemId).toBeNull();
  });

  it("bounds the scan", () => {
    const { ids, items } = turn(
      item("t", "tool_call"),
      item("a", "assistant_message", "completed"),
    );
    expect(deriveThreadActivity(ids, items, 1).runningTools).toBe(0);
    expect(deriveThreadActivity(ids, items, 2).runningTools).toBe(1);
  });
});

describe("getTurnActiveThreadIds", () => {
  const thread = (id: string, status: Thread["status"], archived = false) =>
    ({ id, status, archived }) as Thread;

  it("memoizes turn-active ids per threads array and skips archived rows", () => {
    const threads = [
      thread("a", "working"),
      thread("b", "idle"),
      thread("c", "needs_approval"),
      thread("d", "working", true),
    ];
    const ids = getTurnActiveThreadIds(threads);
    expect(ids).toEqual(["a", "c"]);
    expect(getTurnActiveThreadIds(threads)).toBe(ids);
  });
});
