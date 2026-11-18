/**
 * ViscosityCode: request handling behind the fork-owned `viscosity:xai:*`
 * channels. Free of Electron imports so it can be tested with fakes; the
 * Electron wiring lives in `registerXaiIpc.ts`.
 *
 * - Requests are tracked per sender (webContents) and requestId, capped per
 *   sender, cancelled on `cancel` and when the sender is destroyed.
 * - Stream deltas are coalesced (one IPC message per ~40 ms, not per token).
 * - A cancelled request emits nothing: the renderer already settled it.
 */
import { z } from "zod";
import {
  XAI_IPC,
  type XaiImageResult,
  type XaiKeyStatus,
  type XaiStreamEvent,
} from "@/shared/viscosity/xaiContract";
import type { XaiClient } from "./xaiClient";
import { englishXaiMessage, toXaiFailure } from "./xaiErrors";
import { xaiFail, xaiOk, type XaiIpcResult } from "./xaiIpcEnvelope";
import type { XaiKeyStore } from "./xaiKeyStore";

export const MAX_XAI_INPUT_MESSAGES = 1_000;
export const MAX_XAI_INPUT_CHARS = 2_000_000;
export const MAX_XAI_INSTRUCTIONS_CHARS = 100_000;
export const DEFAULT_MAX_CONCURRENT_XAI_REQUESTS = 8;
export const DEFAULT_XAI_DELTA_COALESCE_MS = 40;

const requestIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_.:-]+$/u);

export const xaiResponseRequestSchema = z
  .object({
    requestId: requestIdSchema,
    model: z.string().min(1).max(64),
    region: z.enum(["global", "us"]),
    input: z
      .array(
        z.object({
          role: z.enum(["system", "user", "assistant"]),
          content: z.string(),
        }),
      )
      .min(1)
      .max(MAX_XAI_INPUT_MESSAGES),
    instructions: z.string().max(MAX_XAI_INSTRUCTIONS_CHARS).optional(),
    tools: z.object({ webSearch: z.boolean(), xSearch: z.boolean() }),
  })
  .refine(
    (request) =>
      request.input.reduce((total, message) => total + message.content.length, 0) <=
      MAX_XAI_INPUT_CHARS,
  );

export const xaiImageRequestSchema = z.object({
  requestId: requestIdSchema,
  prompt: z.string().min(1).max(8_000),
});

/** The parts of a webContents the handlers use. */
export interface XaiIpcSender {
  readonly id: number;
  send(channel: string, payload: XaiStreamEvent): void;
  isDestroyed(): boolean;
  once(event: "destroyed", listener: () => void): void;
  /**
   * The page that made the requests is gone while the webContents lives on
   * (main-frame reload or navigation, renderer crash). Like the remote HTTP
   * bridge, its requests are aborted: nobody is left to read or stop them.
   */
  onPageReset?(listener: () => void): void;
}

export interface XaiIpcHandlerDeps {
  keyStore: XaiKeyStore;
  client: XaiClient;
  coalesceMs?: number;
  maxConcurrentPerSender?: number;
}

export interface XaiIpcHandlers {
  keyStatus(): XaiIpcResult<XaiKeyStatus>;
  setKey(raw: unknown): XaiIpcResult<XaiKeyStatus>;
  clearKey(): XaiIpcResult<XaiKeyStatus>;
  respond(sender: XaiIpcSender, raw: unknown): XaiIpcResult<null>;
  cancel(sender: XaiIpcSender, raw: unknown): XaiIpcResult<null>;
  generateImage(sender: XaiIpcSender, raw: unknown): Promise<XaiIpcResult<XaiImageResult>>;
  /** Abort everything (app quit). */
  cancelAll(): void;
  /** Requests in flight for one sender (tests and diagnostics). */
  activeCount(senderId: number): number;
}

/** Main frame only: subframes (embedded content) never reach the xAI client. */
export function isXaiMainFrameSender(event: {
  senderFrame: { routingId: number; processId: number } | null;
  sender: { mainFrame: { routingId: number; processId: number } | null };
}): boolean {
  const frame = event.senderFrame;
  const main = event.sender.mainFrame;
  return (
    frame !== null &&
    main !== null &&
    frame.routingId === main.routingId &&
    frame.processId === main.processId
  );
}

function invalidRequest<T>(): XaiIpcResult<T> {
  return xaiFail({ code: "invalid-request", message: englishXaiMessage("invalid-request") });
}

function busy<T>(): XaiIpcResult<T> {
  return xaiFail({ code: "busy", message: englishXaiMessage("busy") });
}

/** Buffers deltas and sends at most one per `intervalMs`. */
function createDeltaCoalescer(send: (text: string) => void, intervalMs: number) {
  let pending = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    if (!pending) return;
    const text = pending;
    pending = "";
    send(text);
  };
  return {
    push(text: string) {
      pending += text;
      if (intervalMs <= 0) {
        flush();
        return;
      }
      timer ??= setTimeout(flush, intervalMs);
    },
    flush,
    discard() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      pending = "";
    },
  };
}

export function createXaiIpcHandlers(deps: XaiIpcHandlerDeps): XaiIpcHandlers {
  const coalesceMs = deps.coalesceMs ?? DEFAULT_XAI_DELTA_COALESCE_MS;
  const maxConcurrent = deps.maxConcurrentPerSender ?? DEFAULT_MAX_CONCURRENT_XAI_REQUESTS;
  /** senderId → requestId → controller */
  const active = new Map<number, Map<string, AbortController>>();
  const watchedSenders = new Set<number>();

  function abortSender(senderId: number): void {
    const requests = active.get(senderId);
    active.delete(senderId);
    for (const controller of requests?.values() ?? []) controller.abort();
  }

  function watchSender(sender: XaiIpcSender): void {
    if (watchedSenders.has(sender.id)) return;
    watchedSenders.add(sender.id);
    sender.once("destroyed", () => {
      watchedSenders.delete(sender.id);
      abortSender(sender.id);
    });
    // A reloaded or crashed page can no longer read or cancel its streams;
    // without this they would bill the user's xAI account for up to the
    // total timeout and hold the window's concurrency slots.
    sender.onPageReset?.(() => abortSender(sender.id));
  }

  function track(sender: XaiIpcSender, requestId: string): AbortController | undefined {
    let requests = active.get(sender.id);
    if (requests?.has(requestId) || (requests?.size ?? 0) >= maxConcurrent) return undefined;
    if (!requests) {
      requests = new Map();
      active.set(sender.id, requests);
    }
    const controller = new AbortController();
    requests.set(requestId, controller);
    watchSender(sender);
    return controller;
  }

  function untrack(senderId: number, requestId: string, controller: AbortController): void {
    const requests = active.get(senderId);
    if (requests?.get(requestId) !== controller) return;
    requests.delete(requestId);
    if (requests.size === 0) active.delete(senderId);
  }

  function emit(sender: XaiIpcSender, event: XaiStreamEvent): void {
    if (!sender.isDestroyed()) sender.send(XAI_IPC.event, event);
  }

  function keyResult(read: () => XaiKeyStatus): XaiIpcResult<XaiKeyStatus> {
    try {
      return xaiOk(read());
    } catch (error) {
      return xaiFail(toXaiFailure(error));
    }
  }

  return {
    keyStatus: () => keyResult(() => deps.keyStore.keyStatus()),
    setKey: (raw) => keyResult(() => deps.keyStore.setKey(raw)),
    clearKey: () => keyResult(() => deps.keyStore.clearKey()),

    respond(sender, raw) {
      const parsed = xaiResponseRequestSchema.safeParse(raw);
      if (!parsed.success) return invalidRequest();
      const request = parsed.data;
      const controller = track(sender, request.requestId);
      if (!controller) return busy();
      const { requestId } = request;
      const coalescer = createDeltaCoalescer(
        (text) => emit(sender, { requestId, type: "delta", text }),
        coalesceMs,
      );
      void deps.client
        .streamResponse(
          {
            requestId,
            model: request.model,
            region: request.region,
            input: request.input,
            tools: request.tools,
            ...(request.instructions !== undefined ? { instructions: request.instructions } : {}),
          },
          { signal: controller.signal, onDelta: coalescer.push },
        )
        .then(
          (outcome) => {
            coalescer.flush();
            emit(sender, {
              requestId,
              type: "done",
              text: outcome.text,
              ...(outcome.usage ? { usage: outcome.usage } : {}),
            });
          },
          (error: unknown) => {
            const failure = toXaiFailure(error);
            if (failure.code === "cancelled" || controller.signal.aborted) {
              coalescer.discard();
              return;
            }
            coalescer.flush();
            emit(sender, {
              requestId,
              type: "error",
              message: failure.message,
              code: failure.code,
              ...(failure.status !== undefined ? { status: failure.status } : {}),
              ...(failure.detail ? { detail: failure.detail } : {}),
            });
          },
        )
        .finally(() => untrack(sender.id, requestId, controller));
      return xaiOk(null);
    },

    cancel(sender, raw) {
      const parsed = requestIdSchema.safeParse(raw);
      if (!parsed.success) return invalidRequest();
      active.get(sender.id)?.get(parsed.data)?.abort();
      return xaiOk(null);
    },

    async generateImage(sender, raw) {
      const parsed = xaiImageRequestSchema.safeParse(raw);
      if (!parsed.success) return invalidRequest();
      const controller = track(sender, parsed.data.requestId);
      if (!controller) return busy();
      try {
        return xaiOk(await deps.client.generateImage(parsed.data, { signal: controller.signal }));
      } catch (error) {
        return xaiFail(toXaiFailure(error));
      } finally {
        untrack(sender.id, parsed.data.requestId, controller);
      }
    },

    cancelAll() {
      for (const requests of active.values()) {
        for (const controller of requests.values()) controller.abort();
      }
      active.clear();
    },

    activeCount: (senderId) => active.get(senderId)?.size ?? 0,
  };
}
