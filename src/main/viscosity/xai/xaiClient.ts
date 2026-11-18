/**
 * ViscosityCode: the main-process xAI client (owner-confirmed spec in
 * `@/shared/viscosity/xaiContract`).
 *
 * - Text: `POST {base}/responses` with `model`, `input` (role/content
 *   messages), optional `instructions`, server-side `web_search` / `x_search`
 *   tools when enabled, and `stream: true`. `store: false` because the
 *   conversation is kept locally and re-sent each turn.
 * - Images: `POST https://api.x.ai/v1/images/generations` with
 *   `grok-imagine-image-2.0` (global endpoint only).
 * - Network hygiene: only the two documented origins, no redirects, a
 *   headers timeout, an idle timeout between stream chunks, a total cap, and
 *   one retry for 429 / 5xx that respects `Retry-After`.
 */
import {
  XAI_IMAGE_MODEL,
  type XaiImageRequest,
  type XaiImageResult,
  type XaiResponseRequest,
} from "@/shared/viscosity/xaiContract";
import {
  assertAllowedXaiUrl,
  assertRegionServesModel,
  xaiImagesUrl,
  xaiResponsesUrl,
} from "./xaiEndpoints";
import { XaiError, isXaiError, redactXaiText, xaiErrorFromHttp } from "./xaiErrors";
import {
  SseDecoder,
  XaiResponsesStreamReader,
  readXaiOutputText,
  readXaiUsage,
  type XaiStreamOutcome,
} from "./xaiSse";

export type XaiFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface XaiClientTimeouts {
  /** Until the response headers arrive (and for reading an error body). */
  headersMs: number;
  /** Longest silence allowed between stream chunks (reasoning can be quiet). */
  idleMs: number;
  /** Hard cap for one streamed response. */
  totalMs: number;
  /** Hard cap for one image generation. */
  imageMs: number;
}

export interface XaiRetryPolicy {
  /** Wait before the single retry when the server sends no Retry-After. */
  defaultDelayMs: number;
  /** A longer Retry-After is not waited for: the error is reported instead. */
  maxDelayMs: number;
}

export const DEFAULT_XAI_TIMEOUTS: XaiClientTimeouts = {
  headersMs: 60_000,
  idleMs: 300_000,
  totalMs: 30 * 60_000,
  imageMs: 180_000,
};

export const DEFAULT_XAI_RETRY: XaiRetryPolicy = { defaultDelayMs: 1_500, maxDelayMs: 30_000 };

export const MAX_XAI_IMAGE_PROMPT_LENGTH = 8_000;

export interface XaiClientDeps {
  fetch: XaiFetch;
  /** Main-process key lookup (environment first, then OS-encrypted storage). */
  resolveKey: () => string | undefined;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  now?: () => number;
  timeouts?: Partial<XaiClientTimeouts>;
  retry?: Partial<XaiRetryPolicy>;
}

export interface XaiClient {
  streamResponse(
    request: XaiResponseRequest,
    options: { signal: AbortSignal; onDelta: (text: string) => void },
  ): Promise<XaiStreamOutcome>;
  generateImage(
    request: XaiImageRequest,
    options: { signal: AbortSignal },
  ): Promise<XaiImageResult>;
}

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("aborted"));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort(): void {
      clearTimeout(timer);
      reject(new Error("aborted"));
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** `Retry-After` as delta-seconds or an HTTP date, in milliseconds. */
export function parseRetryAfterMs(header: string | null, now: number): number | undefined {
  if (!header) return undefined;
  const trimmed = header.trim();
  if (/^\d+(\.\d+)?$/u.test(trimmed)) return Math.round(Number(trimmed) * 1000);
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, date - now);
}

/** Links the caller's cancel signal with named timers; remembers why it aborted. */
class RequestGuard {
  private readonly controller = new AbortController();
  private reason: "cancelled" | "timeout" | undefined;
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly onParentAbort = () => this.abort("cancelled");

  constructor(private readonly parent: AbortSignal) {
    if (parent.aborted) this.abort("cancelled");
    else parent.addEventListener("abort", this.onParentAbort, { once: true });
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  arm(name: string, ms: number): void {
    this.clear(name);
    this.timers.set(
      name,
      setTimeout(() => this.abort("timeout"), ms),
    );
  }

  clear(name: string): void {
    const timer = this.timers.get(name);
    if (timer !== undefined) clearTimeout(timer);
    this.timers.delete(name);
  }

  dispose(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.parent.removeEventListener("abort", this.onParentAbort);
  }

  /** Map a thrown fetch/stream error to the reason we know about. */
  toError(cause: unknown, secret: string | undefined): XaiError {
    if (isXaiError(cause)) return cause;
    if (this.reason === "cancelled") return new XaiError("cancelled");
    if (this.reason === "timeout") return new XaiError("timeout");
    const detail = networkDetail(cause);
    return new XaiError("network", detail ? { detail: redactXaiText(detail, secret) } : {});
  }

  private abort(reason: "cancelled" | "timeout"): void {
    this.reason ??= reason;
    this.controller.abort();
  }
}

function networkDetail(cause: unknown): string | undefined {
  if (!(cause instanceof Error)) return undefined;
  const nested = (cause as Error & { cause?: unknown }).cause;
  if (nested instanceof Error && "code" in nested && typeof nested.code === "string") {
    return nested.code;
  }
  return cause.message || undefined;
}

export function buildXaiResponsesBody(request: XaiResponseRequest): Record<string, unknown> {
  const tools: Array<{ type: "web_search" | "x_search" }> = [];
  if (request.tools.webSearch) tools.push({ type: "web_search" });
  if (request.tools.xSearch) tools.push({ type: "x_search" });
  const instructions = request.instructions?.trim();
  return {
    model: request.model,
    input: request.input.map(({ role, content }) => ({ role, content })),
    ...(instructions ? { instructions } : {}),
    ...(tools.length > 0 ? { tools } : {}),
    stream: true,
    store: false,
  };
}

const IMAGE_MIME = /^image\/(png|jpeg|webp|gif)$/u;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/u;

export function readXaiImages(payload: unknown): string[] {
  const data =
    payload && typeof payload === "object" && Array.isArray((payload as { data?: unknown }).data)
      ? ((payload as { data: unknown[] }).data as unknown[])
      : [];
  const images: string[] = [];
  for (const entry of data) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    if (typeof record.b64_json === "string") {
      const base64 = record.b64_json.replace(/\s+/gu, "");
      if (!BASE64.test(base64)) continue;
      const mime =
        typeof record.mime_type === "string" && IMAGE_MIME.test(record.mime_type)
          ? record.mime_type
          : "image/png";
      images.push(`data:${mime};base64,${base64}`);
    } else if (typeof record.url === "string" && record.url.startsWith("https://")) {
      images.push(record.url);
    }
  }
  return images;
}

async function readBodyText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

export function createXaiClient(deps: XaiClientDeps): XaiClient {
  const timeouts = { ...DEFAULT_XAI_TIMEOUTS, ...deps.timeouts };
  const retry = { ...DEFAULT_XAI_RETRY, ...deps.retry };
  const sleep = deps.sleep ?? abortableSleep;
  const now = deps.now ?? Date.now;

  function requireKey(): string {
    const key = deps.resolveKey();
    if (!key) throw new XaiError("no-key");
    return key;
  }

  /** POST with the single 429/5xx retry; returns an OK response or throws `XaiError`. */
  async function post(
    url: string,
    body: string,
    key: string,
    accept: string,
    guard: RequestGuard,
  ): Promise<Response> {
    assertAllowedXaiUrl(url);
    for (let attempt = 0; ; attempt += 1) {
      guard.arm("headers", timeouts.headersMs);
      try {
        let response: Response;
        try {
          response = await deps.fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: accept,
              Authorization: `Bearer ${key}`,
            },
            body,
            signal: guard.signal,
            redirect: "error",
            credentials: "omit",
          });
        } catch (error) {
          throw guard.toError(error, key);
        }
        if (response.url) {
          try {
            assertAllowedXaiUrl(response.url);
          } catch {
            throw new XaiError("network", { detail: "The response came from an unexpected host." });
          }
        }
        if (response.ok) return response;
        const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"), now());
        const text = await readBodyText(response);
        const retryable = response.status === 429 || response.status >= 500;
        const delay = retryAfterMs ?? retry.defaultDelayMs;
        if (retryable && attempt === 0 && delay <= retry.maxDelayMs) {
          guard.clear("headers");
          try {
            await sleep(delay, guard.signal);
          } catch (error) {
            throw guard.toError(error, key);
          }
          continue;
        }
        throw xaiErrorFromHttp(response.status, text, {
          secret: key,
          ...(retryAfterMs !== undefined
            ? { retryAfterSeconds: Math.ceil(retryAfterMs / 1000) }
            : {}),
        });
      } finally {
        guard.clear("headers");
      }
    }
  }

  async function readStream(
    response: Response,
    key: string,
    guard: RequestGuard,
    onDelta: (text: string) => void,
  ): Promise<XaiStreamOutcome> {
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      // A non-streamed body (not expected with stream: true): read it whole.
      let payload: unknown;
      try {
        payload = await response.json();
      } catch (error) {
        throw guard.toError(error, key);
      }
      const text = readXaiOutputText(payload);
      if (!text) throw new XaiError("stream");
      onDelta(text);
      const usage = readXaiUsage((payload as { usage?: unknown } | null)?.usage);
      return { text, ...(usage ? { usage } : {}) };
    }
    const body = response.body;
    if (!body) throw new XaiError("stream");
    const reader = body.getReader();
    const decoder = new TextDecoder();
    const sse = new SseDecoder();
    const stream = new XaiResponsesStreamReader(onDelta, { secret: key });
    guard.arm("idle", timeouts.idleMs);
    try {
      for (;;) {
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try {
          chunk = await reader.read();
        } catch (error) {
          throw guard.toError(error, key);
        }
        if (chunk.done) break;
        guard.arm("idle", timeouts.idleMs);
        for (const message of sse.push(decoder.decode(chunk.value, { stream: true }))) {
          const outcome = stream.push(message);
          if (outcome) {
            void reader.cancel().catch(() => undefined);
            return outcome;
          }
        }
      }
      for (const message of [...sse.push(decoder.decode()), ...sse.finish()]) {
        const outcome = stream.push(message);
        if (outcome) return outcome;
      }
      return stream.end();
    } finally {
      guard.clear("idle");
    }
  }

  return {
    async streamResponse(request, { signal, onDelta }) {
      assertRegionServesModel(request.region, request.model);
      const key = requireKey();
      const guard = new RequestGuard(signal);
      guard.arm("total", timeouts.totalMs);
      try {
        const response = await post(
          xaiResponsesUrl(request.region),
          JSON.stringify(buildXaiResponsesBody(request)),
          key,
          "text/event-stream",
          guard,
        );
        return await readStream(response, key, guard, onDelta);
      } catch (error) {
        throw guard.toError(error, key);
      } finally {
        guard.dispose();
      }
    },

    async generateImage(request, { signal }) {
      const prompt = request.prompt.trim();
      if (!prompt || prompt.length > MAX_XAI_IMAGE_PROMPT_LENGTH) {
        throw new XaiError("invalid-request");
      }
      const key = requireKey();
      const guard = new RequestGuard(signal);
      guard.arm("total", timeouts.imageMs);
      try {
        const response = await post(
          xaiImagesUrl(),
          JSON.stringify({ model: XAI_IMAGE_MODEL, prompt, n: 1, response_format: "b64_json" }),
          key,
          "application/json",
          guard,
        );
        let payload: unknown;
        try {
          payload = await response.json();
        } catch (error) {
          throw guard.toError(error, key);
        }
        const images = readXaiImages(payload);
        if (images.length === 0) throw new XaiError("response-failed");
        return { images };
      } catch (error) {
        throw guard.toError(error, key);
      } finally {
        guard.dispose();
      }
    },
  };
}
