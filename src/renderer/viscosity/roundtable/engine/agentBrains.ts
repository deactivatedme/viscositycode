/**
 * ViscosityCode Roundtable engine: which installed agents can take a seat
 * (provider-agnostic readiness) and the thread config a seat launches with.
 *
 * Readiness mirrors the PR Ask filter: installed, not disabled, the
 * presentation is supported, the login is not missing, and at least one model
 * is listed. Decisions use capabilities only, never a provider name. A
 * terminal presentation that needs focus before input is left out, because
 * the Roundtable sends follow-ups to background threads.
 */
import { authStateForPresentation } from "@/shared/agentSelection";
import {
  type AgentStatus,
  type McpServer,
  type ProjectDraftConfig,
  type ProviderDraftConfig,
  resolveComposerMcpScope,
  type ThreadConfig,
  type ThreadPresentationMode,
} from "@/shared/contracts";
import type { ProviderModelPreference } from "@/shared/settings";
import type { SavedPlaybook } from "@/shared/viscosity/playbook";
import { applyPlaybook } from "@/renderer/viscosity/playbooks/applyPlaybook";
import {
  getProviderManifest,
  getProviderModelPickerRank,
} from "@/renderer/components/providers/providerManifest";
import {
  agentWithCapabilities,
  launchSelectionFields,
  resolveProviderDraftConfig,
  resolveSavedProviderDraftConfig,
} from "@/renderer/components/thread/threadDraftViewHelpers";
import { i18n } from "@/renderer/i18n/i18n";
import type { ReadyAgentBrain } from "../api";
import type { ParticipantBrain } from "../types";

export interface ReadyAgentBrainsInput {
  agents: readonly AgentStatus[];
  disabledAgents: readonly string[];
  lastDraftConfig: ProjectDraftConfig | undefined;
  providerConfigs: Record<string, ProviderDraftConfig>;
  providerModelPreferences: Record<string, Record<string, ProviderModelPreference>>;
}

const PRESENTATIONS: readonly ThreadPresentationMode[] = ["gui", "terminal"];

/** The presentations of `agent` a Roundtable can drive right now. */
export function readyPresentations(agent: AgentStatus): ThreadPresentationMode[] {
  const supported = agent.capabilities.presentationModes ?? [agent.capabilities.presentationMode];
  return PRESENTATIONS.filter((mode) => {
    if (!supported.includes(mode)) return false;
    if (authStateForPresentation(agent, mode) === "missing") return false;
    const projected = agentWithCapabilities(agent, mode);
    if (projected.capabilities.models.length === 0) return false;
    return !(
      mode === "terminal" && projected.capabilities.requiresTerminalFocusBeforeInput === true
    );
  });
}

function providerLabel(agent: AgentStatus): string {
  const manifest = getProviderManifest(agent.kind);
  return manifest ? i18n._(manifest.label) : agent.label;
}

/** Installed, enabled, signed-in agents with models, in the model picker's order. */
export function selectReadyAgentBrains(input: ReadyAgentBrainsInput): ReadyAgentBrain[] {
  const brains: Array<ReadyAgentBrain & { rank: number }> = [];
  for (const agent of input.agents) {
    if (!agent.installed || input.disabledAgents.includes(agent.kind)) continue;
    const presentationModes = readyPresentations(agent);
    const primary = presentationModes[0];
    if (!primary) continue;
    const projected = agentWithCapabilities(agent, primary);
    const saved = resolveSavedProviderDraftConfig(
      projected.kind,
      input.lastDraftConfig,
      input.providerConfigs,
      input.providerModelPreferences,
      projected.capabilities,
    );
    const draft = resolveProviderDraftConfig(projected, saved);
    const models = projected.capabilities.models.map((model) => ({
      id: model.id,
      label: model.label,
    }));
    const defaultModel = models.some((model) => model.id === draft.model)
      ? draft.model
      : (models[0]?.id ?? "");
    if (!defaultModel) continue;
    brains.push({
      agentKind: agent.kind,
      label: providerLabel(agent),
      models,
      defaultModel,
      presentationModes,
      rank: getProviderModelPickerRank(agent.kind),
    });
  }
  return brains
    .toSorted((left, right) => left.rank - right.rank || left.label.localeCompare(right.label))
    .map(({ rank: _rank, ...brain }) => brain);
}

/** A seat's resolved playbook and the MCP servers its names are matched against. */
export interface SeatPlaybook {
  definition: SavedPlaybook;
  /** Global and project servers, merged (`mergeMcpServers`). */
  mcpServers: readonly McpServer[];
}

/**
 * The thread config for an agent seat: the brain's model with the provider's
 * own effort/context/fast defaults for it. Mode, approval and sandbox are NOT
 * set, so the provider's defaults apply (peer output reaches these threads as
 * quoted context and must not run with elevated settings) — a playbook never
 * changes them either. With a playbook the thread is bound to its frozen
 * copy, and the MCP servers it names that are off by default are switched on
 * for this thread only (never the global flag).
 */
export function buildAgentThreadConfig(
  brain: Extract<ParticipantBrain, { kind: "agent" }>,
  agent: AgentStatus | undefined,
  playbook?: SeatPlaybook,
): ThreadConfig {
  const config = baseAgentThreadConfig(brain, agent);
  if (!playbook) return config;
  const browserAvailable =
    agent !== undefined &&
    resolveComposerMcpScope(
      agentWithCapabilities(agent, brain.presentationMode).capabilities.mcpScope,
      brain.presentationMode,
    ) !== "none";
  const { patch } = applyPlaybook(config, playbook.definition, {
    servers: playbook.mcpServers,
    browserAvailable,
  });
  return { ...config, ...patch };
}

function baseAgentThreadConfig(
  brain: Extract<ParticipantBrain, { kind: "agent" }>,
  agent: AgentStatus | undefined,
): ThreadConfig {
  if (!agent) return { model: brain.model };
  const projected = agentWithCapabilities(agent, brain.presentationMode);
  const draft = resolveProviderDraftConfig(projected, { model: brain.model });
  const fields = launchSelectionFields(draft, projected.capabilities);
  return { ...fields, model: fields.model || brain.model };
}
