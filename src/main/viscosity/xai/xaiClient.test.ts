import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { XaiResponseRequest } from "@/shared/viscosity/xaiContract";
import {
  buildXaiResponsesBody,
  createXaiClient,
  parseRetryAfterMs,
  readXaiImages,
  type XaiClientDeps,
  type XaiFetch,
} from "./xaiClient";
import type { XaiError } from "./xaiErrors";

const KEY = "xai-testKEY0123456789abcdefghij";

function fixture(name: string): string {
  return readFileSync(join(import.meta.dirname, "__fixtures__", name), "utf8");
}

function abortError(): Error {
  return Object.assign(new Error("The operation was aborted."), { name: "AbortError" });
}

/** A body that emits `chunks` and then stays open (or closes), wired to the abort signal like real fetch. */
function streamBody(
  chunks: Uint8Array[],
  signal: AbortSignal | null | undefined,
  options: { close?: boolean } = {},
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      if (options.close !== false) controller.close();
      signal?.addEventListener("abort", () => {
        try {
          controller.error(abortError());
        } catch {
          // Already closed.
        }
      });
    },
  });
}

function bytes(text: string, chunkSize: number): Uint8Array[] {
  const all = new TextEncoder().encode(text);
  const chunks: Uint8Array[] = [];
  for (let index = 0; index < all.length; index += chunkSize) {
    chunks.push(all.slice(index, index + chunkSize));
  }
  return chunks;
}

function sse(text: string, signal: AbortSignal | null | undefined, chunkSize = 13): Response {
  return new Response(streamBody(bytes(text, chunkSize), signal), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function request(overrides: Partial<XaiResponseRequest> = {}): XaiResponseRequest {
  return {
    requestId: "req-1",
    model: "grok-4.7",
    region: "global",
    input: [
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello" },
      { role: "user", content: "Review this" },
    ],
    tools: { webSearch: false, xSearch: false },
    ...overrides,
  };
}

function client(fetch: XaiFetch, overrides: Partial<XaiClientDeps> = {}) {
  const sleep = vi.fn<(ms: number, signal: AbortSignal) => Promise<void>>(() => Promise.resolve());
  const deps: XaiClientDeps = {
    fetch,
    resolveKey: () => KEY,
    sleep,
    now: () => Date.parse("2026-11-17T12:00:00Z"),
    ...overrides,
  };
  return { client: createXaiClient(deps), sleep };
}

async function failure(promise: Promise<unknown>): Promise<XaiError> {
  try {
    await promise;
  } catch (error) {
    return error as XaiError;
  }
  throw new Error("expected a failure");
}

describe("xAI Responses request", () => {
  it("posts model, input, instructions, tools and stream to /responses with the bearer key", async () => {
    const fetch = vi.fn<XaiFetch>((_url, init) =>
      Promise.resolve(sse(fixture("text-deltas.sse"), init.signal)),
    );
    const { client: xai } = client(fetch);
    await xai.streamResponse(
      request({ instructions: "  Be terse.  ", tools: { webSearch: true, xSearch: true } }),
      { signal: new AbortController().signal, onDelta: () => undefined },
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("https://api.x.ai/v1/responses");
    expect(init?.method).toBe("POST");
    expect(init?.redirect).toBe("error");
    expect(init?.headers).toEqual({
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      Authorization: `Bearer ${KEY}`,
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      model: "grok-4.7",
      input: request().input,
      instructions: "Be terse.",
      tools: [{ type: "web_search" }, { type: "x_search" }],
      stream: true,
      store: false,
    });
  });

  it("omits tools and instructions when not set", () => {
    const body = buildXaiResponsesBody(request({ tools: { webSearch: false, xSearch: true } }));
    expect(body).toEqual({
      model: "grok-4.7",
      input: request().input,
      tools: [{ type: "x_search" }],
      stream: true,
      store: false,
    });
    expect(buildXaiResponsesBody(request({ instructions: "  " }))).not.toHaveProperty(
      "instructions",
    );
  });

  it("uses the US endpoint for region us", async () => {
    const fetch = vi.fn<XaiFetch>((_url, init) =>
      Promise.resolve(sse(fixture("text-deltas.sse"), init.signal)),
    );
    await client(fetch).client.streamResponse(request({ region: "us", model: "grok-4.6" }), {
      signal: new AbortController().signal,
      onDelta: () => undefined,
    });
    expect(fetch.mock.calls[0]?.[0]).toBe("https://us.api.x.ai/v1/responses");
  });

  it("rejects other models on the US endpoint without any request", async () => {
    const fetch = vi.fn<XaiFetch>();
    const error = await failure(
      client(fetch).client.streamResponse(request({ region: "us", model: "grok-latest" }), {
        signal: new AbortController().signal,
        onDelta: () => undefined,
      }),
    );
    expect(error.code).toBe("region-model");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fails with no-key before any request when no key is configured", async () => {
    const fetch = vi.fn<XaiFetch>();
    const error = await failure(
      client(fetch, { resolveKey: () => undefined }).client.streamResponse(request(), {
        signal: new AbortController().signal,
        onDelta: () => undefined,
      }),
    );
    expect(error.code).toBe("no-key");
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("xAI streaming", () => {
  it("streams deltas across byte chunks that split UTF-8 characters", async () => {
    const deltas: string[] = [];
    const fetch: XaiFetch = (_url, init) =>
      Promise.resolve(sse(fixture("text-deltas.sse"), init.signal, 3));
    const outcome = await client(fetch).client.streamResponse(request(), {
      signal: new AbortController().signal,
      onDelta: (text) => deltas.push(text),
    });
    expect(deltas.join("")).toBe("Hello, roundtable! ✓");
    expect(outcome).toEqual({
      text: "Hello, roundtable! ✓",
      usage: { inputTokens: 42, outputTokens: 7 },
    });
  });

  it("surfaces a stream error event as response-failed with the key redacted", async () => {
    const fetch: XaiFetch = (_url, init) =>
      Promise.resolve(
        sse(
          fixture("error-event.sse").replace("xai-ABCDEFGHIJKLMNOPQRSTUVWX0123", KEY),
          init.signal,
        ),
      );
    const error = await failure(
      client(fetch).client.streamResponse(request(), {
        signal: new AbortController().signal,
        onDelta: () => undefined,
      }),
    );
    expect(error.code).toBe("response-failed");
    expect(error.detail).not.toContain(KEY);
    expect(JSON.stringify(error)).not.toContain(KEY);
  });

  it("reports cancelled when the caller aborts mid-stream", async () => {
    const controller = new AbortController();
    const fetch: XaiFetch = (_url, init) =>
      Promise.resolve(
        new Response(
          streamBody(
            bytes('data: {"type":"response.output_text.delta","delta":"Hi"}\n\n', 64),
            init.signal,
            { close: false },
          ),
          { status: 200, headers: { "content-type": "text/event-stream" } },
        ),
      );
    const pending = client(fetch).client.streamResponse(request(), {
      signal: controller.signal,
      onDelta: () => controller.abort(),
    });
    expect((await failure(pending)).code).toBe("cancelled");
  });

  it("times out when the stream goes quiet", async () => {
    const fetch: XaiFetch = (_url, init) =>
      Promise.resolve(
        new Response(streamBody([], init.signal, { close: false }), {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
      );
    const error = await failure(
      client(fetch, { timeouts: { idleMs: 20 } }).client.streamResponse(request(), {
        signal: new AbortController().signal,
        onDelta: () => undefined,
      }),
    );
    expect(error.code).toBe("timeout");
  });

  it("times out when the headers never arrive", async () => {
    const fetch: XaiFetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(abortError()));
      });
    const error = await failure(
      client(fetch, { timeouts: { headersMs: 20 } }).client.streamResponse(request(), {
        signal: new AbortController().signal,
        onDelta: () => undefined,
      }),
    );
    expect(error.code).toBe("timeout");
  });

  it("refuses a response served from an unexpected host", async () => {
    const fetch: XaiFetch = (_url, init) => {
      const response = sse(fixture("text-deltas.sse"), init.signal);
      Object.defineProperty(response, "url", { value: "https://evil.example/v1/responses" });
      return Promise.resolve(response);
    };
    const error = await failure(
      client(fetch).client.streamResponse(request(), {
        signal: new AbortController().signal,
        onDelta: () => undefined,
      }),
    );
    expect(error.code).toBe("network");
  });
});

describe("xAI retries and error mapping", () => {
  it("retries once on 429, waiting for Retry-After", async () => {
    const fetch = vi
      .fn<XaiFetch>()
      .mockResolvedValueOnce(
        jsonResponse(429, { error: "Too many requests" }, { "retry-after": "2" }),
      )
      .mockImplementationOnce((_url, init) =>
        Promise.resolve(sse(fixture("text-deltas.sse"), init.signal)),
      );
    const { client: xai, sleep } = client(fetch);
    const outcome = await xai.streamResponse(request(), {
      signal: new AbortController().signal,
      onDelta: () => undefined,
    });
    expect(outcome.text).toBe("Hello, roundtable! ✓");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep.mock.calls[0]?.[0]).toBe(2000);
  });

  it("retries a 5xx only once, with the default backoff", async () => {
    const fetch = vi.fn<XaiFetch>(() =>
      Promise.resolve(jsonResponse(503, { code: "unavailable", error: "Service unavailable" })),
    );
    const { client: xai, sleep } = client(fetch);
    const error = await failure(
      xai.streamResponse(request(), {
        signal: new AbortController().signal,
        onDelta: () => undefined,
      }),
    );
    expect(error.code).toBe("server");
    expect(error.status).toBe(503);
    expect(error.detail).toBe("Service unavailable");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(sleep.mock.calls.map((call) => call[0])).toEqual([1500]);
  });

  it("does not wait for a long Retry-After and reports it instead", async () => {
    const fetch = vi.fn<XaiFetch>(() =>
      Promise.resolve(jsonResponse(429, { error: "slow down" }, { "retry-after": "120" })),
    );
    const { client: xai, sleep } = client(fetch);
    const error = await failure(
      xai.streamResponse(request(), {
        signal: new AbortController().signal,
        onDelta: () => undefined,
      }),
    );
    expect(error.code).toBe("rate-limited");
    expect(error.retryAfterSeconds).toBe(120);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("maps 401 to auth without echoing the key", async () => {
    const fetch = vi.fn<XaiFetch>(() =>
      Promise.resolve(
        jsonResponse(401, { error: { message: `Incorrect API key provided: ${KEY}` } }),
      ),
    );
    const error = await failure(
      client(fetch).client.streamResponse(request(), {
        signal: new AbortController().signal,
        onDelta: () => undefined,
      }),
    );
    expect(error.code).toBe("auth");
    expect(error.detail).toBe("Incorrect API key provided: [redacted]");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("maps 400 / 403 / 404 / 422 to friendly codes", async () => {
    const cases: Array<[number, string]> = [
      [400, "bad-request"],
      [403, "forbidden"],
      [404, "not-found"],
      [422, "bad-request"],
    ];
    for (const [status, code] of cases) {
      const fetch: XaiFetch = () =>
        Promise.resolve(jsonResponse(status, { code: "x", error: "Field 'input' is invalid" }));
      const error = await failure(
        client(fetch).client.streamResponse(request(), {
          signal: new AbortController().signal,
          onDelta: () => undefined,
        }),
      );
      expect(error.code).toBe(code);
      expect(error.detail).toBe("Field 'input' is invalid");
    }
  });

  it("maps a connection failure to network and does not retry it", async () => {
    const fetch = vi.fn<XaiFetch>(() =>
      Promise.reject(
        Object.assign(new TypeError("fetch failed"), {
          cause: Object.assign(new Error("getaddrinfo"), { code: "ENOTFOUND" }),
        }),
      ),
    );
    const error = await failure(
      client(fetch).client.streamResponse(request(), {
        signal: new AbortController().signal,
        onDelta: () => undefined,
      }),
    );
    expect(error.code).toBe("network");
    expect(error.detail).toBe("ENOTFOUND");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("parses Retry-After seconds and HTTP dates", () => {
    const now = Date.parse("2026-11-17T12:00:00Z");
    expect(parseRetryAfterMs("3", now)).toBe(3000);
    expect(parseRetryAfterMs("Tue, 17 Nov 2026 12:00:05 GMT", now)).toBe(5000);
    expect(parseRetryAfterMs("Tue, 17 Nov 2026 11:00:00 GMT", now)).toBe(0);
    expect(parseRetryAfterMs("soon", now)).toBeUndefined();
    expect(parseRetryAfterMs(null, now)).toBeUndefined();
  });
});

describe("xAI image generation", () => {
  it("uses grok-imagine-image-2.0 on the global endpoint and returns data URLs", async () => {
    const fetch = vi.fn<XaiFetch>(() =>
      Promise.resolve(
        jsonResponse(200, { data: [{ b64_json: "aGVsbG8=", mime_type: "image/jpeg" }] }),
      ),
    );
    const result = await client(fetch).client.generateImage(
      { requestId: "img-1", prompt: "  a cat  " },
      { signal: new AbortController().signal },
    );
    expect(result).toEqual({ images: ["data:image/jpeg;base64,aGVsbG8="] });
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("https://api.x.ai/v1/images/generations");
    expect(JSON.parse(String(init?.body))).toEqual({
      model: "grok-imagine-image-2.0",
      prompt: "a cat",
      n: 1,
      response_format: "b64_json",
    });
  });

  it("rejects empty prompts and empty results", async () => {
    const fetch = vi.fn<XaiFetch>(() => Promise.resolve(jsonResponse(200, { data: [] })));
    const { client: xai } = client(fetch);
    expect(
      (
        await failure(
          xai.generateImage(
            { requestId: "i", prompt: " " },
            { signal: new AbortController().signal },
          ),
        )
      ).code,
    ).toBe("invalid-request");
    expect(fetch).not.toHaveBeenCalled();
    expect(
      (
        await failure(
          xai.generateImage(
            { requestId: "i", prompt: "x" },
            { signal: new AbortController().signal },
          ),
        )
      ).code,
    ).toBe("response-failed");
  });

  it("keeps only safe image payloads", () => {
    expect(
      readXaiImages({
        data: [
          { b64_json: "QUJD", mime_type: "text/html" },
          { b64_json: "not base64!" },
          { url: "https://imgen.x.ai/a.png" },
          { url: "http://insecure.example/b.png" },
          { url: "javascript:alert(1)" },
        ],
      }),
    ).toEqual(["data:image/png;base64,QUJD", "https://imgen.x.ai/a.png"]);
  });
});
