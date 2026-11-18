/**
 * ViscosityCode: localized text for xAI failures. Main sends a machine code
 * (`XaiErrorCode`) plus English; the renderer shows these Lingui strings.
 */
import { msg } from "@lingui/core/macro";
import type { MessageDescriptor } from "@lingui/core";
import { i18n } from "@/renderer/i18n/i18n";
import { XAI_US_TEXT_MODELS, type XaiErrorCode } from "@/shared/viscosity/xaiContract";

const US_MODELS = XAI_US_TEXT_MODELS.join(", ");

function descriptor(code: XaiErrorCode): MessageDescriptor {
  switch (code) {
    case "unavailable":
      return msg`Grok over the xAI API is only available in the desktop app.`;
    case "no-key":
      return msg`Add an xAI API key in Settings, or set the XAI_API_KEY environment variable.`;
    case "invalid-key-format":
      return msg`That doesn't look like an xAI API key. Paste the full key from console.x.ai.`;
    case "storage-unavailable":
      return msg`This system's secure credential storage isn't available, so the key can't be saved. Set the XAI_API_KEY environment variable instead.`;
    case "storage-failed":
      return msg`The xAI API key couldn't be saved or removed on this device.`;
    case "region-model":
      return msg`The US endpoint only serves ${US_MODELS}. Pick one of those models or switch the region to Global.`;
    case "invalid-request":
      return msg`The request to xAI was not valid.`;
    case "busy":
      return msg`Too many xAI requests are running at once. Wait for one to finish.`;
    case "auth":
      return msg`xAI didn't accept the API key. Check the key in Settings or XAI_API_KEY.`;
    case "forbidden":
      return msg`This xAI API key isn't allowed to use that model or feature.`;
    case "not-found":
      return msg`xAI couldn't find that model on this endpoint.`;
    case "bad-request":
      return msg`xAI rejected the request.`;
    case "rate-limited":
      return msg`xAI rate limit reached. Try again in a moment.`;
    case "server":
      return msg`xAI is having trouble right now. Try again shortly.`;
    case "timeout":
      return msg`xAI didn't respond in time.`;
    case "network":
      return msg`Couldn't reach the xAI API. Check your internet connection.`;
    case "stream":
      return msg`The xAI response ended unexpectedly.`;
    case "response-failed":
      return msg`xAI couldn't finish the response.`;
    case "cancelled":
      return msg`Stopped.`;
    case "unknown":
      return msg`Something went wrong talking to xAI.`;
  }
}

/** Codes whose API-provided detail helps the user act (e.g. a rejected parameter). */
const DETAIL_CODES = new Set<XaiErrorCode>([
  "bad-request",
  "response-failed",
  "forbidden",
  "not-found",
  "stream",
  "network",
]);

export function describeXaiError(code: XaiErrorCode, detail?: string): string {
  const base = i18n._(descriptor(code));
  if (!detail || !DETAIL_CODES.has(code)) return base;
  return i18n._(msg`${base} (${detail})`);
}
