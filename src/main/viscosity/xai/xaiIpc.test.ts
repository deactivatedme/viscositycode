import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  XAI_IPC,
  type XaiImageResult,
  type XaiResponseRequest,
  type XaiStreamEvent,
} from "@/shared/viscosity/xaiContract";
import type { XaiClient } from "./xaiClient";
import { XaiError } from "./xaiErrors";
import { createXaiIpcHandlers, isXaiMainFrameSender, type XaiIpcSender } from "./xaiIpc";
import type { XaiKeyStore } from "./xaiKeyStore";
import type { XaiStreamOutcome } from "./xaiSse";

interface FakeSender extends XaiIpcSender {
  events: XaiStreamEvent[];
  destroy(): void;
  /** Simulates a page reload or renderer crash (the webContents survives). */
  resetPage(): void;
}

function fakeSender(id = 1): FakeSender {
  let destroyed = false;
  const destroyedListeners: Array<() => void> = [];
  const pageResetListeners: Array<() => void> = [];
  const events: XaiStreamEvent[] = [];
  return {
    id,
    events,
    send: (channel, payload) => {
      expect(channel).toBe(XAI_IPC.event);
      events.push(payload);
    },
    isDestroyed: () => destroyed,
    once: (_name, listener) => {
      destroyedListeners.push(listener);
    },
    onPageReset: (listener) => {
      pageResetListeners.push(listener);
    },
    destroy() {
      destroyed = true;
      for (const listener of destroyedListeners.splice(0)) listener();
    },
    resetPage() {
      for (const listener of pageResetListeners) listener();
    },
  };
}

interface PendingStream {
  request: XaiResponseRequest;
  signal: AbortSignal;
  onDelta: (text: string) => void;
  resolve: (outcome: XaiStreamOutcome) => void;
  reject: (error: unknown) => void;
}

function fakeClient() {
  const streams: PendingStream[] = [];
  const client: XaiClient = {
    streamResponse: (request, { signal, onDelta }) =>
      new Promise((resolve, reject) => {
        streams.push({ request, signal, onDelta, resolve, reject });
        signal.addEventListener("abort", () => reject(new XaiError("cancelled")));
      }),
    generateImage: vi.fn<XaiClient["generateImage"]>(() =>
      Promise.resolve<XaiImageResult>({ images: ["data:image/png;base64,QUJD"] }),
    ),
  };
  return { client, streams };
}

const keyStore: XaiKeyStore = {
  keyStatus: () => ({ configured: true, source: "stored", hint: "WXYZ" }),
  setKey: (raw) => {
    if (raw === "bad") throw new XaiError("invalid-key-format");
    return { configured: true, source: "stored", hint: "abcd" };
  },
  clearKey: () => ({ configured: false, source: "none" }),
  resolveKey: () => "xai-secretKEY0123456789abcdefWXYZ",
};

function validRequest(overrides: Record<string, unknown> = {}) {
  return {
    requestId: "req-1",
    model: "grok-4.7",
    region: "global",
    input: [{ role: "user", content: "hello" }],
    tools: { webSearch: true, xSearch: false },
    ...overrides,
  };
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
}

describe("xAI IPC handlers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns key status without the key", () => {
    const handlers = createXaiIpcHandlers({ keyStore, client: fakeClient().client });
    const result = handlers.keyStatus();
    expect(result).toEqual({
      ok: true,
      value: { configured: true, source: "stored", hint: "WXYZ" },
    });
    expect(JSON.stringify(result)).not.toContain("secretKEY");
  });

  it("returns a failure envelope (not a throw) for a rejected key", () => {
    const handlers = createXaiIpcHandlers({ keyStore, client: fakeClient().client });
    expect(handlers.setKey("bad")).toMatchObject({
      ok: false,
      error: { code: "invalid-key-format" },
    });
    expect(handlers.clearKey()).toEqual({ ok: true, value: { configured: false, source: "none" } });
  });

  it("streams coalesced deltas and a done event to the requesting sender", async () => {
    const { client, streams } = fakeClient();
    const handlers = createXaiIpcHandlers({ keyStore, client, coalesceMs: 40 });
    const sender = fakeSender();
    expect(handlers.respond(sender, validRequest({ instructions: "Persona" }))).toEqual({
      ok: true,
      value: null,
    });
    expect(handlers.activeCount(sender.id)).toBe(1);
    const stream = streams[0];
    expect(stream?.request).toMatchObject({
      requestId: "req-1",
      model: "grok-4.7",
      region: "global",
      instructions: "Persona",
      tools: { webSearch: true, xSearch: false },
    });
    stream?.onDelta("Hel");
    stream?.onDelta("lo");
    expect(sender.events).toEqual([]);
    vi.advanceTimersByTime(40);
    expect(sender.events).toEqual([{ requestId: "req-1", type: "delta", text: "Hello" }]);
    stream?.onDelta(" world");
    stream?.resolve({ text: "Hello world", usage: { inputTokens: 3, outputTokens: 2 } });
    await flushMicrotasks();
    expect(sender.events).toEqual([
      { requestId: "req-1", type: "delta", text: "Hello" },
      { requestId: "req-1", type: "delta", text: " world" },
      {
        requestId: "req-1",
        type: "done",
        text: "Hello world",
        usage: { inputTokens: 3, outputTokens: 2 },
      },
    ]);
    expect(handlers.activeCount(sender.id)).toBe(0);
  });

  it("sends coded error events", async () => {
    const { client, streams } = fakeClient();
    const handlers = createXaiIpcHandlers({ keyStore, client });
    const sender = fakeSender();
    handlers.respond(sender, validRequest());
    streams[0]?.reject(new XaiError("rate-limited", { status: 429, detail: "slow down" }));
    await flushMicrotasks();
    expect(sender.events).toEqual([
      {
        requestId: "req-1",
        type: "error",
        code: "rate-limited",
        message: "xAI rate limit reached. Try again in a moment.",
        status: 429,
        detail: "slow down",
      },
    ]);
  });

  it("cancels a request without emitting anything", async () => {
    const { client, streams } = fakeClient();
    const handlers = createXaiIpcHandlers({ keyStore, client });
    const sender = fakeSender();
    handlers.respond(sender, validRequest());
    streams[0]?.onDelta("partial");
    expect(handlers.cancel(sender, "req-1")).toEqual({ ok: true, value: null });
    expect(streams[0]?.signal.aborted).toBe(true);
    await flushMicrotasks();
    vi.advanceTimersByTime(100);
    expect(sender.events).toEqual([]);
    expect(handlers.activeCount(sender.id)).toBe(0);
  });

  it("only cancels the caller's own request", () => {
    const { client, streams } = fakeClient();
    const handlers = createXaiIpcHandlers({ keyStore, client });
    const owner = fakeSender(1);
    const other = fakeSender(2);
    handlers.respond(owner, validRequest());
    handlers.cancel(other, "req-1");
    expect(streams[0]?.signal.aborted).toBe(false);
  });

  it("aborts every request of a destroyed sender", () => {
    const { client, streams } = fakeClient();
    const handlers = createXaiIpcHandlers({ keyStore, client });
    const sender = fakeSender();
    handlers.respond(sender, validRequest({ requestId: "a" }));
    handlers.respond(sender, validRequest({ requestId: "b" }));
    sender.destroy();
    expect(streams.map((stream) => stream.signal.aborted)).toEqual([true, true]);
    expect(handlers.activeCount(sender.id)).toBe(0);
  });

  it("aborts a sender's requests when its page reloads or crashes, then serves the new page", async () => {
    const { client, streams } = fakeClient();
    const handlers = createXaiIpcHandlers({ keyStore, client, maxConcurrentPerSender: 1 });
    const sender = fakeSender();
    handlers.respond(sender, validRequest({ requestId: "before-reload" }));
    streams[0]?.onDelta("partial");
    sender.resetPage();
    expect(streams[0]?.signal.aborted).toBe(true);
    expect(handlers.activeCount(sender.id)).toBe(0);
    await flushMicrotasks();
    vi.advanceTimersByTime(100);
    // The old page is gone: nothing is emitted for its request.
    expect(sender.events).toEqual([]);
    // The reloaded page gets the window's full budget back, and later resets still apply.
    expect(handlers.respond(sender, validRequest({ requestId: "after-reload" })).ok).toBe(true);
    sender.resetPage();
    expect(streams[1]?.signal.aborted).toBe(true);
  });

  it("refuses duplicate ids and caps concurrent requests per sender", () => {
    const { client } = fakeClient();
    const handlers = createXaiIpcHandlers({ keyStore, client, maxConcurrentPerSender: 2 });
    const sender = fakeSender();
    expect(handlers.respond(sender, validRequest({ requestId: "a" })).ok).toBe(true);
    expect(handlers.respond(sender, validRequest({ requestId: "a" }))).toMatchObject({
      ok: false,
      error: { code: "busy" },
    });
    expect(handlers.respond(sender, validRequest({ requestId: "b" })).ok).toBe(true);
    expect(handlers.respond(sender, validRequest({ requestId: "c" }))).toMatchObject({
      ok: false,
      error: { code: "busy" },
    });
    // Another window has its own budget.
    expect(handlers.respond(fakeSender(2), validRequest({ requestId: "c" })).ok).toBe(true);
  });

  it("rejects malformed payloads before calling the client", () => {
    const { client, streams } = fakeClient();
    const handlers = createXaiIpcHandlers({ keyStore, client });
    const sender = fakeSender();
    for (const bad of [
      null,
      "text",
      validRequest({ requestId: "" }),
      validRequest({ requestId: "has space" }),
      validRequest({ region: "eu" }),
      validRequest({ input: [] }),
      validRequest({ input: [{ role: "tool", content: "x" }] }),
      validRequest({ tools: { webSearch: "yes", xSearch: false } }),
      validRequest({ input: [{ role: "user", content: "x".repeat(2_000_001) }] }),
    ]) {
      expect(handlers.respond(sender, bad)).toMatchObject({
        ok: false,
        error: { code: "invalid-request" },
      });
    }
    expect(handlers.cancel(sender, 42)).toMatchObject({ ok: false });
    expect(streams).toHaveLength(0);
  });

  it("generates images through the client and maps failures", async () => {
    const { client } = fakeClient();
    const handlers = createXaiIpcHandlers({ keyStore, client });
    const sender = fakeSender();
    await expect(
      handlers.generateImage(sender, { requestId: "i1", prompt: "cat" }),
    ).resolves.toEqual({ ok: true, value: { images: ["data:image/png;base64,QUJD"] } });
    vi.mocked(client.generateImage).mockRejectedValueOnce(new XaiError("no-key"));
    await expect(
      handlers.generateImage(sender, { requestId: "i2", prompt: "cat" }),
    ).resolves.toMatchObject({ ok: false, error: { code: "no-key" } });
    await expect(
      handlers.generateImage(sender, { requestId: "i3", prompt: "" }),
    ).resolves.toMatchObject({ ok: false, error: { code: "invalid-request" } });
    expect(handlers.activeCount(sender.id)).toBe(0);
  });

  it("cancelAll aborts everything", () => {
    const { client, streams } = fakeClient();
    const handlers = createXaiIpcHandlers({ keyStore, client });
    handlers.respond(fakeSender(1), validRequest({ requestId: "a" }));
    handlers.respond(fakeSender(2), validRequest({ requestId: "b" }));
    handlers.cancelAll();
    expect(streams.every((stream) => stream.signal.aborted)).toBe(true);
  });
});

describe("sender frame check", () => {
  const main = { routingId: 1, processId: 7 };

  it("accepts only the window's main frame", () => {
    expect(isXaiMainFrameSender({ senderFrame: main, sender: { mainFrame: main } })).toBe(true);
    expect(
      isXaiMainFrameSender({
        senderFrame: { routingId: 2, processId: 7 },
        sender: { mainFrame: main },
      }),
    ).toBe(false);
    expect(
      isXaiMainFrameSender({
        senderFrame: { routingId: 1, processId: 8 },
        sender: { mainFrame: main },
      }),
    ).toBe(false);
    expect(isXaiMainFrameSender({ senderFrame: null, sender: { mainFrame: main } })).toBe(false);
  });
});
