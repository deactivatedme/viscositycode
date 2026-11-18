/**
 * ViscosityCode: the `window.viscosityHost.xai` bridge built in the preload.
 *
 * Pure (type-only Electron import) so the sandboxed preload bundle stays
 * small. Main replies with `XaiIpcResult` envelopes; failures become
 * rejections whose message encodes the error code for the renderer accessor.
 * Stream events are shape-checked before they reach page code.
 */
import type { IpcRenderer, IpcRendererEvent } from "electron";
import {
  XAI_IPC,
  type ViscosityXaiBridge,
  type XaiImageResult,
  type XaiKeyStatus,
  type XaiStreamEvent,
} from "@/shared/viscosity/xaiContract";
import { encodeXaiBridgeErrorMessage, isXaiIpcResult } from "./xaiIpcEnvelope";

export type XaiPreloadIpc = Pick<IpcRenderer, "invoke" | "on" | "removeListener">;

export function isXaiStreamEvent(value: unknown): value is XaiStreamEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Record<string, unknown>;
  if (typeof event.requestId !== "string") return false;
  if (event.type === "delta" || event.type === "done") return typeof event.text === "string";
  return event.type === "error" && typeof event.message === "string";
}

export function createViscosityXaiPreloadBridge(ipc: XaiPreloadIpc): ViscosityXaiBridge {
  async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
    const result: unknown = await ipc.invoke(channel, ...args);
    if (!isXaiIpcResult(result)) {
      throw new Error(
        encodeXaiBridgeErrorMessage({
          code: "unknown",
          message: "Unexpected reply from the xAI service.",
        }),
      );
    }
    if (!result.ok) throw new Error(encodeXaiBridgeErrorMessage(result.error));
    return result.value as T;
  }

  return {
    available: true,
    keyStatus: () => call<XaiKeyStatus>(XAI_IPC.keyStatus),
    setKey: (key) => call<XaiKeyStatus>(XAI_IPC.setKey, key),
    clearKey: () => call<XaiKeyStatus>(XAI_IPC.clearKey),
    async respond(request) {
      await call<null>(XAI_IPC.respond, request);
    },
    async cancel(requestId) {
      await call<null>(XAI_IPC.cancel, requestId);
    },
    generateImage: (request) => call<XaiImageResult>(XAI_IPC.generateImage, request),
    onEvent(listener) {
      const handler = (_event: IpcRendererEvent, payload: unknown) => {
        if (isXaiStreamEvent(payload)) listener(payload);
      };
      ipc.on(XAI_IPC.event, handler);
      return () => {
        ipc.removeListener(XAI_IPC.event, handler);
      };
    },
  };
}
