/**
 * ViscosityCode Roundtable engine: participant driver factories, keyed by
 * brain kind. The engine's runtime registers "agent" (thread participants)
 * and "xai" (the main-process Grok client, `viscosity/xai`) before any
 * session resumes. The orchestrator never asks which provider is behind a
 * driver.
 */
import { msg } from "@lingui/core/macro";
import { i18n } from "@/renderer/i18n/i18n";
import type { ParticipantDriverFactory } from "../api";
import type {
  ParticipantBrain,
  ParticipantDriver,
  ParticipantProfile,
  RoundtableSession,
} from "../types";

const factories = new Map<ParticipantBrain["kind"], ParticipantDriverFactory>();

export function registerDriverFactory(
  kind: ParticipantBrain["kind"],
  factory: ParticipantDriverFactory,
): () => void {
  factories.set(kind, factory);
  return () => {
    if (factories.get(kind) === factory) factories.delete(kind);
  };
}

export function hasDriverFactory(kind: ParticipantBrain["kind"]): boolean {
  return factories.has(kind);
}

export function createRegisteredDriver(
  profile: ParticipantProfile,
  session: RoundtableSession,
): ParticipantDriver {
  const factory = factories.get(profile.brain.kind);
  if (!factory) {
    throw new Error(i18n._(msg`This kind of participant is not available in this window.`));
  }
  return factory(profile, session);
}
