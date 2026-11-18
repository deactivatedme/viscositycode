/**
 * ViscosityCode: shared runtime error reasons for Cursor SDK (chat) run
 * failures (fork of Poracode).
 *
 * A Cursor run that ends because the signed-in account ran out of usage (a
 * plan or spend limit, no credits left) carries the shared `"usage_limited"`
 * reason, so host policy (account pools) can move the thread to another
 * Cursor account. A transient rate limit (HTTP 429, "too many requests",
 * `resource_exhausted` on its own) does not: the account is not out, and the
 * same request can succeed moments later.
 *
 * The SDK worker forwards the run error's code (redacted) and message
 * (`sdkWorkerDiagnostics.ts`); only that text is read here. Sign-in failures
 * keep their own handling (`classifyCursorSdkRuntimeError`).
 */
import type { RuntimeErrorReason } from "@/shared/contracts";

/** Error codes that name an exhausted account or plan (Cursor's error-detail style). */
const CURSOR_USAGE_LIMIT_CODE_RE =
  /usage[_ -]?limit|usage[_ -]?pricing[_ -]?required|spend(?:ing)?[_ -]?limit|out[_ -]?of[_ -]?(?:credits|usage)|insufficient[_ -]?(?:credits?|balance|funds|quota)|payment[_ -]?required|^402$/i;

/** Message wording that clearly says the account or plan ran out. */
const CURSOR_USAGE_LIMIT_MESSAGE_RE =
  /\b(?:usage|spend(?:ing)?|plan|billing|monthly|hard) limits?\b|\bout of (?:usage|credits|fast requests|requests)\b|\b(?:usage|credits?|requests) (?:is |are |has been |have been )?(?:exhausted|depleted|used up)\b|\binsufficient (?:credits?|balance|funds|quota)\b|\bpayment required\b/i;

/**
 * The shared reason for a failed Cursor SDK run, or undefined. Only a code or
 * message that names the account or plan limit counts; rate-limit codes
 * (`rate_limited`, `429`, `resource_exhausted`) and wording ("too many
 * requests") alone stay reasonless.
 */
export function cursorSdkRunErrorReason(
  error: { message?: string; code?: string } | undefined,
): RuntimeErrorReason | undefined {
  if (!error) return undefined;
  const code = error.code ?? "";
  if (CURSOR_USAGE_LIMIT_CODE_RE.test(code) && !/rate/i.test(code)) return "usage_limited";
  return CURSOR_USAGE_LIMIT_MESSAGE_RE.test(error.message ?? "") ? "usage_limited" : undefined;
}
