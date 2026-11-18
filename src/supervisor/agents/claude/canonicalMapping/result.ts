// Modified for ViscosityCode (fork of Poracode). See FORK_CHANGES.md.
import type { SDKControlGetContextUsageResponse, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { RuntimeErrorReason, RuntimeEvent, TurnState } from "@/shared/contracts";
import { createContextUsageEvent, readNonNegativeInteger } from "../../contextUsage";

/**
 * `[ede_diagnostic] ...` lines are emitted by claude.exe when a turn is cut
 * short before the assistant produced content (the typical interrupt path
 * during steering). The SDK itself filters them out as informational — see
 * the `errors.filter(e => !e.startsWith("[ede_diagnostic]"))` step in the
 * agent-sdk binary. We mirror that here so an interrupted steer doesn't
 * surface as a user-visible error.
 */
function isDiagnosticOnlyError(error: string): boolean {
  return error.startsWith("[ede_diagnostic]");
}

export function nonDiagnosticErrors(message: SDKMessage): string[] {
  // The SDK's `errors` field only exists on `SDKResultError` — a single member
  // of a very large `SDKMessage` union. Read it through an explicitly typed
  // intermediate (rather than narrowing `message` in place and calling
  // `.filter` off it) because TS's overload resolution for `Array.prototype
  // .filter` falls back to an implicit `any` callback parameter when resolved
  // directly against a property access narrowed off a union this large.
  const errors: string[] | undefined = "errors" in message ? message.errors : undefined;
  if (!Array.isArray(errors)) return [];
  return errors.filter(
    (error): error is string => typeof error === "string" && !isDiagnosticOnlyError(error),
  );
}

/**
 * claude.exe can emit subtype "success" while still surfacing an upstream API
 * failure (e.g. 401/429) via `is_error: true` and `api_error_status`. Treat
 * those as failures so the turn doesn't quietly resolve to idle.
 *
 * `is_error: true` alone is NOT sufficient — an interrupted/aborted turn is
 * reported as `error_during_execution` with `is_error: true` and only a
 * `[ede_diagnostic]` line, and must not be misread as an API failure (that
 * surfaced a spurious "Claude turn failed." on every stop/steer). So the
 * `is_error` signal is scoped to the documented subtype-"success" quirk; an
 * explicit `api_error_status >= 400` remains unambiguous on its own.
 */
export function isApiErrorResult(message: SDKMessage): boolean {
  if (message.type !== "result") return false;
  const m = message as { is_error?: unknown; api_error_status?: unknown; subtype?: unknown };
  if (typeof m.api_error_status === "number" && m.api_error_status >= 400) return true;
  return m.is_error === true && m.subtype === "success";
}

// ViscosityCode: structured "the account ran out" signals for account-pool failover.
/**
 * The SDK's classification of the API failure behind a turn's synthetic
 * assistant error message that means the account itself ran out: `rate_limit`
 * (the plan's usage limit or a rate limit the CLI stopped retrying) and
 * `billing_error` (credit balance too low, spend limit reached). Transient
 * failures the CLI retries by itself arrive as `system/api_retry` instead and
 * never end the turn, so they are not read here.
 */
const CLAUDE_USAGE_LIMIT_ASSISTANT_ERRORS: ReadonlySet<string> = new Set([
  "rate_limit",
  "billing_error",
]);

/** What the session saw during the turn, before its `result` arrived. */
export interface ClaudeTurnUsageSignals {
  /** `error` of the turn's main-thread assistant message, when the SDK set one. */
  assistantError?: string;
  /** The last `rate_limit_event` of the turn said the subscription is `rejected`. */
  rateLimitRejected?: boolean;
}

/** The `error` classification a main-thread assistant message carries, if any. */
export function readClaudeAssistantError(message: SDKMessage): string | undefined {
  if (message.type !== "assistant") return undefined;
  const error = (message as { error?: unknown }).error;
  return typeof error === "string" && error.length > 0 ? error : undefined;
}

/**
 * Whether a `rate_limit_event` reports the subscription as rejected (`true`),
 * allowed again (`false`), or says nothing about it (`undefined`).
 */
export function readClaudeRateLimitRejected(message: SDKMessage): boolean | undefined {
  if (message.type !== "rate_limit_event") return undefined;
  const status = (message as { rate_limit_info?: { status?: unknown } }).rate_limit_info?.status;
  if (status === "rejected") return true;
  if (status === "allowed" || status === "allowed_warning") return false;
  return undefined;
}

/**
 * Why a turn's `result` failed, from structured fields only: an upstream API
 * failure (see {@link isApiErrorResult}) that ended the turn because the
 * account ran out — HTTP 429 after the CLI stopped retrying, the SDK's
 * `rate_limit` / `billing_error` classification, or a rejected subscription
 * rate limit — is `"usage_limited"`. Interrupts, tool errors, and other API
 * failures carry no reason.
 */
export function readClaudeResultErrorReason(
  message: SDKMessage,
  signals: ClaudeTurnUsageSignals = {},
): RuntimeErrorReason | undefined {
  if (!isApiErrorResult(message)) return undefined;
  const status = (message as { api_error_status?: unknown }).api_error_status;
  if (status === 429) return "usage_limited";
  if (signals.assistantError && CLAUDE_USAGE_LIMIT_ASSISTANT_ERRORS.has(signals.assistantError)) {
    return "usage_limited";
  }
  if (signals.rateLimitRejected === true) return "usage_limited";
  return undefined;
}

/** Adds `reason` to the error events that do not name a reason yet. */
export function withRuntimeErrorReason(
  events: RuntimeEvent[],
  reason: RuntimeErrorReason | undefined,
): RuntimeEvent[] {
  if (!reason) return events;
  return events.map((event) =>
    event.type === "error" && event.reason === undefined ? { ...event, reason } : event,
  );
}

export function extractResultErrorMessage(message: SDKMessage): string | undefined {
  if (message.type !== "result") return undefined;
  const fromErrors = nonDiagnosticErrors(message)[0];
  if (fromErrors) return fromErrors;
  const result = (message as { result?: unknown }).result;
  if (typeof result === "string") {
    const trimmed = result.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return undefined;
}

/**
 * One API call's token spend: input + output + cache creation + cache read.
 * Used for per-assistant-message usage — never for the turn `result`, whose
 * usage the CLI reports as a session-cumulative counter.
 */
export function readClaudeApiUsageSpendTokens(usage: unknown): number | undefined {
  if (!usage || typeof usage !== "object") return undefined;
  const record = usage as Record<string, unknown>;
  const input = readNonNegativeInteger(record.input_tokens) ?? 0;
  const output = readNonNegativeInteger(record.output_tokens) ?? 0;
  const cacheCreation = readNonNegativeInteger(record.cache_creation_input_tokens) ?? 0;
  const cacheRead = readNonNegativeInteger(record.cache_read_input_tokens) ?? 0;
  const sum = input + output + cacheCreation + cacheRead;
  return sum > 0 ? sum : undefined;
}

export function mapResultState(message: Extract<SDKMessage, { type: "result" }>): TurnState {
  if (isApiErrorResult(message)) return "failed";
  if (message.subtype === "success") return "completed";
  const filtered = nonDiagnosticErrors(message);
  // All errors were diagnostics — claude.exe was interrupted before producing
  // assistant content. Treat it as a user-initiated interrupt rather than a
  // failure (the diagnostic itself is informational).
  if (filtered.length === 0) return "interrupted";
  const joined = filtered.join(" ").toLowerCase();
  if (joined.includes("abort") || joined.includes("interrupt")) return "interrupted";
  if (joined.includes("cancel")) return "cancelled";
  return "failed";
}

export function contextUsageFromCompactionMetadata(
  threadId: string,
  metadata: unknown,
): RuntimeEvent | undefined {
  if (!metadata || typeof metadata !== "object") return undefined;
  const obj = metadata as Record<string, unknown>;
  const usedTokens =
    readNonNegativeInteger(obj.post_tokens) ?? readNonNegativeInteger(obj.postTokens);
  if (usedTokens === undefined) return undefined;
  return createContextUsageEvent(threadId, {
    usedTokens,
    breakdown:
      usedTokens > 0
        ? [{ id: "current-context", label: "Current context", tokens: usedTokens }]
        : [],
  });
}

export function mapClaudeContextUsageResponse(
  threadId: string,
  response: SDKControlGetContextUsageResponse,
): RuntimeEvent | undefined {
  const maxTokens =
    readPositiveInteger(response.maxTokens) ?? readPositiveInteger(response.rawMaxTokens);
  const breakdown = response.categories
    .map((category, index) => {
      // Only in-window content belongs in the breakdown; free space, the
      // compaction buffer, and deferred tool schemas do not occupy context.
      // CLIs older than SDK 0.3.280 omit `kind`, so treat that as "used".
      if ((category.kind ?? "used") !== "used") return undefined;
      const tokens = readNonNegativeInteger(category.tokens);
      if (tokens === undefined || tokens <= 0) return undefined;
      const slug = category.name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      return {
        id: slug ? `${slug}-${index}` : `category-${index}`,
        label: category.name,
        tokens,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined);
  const rawUsedTokens = readNonNegativeInteger(response.totalTokens);
  const usedTokens =
    rawUsedTokens !== undefined && (rawUsedTokens > 0 || breakdown.length > 0)
      ? rawUsedTokens
      : undefined;

  return createContextUsageEvent(threadId, {
    ...(usedTokens !== undefined ? { usedTokens } : {}),
    ...(maxTokens !== undefined ? { maxTokens } : {}),
    ...(breakdown.length > 0 ? { breakdown } : {}),
  });
}

function readPositiveInteger(value: unknown): number | undefined {
  const parsed = readNonNegativeInteger(value);
  return parsed !== undefined && parsed > 0 ? parsed : undefined;
}
