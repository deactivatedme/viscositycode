import { describe, expect, it, vi } from "vitest";
import {
  XAI_BRIDGE_ERROR_PREFIX,
  XAI_IPC,
  type XaiStreamEvent,
} from "@/shared/viscosity/xaiContract";
import { createViscosityXaiPreloadBridge, type XaiPreloadIpc } from "./xaiPreloadBridge";

type Handler = (event: unknown, payload: unknown) => void;

function fakeIpc(replies: Record<string, unknown>) {
  const handlers = new Set<Handler>();
  const invoke = vi.fn<(channel: string, ...args: unknown[]) => Promise<unknown>>((channel) =>
    Promise.resolve(replies[channel]),
  );
  const ipc = {
    invoke,
    on: vi.fn<(channel: string, handler: Handler) => void>((channel, handler) => {
      expect(channel).toBe(XAI_IPC.event);
      handlers.add(handler);
    }),
    removeListener: vi.fn<(channel: string, handler: Handler) => void>((_channel, handler) => {
      handlers.delete(handler);
    }),
  };
  return {
    ipc: ipc as unknown as XaiPreloadIpc,
    invoke,
    handlers,
    emit: (payload: unknown) => {
      for (const handler of handlers) handler({}, payload);
    },
  };
}

async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected a rejection");
}

describe("viscosityHost.xai preload bridge", () => {
  it("unwraps successful envelopes", async () => {
    const fake = fakeIpc({
      [XAI_IPC.keyStatus]: { ok: true, value: { configured: false, source: "none" } },
      [XAI_IPC.respond]: { ok: true, value: null },
    });
    const bridge = createViscosityXaiPreloadBridge(fake.ipc);
    expect(bridge.available).toBe(true);
    await expect(bridge.keyStatus()).resolves.toEqual({ configured: false, source: "none" });
    const request = {
      requestId: "r",
      model: "grok-4.7",
      region: "global" as const,
      input: [{ role: "user" as const, content: "hi" }],
      tools: { webSearch: false, xSearch: false },
    };
    await expect(bridge.respond(request)).resolves.toBeUndefined();
    expect(fake.invoke).toHaveBeenCalledWith(XAI_IPC.respond, request);
  });

  it("rejects failed envelopes with a code-carrying message", async () => {
    const fake = fakeIpc({
      [XAI_IPC.setKey]: {
        ok: false,
        error: { code: "storage-unavailable", message: "English text", detail: "d" },
      },
      [XAI_IPC.clearKey]: "garbage",
    });
    const bridge = createViscosityXaiPreloadBridge(fake.ipc);
    const error = await rejection(bridge.setKey("xai-key"));
    expect(error.message.startsWith(XAI_BRIDGE_ERROR_PREFIX)).toBe(true);
    expect(JSON.parse(error.message.slice(XAI_BRIDGE_ERROR_PREFIX.length))).toEqual({
      code: "storage-unavailable",
      message: "English text",
      detail: "d",
    });
    const unexpected = await rejection(bridge.clearKey());
    expect(unexpected.message).toContain('"code":"unknown"');
  });

  it("forwards only well-formed stream events and unsubscribes", () => {
    const fake = fakeIpc({});
    const bridge = createViscosityXaiPreloadBridge(fake.ipc);
    const received: XaiStreamEvent[] = [];
    const unsubscribe = bridge.onEvent((event) => received.push(event));
    fake.emit({ requestId: "r", type: "delta", text: "a" });
    fake.emit({ requestId: "r", type: "delta" });
    fake.emit({ type: "done", text: "x" });
    fake.emit({ requestId: "r", type: "error", message: "m", code: "auth" });
    fake.emit("junk");
    expect(received).toEqual([
      { requestId: "r", type: "delta", text: "a" },
      { requestId: "r", type: "error", message: "m", code: "auth" },
    ]);
    unsubscribe();
    expect(fake.handlers.size).toBe(0);
  });
});
