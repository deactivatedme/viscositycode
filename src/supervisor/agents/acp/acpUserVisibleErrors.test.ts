// Modified for ViscosityCode (fork of Poracode). See FORK_CHANGES.md.
import { describe, expect, it } from "vitest";
import type { RuntimeEvent } from "@/shared/contracts";
import {
  isAcpUsageLimitMessage,
  isFatalAcpQuotaError,
  parseAcpAgentMessageApiError,
  resolveAcpUsageLimitReason,
  withAcpUsageLimitReasons,
} from "./acpUserVisibleErrors";

describe("parseAcpAgentMessageApiError", () => {
  it("extracts detail from Factory Droid usage-limit payloads", () => {
    const text =
      'Error: 402 {"detail":"You\'ve reached your 5-hour Droid Core usage limit (resets in 0h 3min).\\nReload Extra Usage credits or wait for your limits to reset.","status":402,"title":"Payment Required","displayToUser":true}';
    expect(parseAcpAgentMessageApiError(text)).toBe(
      "You've reached your 5-hour Droid Core usage limit (resets in 0h 3min).\nReload Extra Usage credits or wait for your limits to reset.",
    );
  });

  it("maps plain HTTP no-body errors to actionable messages", () => {
    expect(parseAcpAgentMessageApiError("Error: 403 status code (no body)")).toBe(
      "Access denied (HTTP 403). Your Factory account may lack permission for this model or workspace.",
    );
  });

  it("returns undefined for normal assistant text", () => {
    expect(parseAcpAgentMessageApiError("Here is the fix for your bug.")).toBeUndefined();
    expect(parseAcpAgentMessageApiError("Error: something went wrong")).toBeUndefined();
  });

  it("extracts Antigravity quota failures from tool-result blobs", () => {
    const text =
      'Encountered retryable error from model provider: Agent execution terminated due to error. ("request failed (code 429): Individual quota reached. Please upgrade your subscription to increase your limits. Resets in 1h33m48s.")';
    const message = parseAcpAgentMessageApiError(text);
    expect(message).toContain("Individual quota reached");
    expect(isFatalAcpQuotaError(message ?? "")).toBe(true);
  });
});

// ViscosityCode: the account running out is named on turn-ending provider failures.
describe("isAcpUsageLimitMessage", () => {
  it.each([
    "Individual quota reached. Please upgrade your subscription to increase your limits.",
    "Payment or usage limit reached (HTTP 402). Check your Factory account billing or usage.",
    "You've reached your 5-hour Droid Core usage limit (resets in 0h 3min).",
    "You've reached your weekly standard usage limit (resets in 2 days).",
    "Usage limit reached.",
    "You are out of credits.",
    "Your credit balance is too low to access the API.",
    "insufficient_quota: You exceeded your current quota",
    "Quota exceeded for quota metric 'Requests' per day",
    "Payment Required",
    "You have hit your plan limit. Upgrade your plan to continue.",
  ])("recognizes %j", (message) => {
    expect(isAcpUsageLimitMessage(message)).toBe(true);
    expect(resolveAcpUsageLimitReason(message)).toBe("usage_limited");
  });

  it.each([
    "Access denied (HTTP 403). Your Factory account may lack permission for this model or workspace.",
    "Authentication failed (HTTP 401). Sign in to Factory or refresh your credentials.",
    "Request failed (HTTP 500).",
    "transport exploded",
    "Context window limit reached",
    // ViscosityCode: transient rate limits are not an account running out.
    "Rate limit exceeded (HTTP 429). Wait and retry, or switch models.",
    "HTTP 429 Too Many Requests",
    "RESOURCE_EXHAUSTED",
    "Quota exceeded for quota metric 'Generate Content API requests' per minute",
    "Quota exceeded. Please try again in 12.5s.",
    // An upgrade hint alone does not say the account ran out.
    "Rate limit exceeded. Upgrade your plan for higher rate limits.",
  ])("ignores %j", (message) => {
    expect(isAcpUsageLimitMessage(message)).toBe(false);
    expect(resolveAcpUsageLimitReason(message)).toBeUndefined();
  });

  it("does not name the generic message built for a Factory or Antigravity 429", () => {
    const factory = parseAcpAgentMessageApiError("Error: 429 status code (no body)") ?? "";
    const antigravity =
      parseAcpAgentMessageApiError(
        "Encountered retryable error from model provider: Agent execution terminated due to error. (code 429)",
      ) ?? "";
    for (const message of [factory, antigravity]) {
      expect(message).toBe("Rate limit exceeded (HTTP 429). Wait and retry, or switch models.");
      // Still fatal to the in-flight prompt, so the turn cannot spin…
      expect(isFatalAcpQuotaError(message)).toBe(true);
      // …but the account is not reported as out of usage.
      expect(resolveAcpUsageLimitReason(message)).toBeUndefined();
    }
  });

  it("recognizes every message the parser builds for a Factory 402", () => {
    expect(
      isAcpUsageLimitMessage(
        parseAcpAgentMessageApiError("Error: 402 status code (no body)") ?? "",
      ),
    ).toBe(true);
  });
});

describe("withAcpUsageLimitReasons", () => {
  it("tags only reasonless usage-limit errors and keeps their message", () => {
    const events: RuntimeEvent[] = [
      { type: "error", threadId: "t", message: "Usage limit reached." },
      { type: "error", threadId: "t", message: "Usage limit reached.", reason: "auth_required" },
      { type: "error", threadId: "t", message: "boom" },
      { type: "warning", threadId: "t", message: "Usage limit reached." },
    ];
    expect(withAcpUsageLimitReasons(events)).toEqual([
      { type: "error", threadId: "t", message: "Usage limit reached.", reason: "usage_limited" },
      { type: "error", threadId: "t", message: "Usage limit reached.", reason: "auth_required" },
      { type: "error", threadId: "t", message: "boom" },
      { type: "warning", threadId: "t", message: "Usage limit reached." },
    ]);
  });

  it("returns a batch without errors unchanged", () => {
    const events: RuntimeEvent[] = [{ type: "warning", threadId: "t", message: "quota reached" }];
    expect(withAcpUsageLimitReasons(events)).toBe(events);
  });
});
