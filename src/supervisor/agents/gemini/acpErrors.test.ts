// Modified for ViscosityCode (fork of Poracode). See FORK_CHANGES.md.
import { describe, expect, it } from "vitest";
import { resolveGeminiEmptyResponseError, resolveGeminiPromptErrorReason } from "./acpErrors";
import { msg } from "@/shared/messages";

describe("resolveGeminiEmptyResponseError", () => {
  it("classifies authentication failures from stderr", () => {
    const error = resolveGeminiEmptyResponseError({
      stopReason: "end_turn",
      stderr: ["Error: API_KEY_INVALID: API key not valid. Please pass a valid API key."],
    });
    expect(error.message).toBe(msg("gemini.authFailed"));
  });

  it("classifies quota and rate-limit failures from stderr", () => {
    const error = resolveGeminiEmptyResponseError({
      stopReason: "end_turn",
      stderr: ["RESOURCE_EXHAUSTED (429): Quota exceeded for model"],
    });
    expect(error.message).toBe(msg("gemini.quotaExceeded"));
  });

  it("classifies safety/policy blocked turns from stderr", () => {
    const error = resolveGeminiEmptyResponseError({
      stopReason: "end_turn",
      stderr: ["Response candidate finishReason: SAFETY"],
    });
    expect(error.message).toBe(msg("gemini.responseBlocked"));
  });

  it("never returns an empty error when stderr has no specific hint", () => {
    const error = resolveGeminiEmptyResponseError({
      stopReason: "end_turn",
      stderr: [],
    });
    expect(error.message).toBe(msg("gemini.emptyResponse"));
  });
});

describe("resolveGeminiPromptErrorReason", () => {
  it("maps HTTP 401 and 403 status fields to auth_required", () => {
    expect(
      resolveGeminiPromptErrorReason({
        code: -32603,
        message: "Internal error",
        data: { status: 401 },
      }),
    ).toBe("auth_required");
    expect(
      resolveGeminiPromptErrorReason({
        code: -32603,
        message: "Request failed",
        data: { code: "403" },
      }),
    ).toBe("auth_required");
  });

  it("maps Gemini auth error messages in string and nested data fields to auth_required", () => {
    expect(resolveGeminiPromptErrorReason("API_KEY_INVALID")).toBe("auth_required");
    expect(
      resolveGeminiPromptErrorReason({
        message: "Turn failed",
        data: { details: "OAuth token expired — login required" },
      }),
    ).toBe("auth_required");
  });

  // ViscosityCode: quota failures that ended the prompt name the account running out.
  it("maps quota failures to usage_limited", () => {
    expect(
      resolveGeminiPromptErrorReason({
        code: -32603,
        message: "Internal error",
        data: { status: 429 },
      }),
    ).toBe("usage_limited");
    expect(
      resolveGeminiPromptErrorReason({
        code: -32603,
        message: "Internal error",
        data: { status: "RESOURCE_EXHAUSTED" },
      }),
    ).toBe("usage_limited");
    expect(
      resolveGeminiPromptErrorReason({
        message: "Turn failed",
        data: { details: "Quota exceeded for quota metric 'Gemini 2.5 Pro Requests' per day" },
      }),
    ).toBe("usage_limited");
    expect(resolveGeminiPromptErrorReason("RESOURCE_EXHAUSTED (429)")).toBe("usage_limited");
  });

  it("maps the quota empty-response error to usage_limited with its message unchanged", () => {
    const error = resolveGeminiEmptyResponseError({
      stopReason: "end_turn",
      stderr: ["RESOURCE_EXHAUSTED (429): Quota exceeded for model"],
    });
    expect(error.message).toBe(msg("gemini.quotaExceeded"));
    expect(resolveGeminiPromptErrorReason(error)).toBe("usage_limited");
  });

  it("keeps sign-in failures as auth_required even when they mention a limit", () => {
    expect(
      resolveGeminiPromptErrorReason({
        message: "Request failed",
        data: { status: 401, details: "quota project not set" },
      }),
    ).toBe("auth_required");
    const authError = resolveGeminiEmptyResponseError({
      stopReason: "end_turn",
      stderr: ["Error: API_KEY_INVALID: API key not valid. RESOURCE_EXHAUSTED"],
    });
    expect(authError.message).toBe(msg("gemini.authFailed"));
    expect(resolveGeminiPromptErrorReason(authError)).toBe("auth_required");
  });

  it("gives other empty responses no reason", () => {
    for (const stderr of [[], ["Response candidate finishReason: SAFETY"]]) {
      const error = resolveGeminiEmptyResponseError({ stopReason: "end_turn", stderr });
      expect(resolveGeminiPromptErrorReason(error)).toBeUndefined();
    }
  });

  it("returns undefined for unrelated errors", () => {
    expect(
      resolveGeminiPromptErrorReason({
        code: -32603,
        message: "Network timeout",
        data: { status: 504 },
      }),
    ).toBeUndefined();
    expect(resolveGeminiPromptErrorReason(null)).toBeUndefined();
  });
});
