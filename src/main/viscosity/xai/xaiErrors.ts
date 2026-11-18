/**
 * ViscosityCode: typed xAI failures for the main-process client.
 *
 * Every failure carries a machine-readable `code` (the renderer localizes from
 * it), English text for logs and fallbacks, and optionally the API's own
 * message as `detail`. Detail text is always redacted: it never contains the
 * API key or anything shaped like one.
 */
import type { XaiErrorCode } from "@/shared/viscosity/xaiContract";
import { XAI_US_TEXT_MODELS } from "@/shared/viscosity/xaiContract";

const MAX_DETAIL_LENGTH = 300;
/** xAI keys look like `xai-` followed by a long token; redact anything of that shape. */
const KEY_SHAPED = /xai-[A-Za-z0-9_-]{8,}/gu;
const BEARER_SHAPED = /Bearer\s+[A-Za-z0-9._~+/=-]{8,}/giu;

const ENGLISH_MESSAGES: Record<XaiErrorCode, string> = {
  unavailable: "Grok over the xAI API is only available in the desktop app.",
  "no-key": "Add an xAI API key in Settings, or set the XAI_API_KEY environment variable.",
  "invalid-key-format":
    "That doesn't look like an xAI API key. Paste the full key from console.x.ai.",
  "storage-unavailable":
    "This system's secure credential storage isn't available, so the key can't be saved. Set the XAI_API_KEY environment variable instead.",
  "storage-failed": "The xAI API key couldn't be saved or removed on this device.",
  "region-model": `The US endpoint only serves ${XAI_US_TEXT_MODELS.join(" and ")}. Pick one of those models or switch the region to Global.`,
  "invalid-request": "The request to xAI was not valid.",
  busy: "Too many xAI requests are running at once. Wait for one to finish.",
  auth: "xAI didn't accept the API key. Check the key in Settings or XAI_API_KEY.",
  forbidden: "This xAI API key isn't allowed to use that model or feature.",
  "not-found": "xAI couldn't find that model on this endpoint.",
  "bad-request": "xAI rejected the request.",
  "rate-limited": "xAI rate limit reached. Try again in a moment.",
  server: "xAI is having trouble right now. Try again shortly.",
  timeout: "xAI didn't respond in time.",
  network: "Couldn't reach the xAI API. Check your internet connection.",
  stream: "The xAI response ended unexpectedly.",
  "response-failed": "xAI couldn't finish the response.",
  cancelled: "Stopped.",
  unknown: "Something went wrong talking to xAI.",
};

export function englishXaiMessage(code: XaiErrorCode): string {
  return ENGLISH_MESSAGES[code];
}

export class XaiError extends Error {
  readonly code: XaiErrorCode;
  readonly status: number | undefined;
  readonly detail: string | undefined;
  /** Seconds the API asked us to wait (429), when known. */
  readonly retryAfterSeconds: number | undefined;

  constructor(
    code: XaiErrorCode,
    options: { status?: number; detail?: string; retryAfterSeconds?: number } = {},
  ) {
    super(englishXaiMessage(code));
    this.name = "XaiError";
    this.code = code;
    this.status = options.status;
    this.detail = options.detail;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

export function isXaiError(error: unknown): error is XaiError {
  return error instanceof XaiError;
}

/** Remove the key (and anything key- or bearer-shaped) and clamp the length. */
export function redactXaiText(text: string, secret?: string): string {
  let result = text;
  if (secret && secret.length >= 4) result = result.split(secret).join("[redacted]");
  result = result.replace(KEY_SHAPED, "[redacted]").replace(BEARER_SHAPED, "Bearer [redacted]");
  result = result.replace(/\s+/gu, " ").trim();
  return result.length > MAX_DETAIL_LENGTH ? `${result.slice(0, MAX_DETAIL_LENGTH - 1)}…` : result;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

/**
 * Pull a human message out of an xAI error body. The API's error shape is not
 * documented precisely, so accept the common variants: `{error: "…"}`,
 * `{error: {message}}`, `{message}`, `{code, error}` and plain text.
 */
export function extractXaiServerMessage(body: string): string | undefined {
  const trimmed = body.trim();
  if (!trimmed) return undefined;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;
      const error = record.error;
      if (error && typeof error === "object") {
        const nested = readString((error as Record<string, unknown>).message);
        if (nested) return nested;
      }
      return readString(error) ?? readString(record.message) ?? readString(record.detail);
    }
    return readString(parsed);
  } catch {
    // Not JSON: plain text bodies are used as-is (HTML error pages are skipped).
    return trimmed.startsWith("<") ? undefined : trimmed;
  }
}

export function xaiCodeForStatus(status: number): XaiErrorCode {
  if (status === 401) return "auth";
  if (status === 403) return "forbidden";
  if (status === 404) return "not-found";
  if (status === 429) return "rate-limited";
  if (status >= 500) return "server";
  if (status >= 400) return "bad-request";
  return "unknown";
}

export function xaiErrorFromHttp(
  status: number,
  body: string,
  options: { secret?: string; retryAfterSeconds?: number } = {},
): XaiError {
  const message = extractXaiServerMessage(body);
  return new XaiError(xaiCodeForStatus(status), {
    status,
    ...(message ? { detail: redactXaiText(message, options.secret) } : {}),
    ...(options.retryAfterSeconds !== undefined
      ? { retryAfterSeconds: options.retryAfterSeconds }
      : {}),
  });
}

/** Wire form of a failure: what the IPC layer sends to the renderer. */
export interface XaiFailure {
  code: XaiErrorCode;
  message: string;
  status?: number;
  detail?: string;
}

export function toXaiFailure(error: unknown, secret?: string): XaiFailure {
  if (isXaiError(error)) {
    return {
      code: error.code,
      message: error.message,
      ...(error.status !== undefined ? { status: error.status } : {}),
      ...(error.detail ? { detail: redactXaiText(error.detail, secret) } : {}),
    };
  }
  return { code: "unknown", message: englishXaiMessage("unknown") };
}
