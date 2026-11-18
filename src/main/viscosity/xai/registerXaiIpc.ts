/**
 * ViscosityCode: Electron wiring for the xAI client (ARCHITECTURE_NOTES §8.8).
 *
 * Registers the fork-owned `viscosity:xai:*` channels (not part of the
 * upstream IPC procedure map). Requests run here, in the main process, so the
 * API key never reaches page code. Only a window's main frame may call them.
 */
import { app, ipcMain, net, safeStorage, type IpcMainInvokeEvent } from "electron";
import { XAI_IPC } from "@/shared/viscosity/xaiContract";
import { safeStorageHealth } from "../../safeStorageHealth";
import { createXaiClient } from "./xaiClient";
import {
  createXaiIpcHandlers,
  isXaiMainFrameSender,
  type XaiIpcHandlers,
  type XaiIpcSender,
} from "./xaiIpc";
import { xaiFail, type XaiIpcResult } from "./xaiIpcEnvelope";
import { createNodeXaiKeyFs } from "./xaiKeyFs";
import { XAI_KEY_ENV_VAR, createXaiKeyStore } from "./xaiKeyStore";

let handlers: XaiIpcHandlers | undefined;

function refused<T>(): XaiIpcResult<T> {
  return xaiFail({ code: "unavailable", message: "The xAI client only serves app windows." });
}

function asSender(event: IpcMainInvokeEvent): XaiIpcSender {
  const contents = event.sender;
  return {
    id: contents.id,
    send: (channel, payload) => contents.send(channel, payload),
    isDestroyed: () => contents.isDestroyed(),
    once: (name, listener) => {
      contents.once(name, listener);
    },
    // Same lifecycle rule as the remote HTTP bridge: a reload, main-frame
    // navigation or renderer crash ends the page that owns the requests.
    onPageReset: (listener) => {
      contents.on("render-process-gone", listener);
      contents.on("did-start-navigation", (details) => {
        if (details.isMainFrame && !details.isSameDocument) listener();
      });
    },
  };
}

/** Idempotent: registers the handlers once per process. */
export function registerViscosityXaiIpc(): void {
  if (handlers) return;
  const keyStore = createXaiKeyStore({
    readEnv: () => process.env[XAI_KEY_ENV_VAR],
    userDataDir: () => app.getPath("userData"),
    encryptionAvailable: () => safeStorageHealth().kind === "healthy",
    encryptString: (plain) => safeStorage.encryptString(plain),
    decryptString: (cipher) => safeStorage.decryptString(cipher),
    fs: createNodeXaiKeyFs(),
  });
  const client = createXaiClient({
    fetch: (url, init) => net.fetch(url, init),
    resolveKey: () => keyStore.resolveKey(),
  });
  const active = createXaiIpcHandlers({ keyStore, client });
  handlers = active;

  ipcMain.handle(XAI_IPC.keyStatus, (event) =>
    isXaiMainFrameSender(event) ? active.keyStatus() : refused(),
  );
  ipcMain.handle(XAI_IPC.setKey, (event, key: unknown) =>
    isXaiMainFrameSender(event) ? active.setKey(key) : refused(),
  );
  ipcMain.handle(XAI_IPC.clearKey, (event) =>
    isXaiMainFrameSender(event) ? active.clearKey() : refused(),
  );
  ipcMain.handle(XAI_IPC.respond, (event, request: unknown) =>
    isXaiMainFrameSender(event) ? active.respond(asSender(event), request) : refused(),
  );
  ipcMain.handle(XAI_IPC.cancel, (event, requestId: unknown) =>
    isXaiMainFrameSender(event) ? active.cancel(asSender(event), requestId) : refused(),
  );
  ipcMain.handle(XAI_IPC.generateImage, (event, request: unknown) =>
    isXaiMainFrameSender(event) ? active.generateImage(asSender(event), request) : refused(),
  );
  app.on("before-quit", () => active.cancelAll());
}
