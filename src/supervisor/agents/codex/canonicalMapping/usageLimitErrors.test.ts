// ViscosityCode: Codex names an account that ran out of usage with the shared
// `usage_limited` reason, from its structured `codexErrorInfo` only.
import { describe, expect, it } from "vitest";
import { createCodexMapperState, mapCodexNotification } from "../canonicalMapping";

// Codex reports the plan's usage running out with `codexErrorInfo:
// "usageLimitExceeded"` and a message such as this one.
const USAGE_LIMIT_MESSAGE =
  "You've hit your usage limit. Upgrade to Pro or try again in 2 hours 13 minutes.";

function failedTurn(error: Record<string, unknown>) {
  const state = createCodexMapperState("t-codex");
  mapCodexNotification("turn/started", { turnId: "t-1", threadId: "x" }, state);
  return mapCodexNotification(
    "turn/completed",
    { threadId: "x", turn: { id: "t-1", status: "failed", error } },
    state,
  );
}

function errorNotification(error: Record<string, unknown>, willRetry = false) {
  return mapCodexNotification(
    "error",
    { threadId: "x", turnId: "t-1", willRetry, error },
    createCodexMapperState("t-codex"),
  );
}

describe("Codex usage limits", () => {
  it("marks a turn that failed on the account's usage limit as usage_limited", () => {
    expect(
      failedTurn({ message: USAGE_LIMIT_MESSAGE, codexErrorInfo: "usageLimitExceeded" }),
    ).toEqual([
      {
        type: "error",
        threadId: "t-codex",
        message: USAGE_LIMIT_MESSAGE,
        reason: "usage_limited",
      },
      { type: "turn.completed", threadId: "t-codex", turnId: "t-1", state: "failed" },
    ]);
  });

  it("marks a final error notification for the usage limit as usage_limited", () => {
    expect(
      errorNotification({
        message: USAGE_LIMIT_MESSAGE,
        codexErrorInfo: "usageLimitExceeded",
        additionalDetails: null,
      }),
    ).toEqual([
      {
        type: "error",
        threadId: "t-codex",
        message: USAGE_LIMIT_MESSAGE,
        reason: "usage_limited",
      },
    ]);
  });

  it("keeps a retrying usage-limit error as a hidden warning", () => {
    expect(
      errorNotification({ message: "Retrying…", codexErrorInfo: "usageLimitExceeded" }, true),
    ).toEqual([{ type: "warning", threadId: "t-codex", message: "Retrying…" }]);
  });

  it.each<[string, unknown]>([
    ["a transient rate limit", "rateLimitExceeded"],
    ["a per-session budget", "sessionBudgetExceeded"],
    ["an upstream 429 after retries", { responseTooManyFailedAttempts: { httpStatusCode: 429 } }],
  ])("leaves %s as a plain error", (_label, codexErrorInfo) => {
    const error = { message: "Turn failed", codexErrorInfo };
    expect(failedTurn(error)[0]).toEqual({
      type: "error",
      threadId: "t-codex",
      message: "Turn failed",
    });
    expect(errorNotification(error)).toEqual([
      { type: "error", threadId: "t-codex", message: "Turn failed" },
    ]);
  });

  it("does not read the usage limit from message text", () => {
    expect(errorNotification({ message: USAGE_LIMIT_MESSAGE })).toEqual([
      { type: "error", threadId: "t-codex", message: USAGE_LIMIT_MESSAGE },
    ]);
  });
});
