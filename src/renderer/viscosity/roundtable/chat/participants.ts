/**
 * ViscosityCode: seat candidates for the in-chat Roundtable entry points.
 *
 * A candidate is a ready model (any installed, signed-in provider the
 * engine reports through `useReadyAgentBrains`). Everything here
 * is provider-agnostic: presentation is chosen from the brain's declared
 * `presentationModes`, never from its kind.
 */
import type { ReadyAgentBrain } from "../api";
import type { ParticipantProfile, RoundtablePattern } from "../types";
import { rolesForPattern } from "./patterns";

export interface SeatCandidate {
  kind: "model";
  /** Stable participant id: one seat per provider + model. */
  id: string;
  /** `<provider> · <model>`, also the `@mention` text. */
  label: string;
  providerLabel: string;
  modelLabel: string;
  agentKind: string;
  agentInstanceId?: string;
  modelId: string;
  presentationMode: "gui" | "terminal";
}

export function modelParticipantId(agentKind: string, modelId: string): string {
  return `model:${agentKind}:${modelId}`;
}

/** Chat presentation when the provider offers it (turn results are read from the transcript). */
export function preferredPresentationMode(brain: ReadyAgentBrain): "gui" | "terminal" {
  if (brain.presentationModes.includes("gui")) return "gui";
  return brain.presentationModes[0] ?? "gui";
}

/** Default model first, then the provider's own order. */
function orderedModels(brain: ReadyAgentBrain): ReadyAgentBrain["models"] {
  const preferred = brain.models.find((model) => model.id === brain.defaultModel);
  return preferred
    ? [preferred, ...brain.models.filter((model) => model.id !== preferred.id)]
    : [...brain.models];
}

export function modelSeatCandidates(
  brains: readonly ReadyAgentBrain[],
  options: { maxModelsPerBrain?: number } = {},
): SeatCandidate[] {
  const limit = options.maxModelsPerBrain ?? Number.POSITIVE_INFINITY;
  return brains.flatMap((brain) =>
    orderedModels(brain)
      .slice(0, limit)
      .map((model): SeatCandidate => ({
        kind: "model",
        id: modelParticipantId(brain.agentKind, model.id),
        label: `${brain.label} · ${model.label}`,
        providerLabel: brain.label,
        modelLabel: model.label,
        agentKind: brain.agentKind,
        ...(brain.agentInstanceId ? { agentInstanceId: brain.agentInstanceId } : {}),
        modelId: model.id,
        presentationMode: preferredPresentationMode(brain),
      })),
  );
}

export function candidateToProfile(
  candidate: SeatCandidate,
  role: ParticipantProfile["role"],
): ParticipantProfile {
  return {
    id: candidate.id,
    label: candidate.label,
    role,
    brain: {
      kind: "agent",
      agentKind: candidate.agentKind,
      ...(candidate.agentInstanceId ? { agentInstanceId: candidate.agentInstanceId } : {}),
      model: candidate.modelId,
      presentationMode: candidate.presentationMode,
    },
  };
}

/**
 * Profiles in seating order with the pattern's roles. With `originSeat`, seat
 * 0 is taken by someone else (the chat a Roundtable starts from, or the
 * new-thread composer's own model), so the candidates take the roles from
 * seat 1 on.
 */
export function seatProfiles(
  pattern: RoundtablePattern,
  candidates: readonly SeatCandidate[],
  options: { originSeat?: boolean } = {},
): ParticipantProfile[] {
  const offset = options.originSeat ? 1 : 0;
  const roles = rolesForPattern(pattern, candidates.length + offset);
  return candidates.map((candidate, index) =>
    candidateToProfile(candidate, roles[index + offset] ?? "member"),
  );
}

/** What seat 0 needs from the chat a Roundtable starts from. */
export interface OriginChat {
  id: string;
  title?: string | undefined;
  agentKind: string;
  model: string;
  presentationMode: "gui" | "terminal";
}

export function originParticipantId(threadId: string): string {
  return `origin:${threadId}`;
}

/**
 * Seat 0 for a Roundtable started from an existing chat. The engine binds
 * `originThreadId` to the first participant (no new thread), so that
 * participant must be the chat's own agent and model. Its label reuses the
 * ready-model label when the chat's model is listed, else the provider label.
 */
export function originParticipantProfile(
  origin: OriginChat,
  candidates: readonly SeatCandidate[],
  role: ParticipantProfile["role"],
): ParticipantProfile {
  const sameProvider = candidates.filter((candidate) => candidate.agentKind === origin.agentKind);
  const exact = sameProvider.find((candidate) => candidate.modelId === origin.model);
  const providerLabel = sameProvider[0]?.providerLabel;
  const label =
    exact?.label ??
    (providerLabel
      ? `${providerLabel} · ${origin.model}`
      : origin.title?.trim() || origin.agentKind);
  return {
    id: originParticipantId(origin.id),
    label,
    role,
    brain: {
      kind: "agent",
      agentKind: origin.agentKind,
      model: origin.model,
      presentationMode: origin.presentationMode,
    },
  };
}

/** Origin chat in seat 0, then the invited candidates, with the pattern's roles. */
export function invitedSeatProfiles(
  pattern: RoundtablePattern,
  origin: OriginChat,
  candidates: readonly SeatCandidate[],
  invited: readonly SeatCandidate[],
): ParticipantProfile[] {
  const roles = rolesForPattern(pattern, invited.length + 1);
  return [
    originParticipantProfile(origin, candidates, roles[0] ?? "member"),
    ...seatProfiles(pattern, invited, { originSeat: true }),
  ];
}
