// ViscosityCode: the Claude turn-failure reason comes from structured SDK fields only.
import { describe, expect, it } from "vitest";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { RuntimeEvent } from "@/shared/contracts";
import {
  readClaudeAssistantError,
  readClaudeRateLimitRejected,
  readClaudeResultErrorReason,
  withRuntimeErrorReason,
} from "./result";

function apiErrorResult(extra: Record<string, unknown> = {}): SDKMessage {
  return {
    type: "result",
    subtype: "success",
    is_error: true,
    result: "You've hit your limit · resets 3pm",
    session_id: "claude-session",
    ...extra,
  } as unknown as SDKMessage;
}

describe("readClaudeResultErrorReason", () => {
  it("names a turn that ended on HTTP 429 as usage_limited", () => {
    expect(readClaudeResultErrorReason(apiErrorResult({ api_error_status: 429 }))).toBe(
      "usage_limited",
    );
  });

  it.each(["rate_limit", "billing_error"])(
    "names an API failure the SDK classified as %s as usage_limited",
    (assistantError) => {
      expect(readClaudeResultErrorReason(apiErrorResult(), { assistantError })).toBe(
        "usage_limited",
      );
    },
  );

  it("names an API failure after a rejected subscription rate limit as usage_limited", () => {
    expect(readClaudeResultErrorReason(apiErrorResult(), { rateLimitRejected: true })).toBe(
      "usage_limited",
    );
  });

  it.each<[string, Record<string, unknown>, Parameters<typeof readClaudeResultErrorReason>[1]]>([
    ["a sign-in failure", { api_error_status: 401 }, { assistantError: "authentication_failed" }],
    ["an overloaded API", { api_error_status: 529 }, { assistantError: "overloaded" }],
    ["a server error", { api_error_status: 500 }, { rateLimitRejected: false }],
  ])("gives %s no reason", (_label, extra, signals) => {
    expect(readClaudeResultErrorReason(apiErrorResult(extra), signals)).toBeUndefined();
  });

  it("gives non-API failures no reason, even after a rate-limit signal", () => {
    const interrupted = {
      type: "result",
      subtype: "error_during_execution",
      is_error: true,
      errors: ["[ede_diagnostic] turn interrupted before assistant content"],
      session_id: "claude-session",
    } as unknown as SDKMessage;
    expect(
      readClaudeResultErrorReason(interrupted, {
        assistantError: "rate_limit",
        rateLimitRejected: true,
      }),
    ).toBeUndefined();
    const success = {
      type: "result",
      subtype: "success",
      session_id: "claude-session",
    } as unknown as SDKMessage;
    expect(readClaudeResultErrorReason(success, { rateLimitRejected: true })).toBeUndefined();
  });
});

describe("Claude usage signals", () => {
  it("reads the SDK classification from an assistant message", () => {
    expect(
      readClaudeAssistantError({
        type: "assistant",
        error: "rate_limit",
        parent_tool_use_id: null,
      } as unknown as SDKMessage),
    ).toBe("rate_limit");
    expect(
      readClaudeAssistantError({
        type: "assistant",
        parent_tool_use_id: null,
      } as unknown as SDKMessage),
    ).toBeUndefined();
  });

  it("reads the subscription status from a rate_limit_event", () => {
    const event = (status: string) =>
      ({ type: "rate_limit_event", rate_limit_info: { status } }) as unknown as SDKMessage;
    expect(readClaudeRateLimitRejected(event("rejected"))).toBe(true);
    expect(readClaudeRateLimitRejected(event("allowed"))).toBe(false);
    expect(readClaudeRateLimitRejected(event("allowed_warning"))).toBe(false);
    expect(readClaudeRateLimitRejected(event("unknown"))).toBeUndefined();
    expect(readClaudeRateLimitRejected(apiErrorResult())).toBeUndefined();
  });
});

describe("withRuntimeErrorReason", () => {
  const events: RuntimeEvent[] = [
    { type: "error", threadId: "t", message: "limit" },
    { type: "error", threadId: "t", message: "expired", reason: "auth_required" },
    { type: "turn.completed", threadId: "t", turnId: "turn-1", state: "failed" },
  ];

  it("adds the reason only to errors that do not name one", () => {
    expect(withRuntimeErrorReason(events, "usage_limited")).toEqual([
      { type: "error", threadId: "t", message: "limit", reason: "usage_limited" },
      { type: "error", threadId: "t", message: "expired", reason: "auth_required" },
      { type: "turn.completed", threadId: "t", turnId: "turn-1", state: "failed" },
    ]);
  });

  it("returns the events unchanged without a reason", () => {
    expect(withRuntimeErrorReason(events, undefined)).toBe(events);
  });
});
