// ViscosityCode: a Cursor SDK (chat) run that ends because the account ran out
// of usage carries the shared `usage_limited` reason; transient rate limits do not.
import { describe, expect, it } from "vitest";
import { runtimeEventSchema } from "@/shared/contracts";
import {
  createCursorSdkMapperState,
  mapCursorSdkMessage,
  mapCursorSdkRunResult,
  startCursorSdkTurn,
} from "./sdkCanonicalMapping";
import { cursorSdkRunErrorReason } from "./sdkErrorReasons";

describe("cursorSdkRunErrorReason", () => {
  it.each([
    { message: "You've hit your usage limit. Upgrade to Pro or switch to Auto." },
    { message: "Your team has reached its spend limit for this month." },
    { message: "You are out of fast requests." },
    { message: "Usage-based pricing required", code: "ERROR_USAGE_PRICING_REQUIRED" },
    { message: "Request failed", code: "ERROR_PRO_USER_USAGE_LIMIT" },
    { message: "Request failed", code: "insufficient_credits" },
    { message: "Payment required", code: "402" },
  ])("names an exhausted account: %j", (error) => {
    expect(cursorSdkRunErrorReason(error)).toBe("usage_limited");
  });

  it.each([
    { message: "Too many requests, please slow down.", code: "429" },
    { message: "Rate limited. Try again in a few seconds.", code: "ERROR_RATE_LIMITED" },
    { message: "resource exhausted", code: "resource_exhausted" },
    { message: "Request failed", code: "ERROR_PRO_USER_RATE_LIMIT_EXCEEDED" },
    { message: "Too many requests. Upgrade to Pro for higher rate limits." },
    { message: "Cursor rejected the configured SDK API key.", code: "auth_invalid" },
    { message: "The model returned an empty response." },
    { message: "Context window limit reached" },
  ])("leaves other failures reasonless: %j", (error) => {
    expect(cursorSdkRunErrorReason(error)).toBeUndefined();
  });

  it("is undefined without an error", () => {
    expect(cursorSdkRunErrorReason(undefined)).toBeUndefined();
  });
});

describe("Cursor SDK run failure mapping", () => {
  function failedRun(error: { message: string; code?: string }) {
    const state = createCursorSdkMapperState("thread-1");
    startCursorSdkTurn(state, "turn-1");
    const events = mapCursorSdkRunResult({ id: "run-1", status: "error", error }, state);
    for (const event of events) expect(runtimeEventSchema.safeParse(event).success).toBe(true);
    return events;
  }

  it("emits usage_limited on the turn-ending error and keeps the message", () => {
    const events = failedRun({ message: "You've hit your usage limit for this billing cycle." });
    expect(events.filter((event) => event.type === "error")).toEqual([
      {
        type: "error",
        threadId: "thread-1",
        message: "You've hit your usage limit for this billing cycle.",
        reason: "usage_limited",
      },
    ]);
    expect(events.at(-1)).toMatchObject({ type: "turn.completed", state: "failed" });
  });

  it("emits no reason for a transient rate limit", () => {
    const events = failedRun({ message: "Too many requests", code: "429" });
    expect(events.filter((event) => event.type === "error")).toEqual([
      { type: "error", threadId: "thread-1", message: "Too many requests" },
    ]);
  });

  // The stream's ERROR status arrives before the run result, and the result
  // is then a duplicate the mapper drops, so the reason must ride on it.
  it("names usage_limited on a stream ERROR status that precedes the run result", () => {
    const state = createCursorSdkMapperState("thread-1");
    startCursorSdkTurn(state, "turn-1");
    const message = "You've hit your usage limit. Upgrade to Pro or switch to Auto.";
    const events = mapCursorSdkMessage(
      { type: "status", agent_id: "agent-1", run_id: "run-1", status: "ERROR", message },
      state,
    );
    for (const event of events) expect(runtimeEventSchema.safeParse(event).success).toBe(true);
    expect(events.filter((event) => event.type === "error")).toEqual([
      { type: "error", threadId: "thread-1", message, reason: "usage_limited" },
    ]);
    expect(
      mapCursorSdkRunResult({ id: "run-1", status: "error", error: { message } }, state),
    ).toEqual([]);
  });

  it("leaves a stream ERROR status reasonless for a rate limit or an expired run", () => {
    const state = createCursorSdkMapperState("thread-1");
    startCursorSdkTurn(state, "turn-1");
    const rateLimited = mapCursorSdkMessage(
      {
        type: "status",
        agent_id: "agent-1",
        run_id: "run-1",
        status: "ERROR",
        message: "Too many requests",
      },
      state,
    );
    expect(rateLimited.filter((event) => event.type === "error")).toEqual([
      { type: "error", threadId: "thread-1", message: "Too many requests" },
    ]);
    startCursorSdkTurn(state, "turn-2");
    const expired = mapCursorSdkMessage(
      { type: "status", agent_id: "agent-1", run_id: "run-2", status: "EXPIRED" },
      state,
    );
    expect(expired.filter((event) => event.type === "error")).toEqual([
      { type: "error", threadId: "thread-1", message: "EXPIRED" },
    ]);
  });
});
