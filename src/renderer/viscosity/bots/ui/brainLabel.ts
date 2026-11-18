/**
 * ViscosityCode Bots UI: a brain's display label ("Codex · GPT-5", "Grok (xAI
 * API) · grok-4.7"). Agent labels come from the engine's ready-agent list or
 * the provider manifest; nothing here names a provider.
 */
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { getProviderManifest } from "@/renderer/components/providers/providerManifest";
import { type ReadyAgentBrain, useReadyAgentBrains } from "../../roundtable/api";
import type { ParticipantBrain } from "../../roundtable/types";

export const XAI_BRAIN_LABEL = msg({
  message: "Grok (xAI API)",
  comment: "Bot brain: a Grok model reached directly over the xAI API with the user's key",
});

export function brainLabel(
  brain: ParticipantBrain,
  readyAgents: readonly ReadyAgentBrain[],
  translate: (descriptor: typeof XAI_BRAIN_LABEL) => string,
): string {
  if (brain.kind === "xai") return `${translate(XAI_BRAIN_LABEL)} · ${brain.model}`;
  const ready = readyAgents.find((agent) => agent.agentKind === brain.agentKind);
  const manifest = getProviderManifest(brain.agentKind);
  const providerLabel = ready?.label ?? (manifest ? translate(manifest.label) : brain.agentKind);
  const modelLabel = ready?.models.find((model) => model.id === brain.model)?.label ?? brain.model;
  return `${providerLabel} · ${modelLabel}`;
}

export function useBrainLabel(brain: ParticipantBrain, projectId: string | undefined): string {
  const { i18n } = useLingui();
  const readyAgents = useReadyAgentBrains(projectId);
  return brainLabel(brain, readyAgents, (descriptor) => i18n._(descriptor));
}
