/**
 * ViscosityCode: the main ⇄ preload envelope for fork-owned xAI channels.
 *
 * Main never throws for expected failures (Electron would wrap the message in
 * "Error invoking remote method …"); it returns `{ok: false, error}` and the
 * preload bridge rejects with an `XAI_BRIDGE_ERROR_PREFIX`-encoded message the
 * renderer accessor decodes and localizes. Pure module: safe in the sandboxed
 * preload bundle.
 */
import { XAI_BRIDGE_ERROR_PREFIX, type XaiErrorCode } from "@/shared/viscosity/xaiContract";

export interface XaiWireFailure {
  code: XaiErrorCode;
  message: string;
  status?: number;
  detail?: string;
}

export type XaiIpcResult<T> = { ok: true; value: T } | { ok: false; error: XaiWireFailure };

export function xaiOk<T>(value: T): XaiIpcResult<T> {
  return { ok: true, value };
}

export function xaiFail<T>(error: XaiWireFailure): XaiIpcResult<T> {
  return { ok: false, error };
}

export function isXaiIpcResult(value: unknown): value is XaiIpcResult<unknown> {
  if (!value || typeof value !== "object") return false;
  const record = value as { ok?: unknown; error?: unknown };
  if (record.ok === true) return "value" in record;
  if (record.ok !== false || !record.error || typeof record.error !== "object") return false;
  const error = record.error as { code?: unknown; message?: unknown };
  return typeof error.code === "string" && typeof error.message === "string";
}

/** The rejection message the preload bridge throws for a failed envelope. */
export function encodeXaiBridgeErrorMessage(failure: XaiWireFailure): string {
  return `${XAI_BRIDGE_ERROR_PREFIX}${JSON.stringify({
    code: failure.code,
    message: failure.message,
    ...(failure.status !== undefined ? { status: failure.status } : {}),
    ...(failure.detail ? { detail: failure.detail } : {}),
  })}`;
}
