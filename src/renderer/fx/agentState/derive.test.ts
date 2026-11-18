import { describe, expect, it } from "vitest";
import type { Thread } from "@/shared/contracts";
import { DEFAULT_FX_SETTINGS, type EffectsSettings } from "@/renderer/fx/fxSettingsStore";
import type { RuntimeChatItem } from "@/renderer/state/slices/runtimeChatItem";
import {
  collectTrackedThreadIds,
  deriveFxState,
  deriveThreadActivity,
  detectTurnTransition,
  type FxStateInput,
  fxFlashAttribute,
  fxStateAttribute,
  getTurnActiveThreadIds,
  IDLE_ACTIVITY,
  resolveFxPresentation,
  selectPaneThreadIds,
  threadSignature,
} from "./derive";

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

function input(patch: Partial<FxStateInput>): FxStateInput {
  return {
    status: "working",
    attention: "working",
    presentation: "gui",
    openRequests: 0,
    activity: IDLE_ACTIVITY,
    streaming: false,
    ...patch,
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

describe("deriveFxState", () => {
  it("maps chat-thread activity in priority order", () => {
    const busy = { runningTools: 1, thinking: true, streamItemId: "a" };
    expect(deriveFxState(input({ activity: busy, streaming: true }))).toBe("tool");
    expect(deriveFxState(input({ activity: { ...busy, runningTools: 0 }, streaming: true }))).toBe(
      "thinking",
    );
    expect(
      deriveFxState(
        input({
          activity: { runningTools: 0, thinking: false, streamItemId: "a" },
          streaming: true,
        }),
      ),
    ).toBe("streaming");
    expect(deriveFxState(input({}))).toBe("working");
    expect(deriveFxState(input({ status: "launching", attention: "none" }))).toBe("working");
  });

  it("puts attention and errors above activity", () => {
    const busy = { runningTools: 2, thinking: true, streamItemId: "a" };
    expect(deriveFxState(input({ status: "needs_approval", activity: busy }))).toBe("attention");
    expect(deriveFxState(input({ attention: "needs_reply", activity: busy }))).toBe("attention");
    expect(deriveFxState(input({ openRequests: 1, activity: busy }))).toBe("attention");
    expect(deriveFxState(input({ status: "error", attention: "error", activity: busy }))).toBe(
      "error",
    );
  });

  it("is idle outside a turn even with leftover open items", () => {
    const busy = { runningTools: 1, thinking: true, streamItemId: "a" };
    expect(deriveFxState(input({ status: "idle", attention: "none", activity: busy }))).toBe(
      "idle",
    );
    expect(deriveFxState(input({ status: "finished", attention: "none" }))).toBe("idle");
    expect(deriveFxState(input({ status: "inactive", attention: "none" }))).toBe("idle");
  });

  it("maps terminal threads to working / attention / error / idle from status alone", () => {
    const busy = { runningTools: 3, thinking: true, streamItemId: "a" };
    const terminal = (patch: Partial<FxStateInput>) =>
      deriveFxState(input({ presentation: "terminal", activity: busy, streaming: true, ...patch }));
    expect(terminal({})).toBe("working");
    expect(terminal({ status: "launching" })).toBe("working");
    expect(terminal({ status: "needs_approval" })).toBe("attention");
    expect(terminal({ status: "working", attention: "needs_reply" })).toBe("attention");
    expect(terminal({ status: "error" })).toBe("error");
    expect(terminal({ status: "idle", attention: "none" })).toBe("idle");
    // Terminal threads have no runtime requests; a stray count must not matter.
    expect(terminal({ status: "idle", attention: "none", openRequests: 2 })).toBe("idle");
  });
});

describe("resolveFxPresentation", () => {
  it("treats only explicit terminal threads as terminal", () => {
    expect(resolveFxPresentation({ presentationMode: "terminal" })).toBe("terminal");
    expect(resolveFxPresentation({ presentationMode: "gui" })).toBe("gui");
    expect(resolveFxPresentation({})).toBe("gui");
  });
});

describe("detectTurnTransition", () => {
  it("never flashes on the first observation", () => {
    expect(detectTurnTransition(undefined, { status: "error", attention: "error" })).toBeNull();
  });

  it("flashes error when a thread enters an error", () => {
    expect(
      detectTurnTransition({ status: "working" }, { status: "error", attention: "error" }),
    ).toBe("error");
    expect(
      detectTurnTransition(
        { status: "error", attention: "error" },
        { status: "error", attention: "error" },
      ),
    ).toBeNull();
  });

  it("flashes error when the turn is cut off by an error", () => {
    expect(
      detectTurnTransition({ status: "working" }, { status: "idle", interruptedTurn: "error" }),
    ).toBe("error");
  });

  it("flashes done when an active turn settles without error", () => {
    expect(detectTurnTransition({ status: "working" }, { status: "idle" })).toBe("done");
    expect(detectTurnTransition({ status: "needs_reply" }, { status: "finished" })).toBe("done");
    expect(detectTurnTransition({ status: "launching" }, { status: "idle" })).toBe("done");
  });

  it("does not flash done for restarts, idle-to-idle or turns that keep going", () => {
    expect(
      detectTurnTransition({ status: "working" }, { status: "idle", interruptedTurn: "restart" }),
    ).toBeNull();
    expect(detectTurnTransition({ status: "idle" }, { status: "idle" })).toBeNull();
    expect(detectTurnTransition({ status: "working" }, { status: "needs_approval" })).toBeNull();
    expect(detectTurnTransition({ status: "inactive" }, { status: "idle" })).toBeNull();
  });
});

describe("effect toggles", () => {
  const all = DEFAULT_FX_SETTINGS.effects;
  const off = (patch: Partial<EffectsSettings>): EffectsSettings => ({ ...all, ...patch });

  it("writes nothing when the master switch is off", () => {
    expect(fxStateAttribute("working", off({ enabled: false }))).toBeNull();
    expect(fxStateAttribute("idle", off({ enabled: false }))).toBeNull();
    expect(fxFlashAttribute("done", off({ enabled: false }))).toBeNull();
  });

  it("drops only the disabled effect", () => {
    // In-turn sub-states keep the steady turn edge instead of dropping out.
    expect(fxStateAttribute("thinking", off({ thinkingGlow: false }))).toBe("working");
    expect(fxStateAttribute("tool", off({ toolIndicator: false }))).toBe("working");
    expect(fxStateAttribute("streaming", off({ streamingEnergy: false }))).toBe("working");
    expect(fxStateAttribute("attention", off({ attentionColor: false }))).toBeNull();
    expect(fxStateAttribute("error", off({ errorFlash: false }))).toBeNull();
    expect(fxFlashAttribute("error", off({ errorFlash: false }))).toBeNull();
    expect(fxFlashAttribute("done", off({ completionAnimation: false }))).toBeNull();
    expect(fxStateAttribute("tool", off({ thinkingGlow: false }))).toBe("tool");
    expect(fxStateAttribute("working", all)).toBe("working");
    expect(fxFlashAttribute("done", all)).toBe("done");
    expect(fxFlashAttribute(null, all)).toBeNull();
  });
});

describe("tracked thread selection", () => {
  const thread = (id: string, status: Thread["status"], archived = false) =>
    ({ id, status, archived }) as Thread;

  it("unions panes, tabs and turn-active threads in that order without duplicates", () => {
    expect(collectTrackedThreadIds(["a", "b"], ["b", "c"], ["d", "a"])).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });

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

  it("reads panes only from a thread view", () => {
    expect(selectPaneThreadIds({ kind: "thread", panes: ["x", "y"] })).toEqual(["x", "y"]);
    expect(selectPaneThreadIds({ kind: "home" })).toEqual([]);
  });

  it("builds a signature that ignores nothing that changes the derived state", () => {
    const base = {
      status: "working" as const,
      attention: "working" as const,
      presentation: "gui" as const,
      structuralVersion: 3,
      itemCount: 10,
      openRequests: 0,
    };
    const signature = threadSignature(base);
    expect(threadSignature({ ...base })).toBe(signature);
    expect(threadSignature({ ...base, structuralVersion: 4 })).not.toBe(signature);
    expect(threadSignature({ ...base, itemCount: 11 })).not.toBe(signature);
    expect(threadSignature({ ...base, openRequests: 1 })).not.toBe(signature);
    expect(threadSignature({ ...base, interruptedTurn: "error" })).not.toBe(signature);
    expect(threadSignature({ ...base, attention: "needs_reply" })).not.toBe(signature);
  });
});
