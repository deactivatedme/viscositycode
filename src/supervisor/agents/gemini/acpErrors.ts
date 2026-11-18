// Modified for ViscosityCode (fork of Poracode). See FORK_CHANGES.md.
import type { RuntimeErrorReason } from "@/shared/contracts";
import { msg } from "@/shared/messages";

const GEMINI_AUTH_ERROR_RE =
  /invalid api key|api_key_invalid|unauthenticated|authentication(?: failed| required)|unauthorized|permission_denied|\b401\b|\b403\b|credentials?.*(?:missing|invalid|expired)|oauth.*(?:expired|invalid|failed)|login required/i;
const GEMINI_QUOTA_ERROR_RE = /quota|rate.?limit|resource_exhausted|\b429\b|too many requests/i;
const GEMINI_BLOCKED_ERROR_RE =
  /safety|blocked|recitation|prohibited_content|finish[_ ]?reason.*(?:safety|recitation|blocklist|prohibited|spii)/i;

// ViscosityCode: the empty-response error names its own reason, so the prompt
// resolver below never re-reads Gemini's generic hint text ("…or quota…").
// The class name is not the error's `name`: it still prints as a plain Error.
class GeminiEmptyResponseError extends Error {
  readonly reason: RuntimeErrorReason | undefined;

  constructor(message: string, reason?: RuntimeErrorReason) {
    super(message);
    this.reason = reason;
  }
}

/**
 * Gemini CLI v0.68.0's ACP runner can catch stream/model/safety failures and
 * still resolve `session/prompt` with `{ stopReason: "end_turn" }` and no
 * assistant text. Classify stderr hints when available, and always fail loudly
 * instead of returning an empty completion (e.g. to Crossagents).
 */
export function resolveGeminiEmptyResponseError(input: {
  stopReason: string;
  stderr: readonly string[];
}): Error {
  const stderr = input.stderr.join("\n");
  if (GEMINI_AUTH_ERROR_RE.test(stderr)) {
    return new GeminiEmptyResponseError(msg("gemini.authFailed"), "auth_required");
  }
  if (GEMINI_QUOTA_ERROR_RE.test(stderr)) {
    return new GeminiEmptyResponseError(msg("gemini.quotaExceeded"), "usage_limited");
  }
  if (GEMINI_BLOCKED_ERROR_RE.test(stderr)) {
    return new GeminiEmptyResponseError(msg("gemini.responseBlocked"));
  }
  return new GeminiEmptyResponseError(msg("gemini.emptyResponse"));
}

function readNumericErrorField(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return Number(value.trim());
  }
  return undefined;
}

/**
 * Map Gemini JSON-RPC prompt errors that signal rejected credentials/API keys
 * (without using the standard ACP -32000 `auth_required` envelope) to the
 * shared `"auth_required"` runtime error reason.
 *
 * A prompt that failed on quota (HTTP 429, `RESOURCE_EXHAUSTED`, the quota
 * wording, or the quota empty-response error built from stderr above) maps to
 * `"usage_limited"`. Gemini CLI retries transient rate limits itself; one that
 * reaches the prompt result has ended the turn. Sign-in failures win.
 */
export function resolveGeminiPromptErrorReason(error: unknown): RuntimeErrorReason | undefined {
  // ViscosityCode: an empty-response error already says why it failed.
  if (error instanceof GeminiEmptyResponseError) return error.reason;
  if (typeof error !== "object" || error === null) {
    if (typeof error !== "string") return undefined;
    if (GEMINI_AUTH_ERROR_RE.test(error)) return "auth_required";
    // ViscosityCode: an account out of quota is named for account-pool failover.
    return GEMINI_QUOTA_ERROR_RE.test(error) ? "usage_limited" : undefined;
  }
  const candidate = error as {
    code?: unknown;
    message?: unknown;
    data?: unknown;
  };
  const data =
    typeof candidate.data === "object" && candidate.data !== null
      ? (candidate.data as Record<string, unknown>)
      : undefined;

  const status = readNumericErrorField(data?.status) ?? readNumericErrorField(data?.code);
  if (status === 401 || status === 403) {
    return "auth_required";
  }

  const texts = [candidate.message, data?.message, data?.details, data?.detail, data?.error].filter(
    (entry): entry is string => typeof entry === "string" && entry.length > 0,
  );
  if (texts.some((text) => GEMINI_AUTH_ERROR_RE.test(text))) {
    return "auth_required";
  }
  // ViscosityCode: an account out of quota is named for account-pool failover.
  const statusName = typeof data?.status === "string" ? data.status : undefined;
  if (
    status === 429 ||
    [...texts, statusName].some((text) => text !== undefined && GEMINI_QUOTA_ERROR_RE.test(text))
  ) {
    return "usage_limited";
  }
  return undefined;
}
