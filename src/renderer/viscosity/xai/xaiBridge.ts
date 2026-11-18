/**
 * ViscosityCode: renderer access to the xAI client (`window.viscosityHost.xai`).
 *
 * The desktop preload exposes the bridge; every other client (web, PWA,
 * extension, tests) gets an `available: false` stand-in. Callers always go
 * through `getXaiBridge()`, which turns encoded main-process failures into
 * `XaiBridgeError`s with localized messages and localizes stream errors.
 */
import {
  XAI_BRIDGE_ERROR_PREFIX,
  type ViscosityXaiBridge,
  type XaiErrorCode,
  type XaiStreamEvent,
} from "@/shared/viscosity/xaiContract";
import { describeXaiError } from "./xaiErrorText";

declare global {
  interface Window {
    /** ViscosityCode: fork-owned preload namespace (desktop app only). */
    viscosityHost?: { xai?: ViscosityXaiBridge };
  }
}

const KNOWN_CODES: ReadonlySet<string> = new Set<XaiErrorCode>([
  "unavailable",
  "no-key",
  "invalid-key-format",
  "storage-unavailable",
  "storage-failed",
  "region-model",
  "invalid-request",
  "busy",
  "auth",
  "forbidden",
  "not-found",
  "bad-request",
  "rate-limited",
  "server",
  "timeout",
  "network",
  "stream",
  "response-failed",
  "cancelled",
  "unknown",
]);

function asCode(value: unknown): XaiErrorCode {
  return typeof value === "string" && KNOWN_CODES.has(value) ? (value as XaiErrorCode) : "unknown";
}

export class XaiBridgeError extends Error {
  readonly code: XaiErrorCode;
  readonly detail: string | undefined;
  readonly status: number | undefined;

  constructor(code: XaiErrorCode, options: { detail?: string; status?: number } = {}) {
    super(describeXaiError(code, options.detail));
    this.name = "XaiBridgeError";
    this.code = code;
    this.detail = options.detail;
    this.status = options.status;
  }
}

/** Decode a rejection from the preload bridge (or Electron) into an `XaiBridgeError`. */
export function toXaiBridgeError(error: unknown): XaiBridgeError {
  if (error instanceof XaiBridgeError) return error;
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const index = message.indexOf(XAI_BRIDGE_ERROR_PREFIX);
  if (index !== -1) {
    try {
      const payload = JSON.parse(message.slice(index + XAI_BRIDGE_ERROR_PREFIX.length)) as {
        code?: unknown;
        detail?: unknown;
        status?: unknown;
      };
      return new XaiBridgeError(asCode(payload.code), {
        ...(typeof payload.detail === "string" ? { detail: payload.detail } : {}),
        ...(typeof payload.status === "number" ? { status: payload.status } : {}),
      });
    } catch {
      return new XaiBridgeError("unknown");
    }
  }
  // A preload without main handlers (for example a window attached to a
  // standalone server) rejects with Electron's "No handler registered".
  if (message.includes("No handler registered")) return new XaiBridgeError("unavailable");
  return new XaiBridgeError("unknown");
}

/** Replace a stream error's English text with the localized one (keeps code/detail). */
export function localizeXaiStreamEvent(event: XaiStreamEvent): XaiStreamEvent {
  if (event.type !== "error") return event;
  const code = asCode(event.code);
  return { ...event, code, message: describeXaiError(code, event.detail) };
}

function unavailable(): Promise<never> {
  return Promise.reject(new XaiBridgeError("unavailable"));
}

const UNAVAILABLE_BRIDGE: ViscosityXaiBridge = {
  available: false,
  keyStatus: () => Promise.resolve({ configured: false, source: "none" }),
  setKey: unavailable,
  clearKey: unavailable,
  respond: unavailable,
  cancel: () => Promise.resolve(),
  generateImage: unavailable,
  onEvent: () => () => undefined,
};

function readRawBridge(): ViscosityXaiBridge | undefined {
  if (typeof window === "undefined") return undefined;
  const bridge = window.viscosityHost?.xai;
  return bridge?.available === true ? bridge : undefined;
}

function wrap(raw: ViscosityXaiBridge): ViscosityXaiBridge {
  const guard = async <T>(run: () => Promise<T>): Promise<T> => {
    try {
      return await run();
    } catch (error) {
      throw toXaiBridgeError(error);
    }
  };
  return {
    available: true,
    keyStatus: () => guard(() => raw.keyStatus()),
    setKey: (key) => guard(() => raw.setKey(key)),
    clearKey: () => guard(() => raw.clearKey()),
    respond: (request) => guard(() => raw.respond(request)),
    cancel: (requestId) => guard(() => raw.cancel(requestId)),
    generateImage: (request) => guard(() => raw.generateImage(request)),
    onEvent: (listener) => raw.onEvent((event) => listener(localizeXaiStreamEvent(event))),
  };
}

let cached: { raw: ViscosityXaiBridge; wrapped: ViscosityXaiBridge } | undefined;

/** The xAI bridge for this window; `available: false` outside the desktop app. */
export function getXaiBridge(): ViscosityXaiBridge {
  const raw = readRawBridge();
  if (!raw) return UNAVAILABLE_BRIDGE;
  if (cached?.raw !== raw) cached = { raw, wrapped: wrap(raw) };
  return cached.wrapped;
}

export function isXaiBridgeAvailable(): boolean {
  return readRawBridge() !== undefined;
}
