/**
 * ViscosityCode: seats xAI (Grok API) brains at Roundtables and Bots by
 * registering the driver factory with the engine's public API.
 */
import { registerParticipantDriverFactory } from "@/renderer/viscosity/roundtable/api";
import { createXaiParticipantDriver } from "./XaiParticipantDriver";

let registered = false;

/** Idempotent; call once during renderer startup (before sessions resume). */
export function registerXaiParticipantDriver(): void {
  if (registered) return;
  registered = true;
  registerParticipantDriverFactory("xai", createXaiParticipantDriver);
}
