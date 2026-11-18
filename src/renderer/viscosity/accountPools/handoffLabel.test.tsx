import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useAppStore } from "@/renderer/state/appStore";
import type { RuntimeChatItem } from "@/renderer/state/slices/runtimeEventSlice";
import { I18nTestWrapper } from "@/renderer/testUtils/i18n";
import {
  isUsageLimitedHandoffPayload,
  selectHandoffFollowsUsageLimit,
  useUsageLimitedHandoffText,
} from "./handoffLabel";

const handoff = { fromAgentKind: "codex", toAgentKind: "codex:work", at: "2026-11-17T00:00:00Z" };

function item(id: string, type: string, payload: object = {}): RuntimeChatItem {
  return { id, threadId: "t1", type, state: "completed", payload } as unknown as RuntimeChatItem;
}

function setTranscript(items: RuntimeChatItem[]) {
  useAppStore.setState({
    runtimeItemIdsByThread: { t1: items.map((entry) => entry.id) },
    runtimeItemsByIdByThread: { t1: Object.fromEntries(items.map((entry) => [entry.id, entry])) },
  });
}

function dividerText() {
  return renderHook(
    () =>
      useUsageLimitedHandoffText({
        threadId: "t1",
        itemId: "divider",
        payload: handoff,
        fromLabel: "Codex",
        toLabel: "Codex Work",
      }),
    { wrapper: I18nTestWrapper },
  ).result.current;
}

afterEach(() => {
  useAppStore.setState({ runtimeItemIdsByThread: {}, runtimeItemsByIdByThread: {} });
});

describe("out-of-usage handoff divider", () => {
  it("explains a switch right after the account ran out of usage", () => {
    setTranscript([
      item("u1", "user_message"),
      item("a1", "assistant_message"),
      item("e1", "error", { message: "Usage limit reached.", reason: "usage_limited" }),
      item("divider", "provider_handoff", handoff),
    ]);
    expect(selectHandoffFollowsUsageLimit(useAppStore.getState(), "t1", "divider")).toBe(true);
    expect(dividerText()).toBe("Switched to Codex Work because Codex ran out of usage");
  });

  it("keeps the default text for manual switches and older turns' errors", () => {
    setTranscript([
      item("e0", "error", { message: "Usage limit reached.", reason: "usage_limited" }),
      item("u1", "user_message"),
      item("e1", "error", { message: "Network error" }),
      item("divider", "provider_handoff", handoff),
    ]);
    expect(dividerText()).toBeUndefined();
    setTranscript([item("divider", "provider_handoff", handoff)]);
    expect(dividerText()).toBeUndefined();
  });

  it("also honours a reason carried on the divider itself", () => {
    expect(isUsageLimitedHandoffPayload({ ...handoff, reason: "usage_limited" })).toBe(true);
    expect(isUsageLimitedHandoffPayload({ ...handoff, reason: "other" })).toBe(false);
    expect(isUsageLimitedHandoffPayload(handoff)).toBe(false);
  });
});
