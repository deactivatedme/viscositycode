/**
 * ViscosityCode: Smart start candidates (fork of Poracode).
 *
 * Every account the new-thread composer could start on right now, with the
 * model it would use and how much usage it has left. Readiness mirrors the
 * Roundtable/PR Ask filter (installed, not disabled, the presentation is
 * supported, the login is not missing, at least one model), decided from
 * capabilities only. Profile accounts ("<driver>:<id>") are their own agent
 * statuses, so pooled accounts are candidates one by one; an enabled pool's
 * "switch at" threshold applies to its members' headroom.
 */
import {
  DEFAULT_SWITCH_AT_PERCENT,
  isPoolMemberExcluded,
  memberAvailability,
  poolForAgentKind,
  type AccountPools,
} from "@/shared/accountPools";
import { authStateForPresentation } from "@/shared/agentSelection";
import {
  baseAgentKind,
  type AgentInstanceConfigMap,
  type AgentStatus,
  type ProjectDraftConfig,
  type ProviderDraftConfig,
  type ThreadPresentationMode,
  type UsageSnapshot,
} from "@/shared/contracts";
import type { ProviderModelPreference } from "@/shared/settings";
import {
  agentWithCapabilities,
  resolveProviderDraftConfig,
  resolveSavedProviderDraftConfig,
} from "@/renderer/components/thread/threadDraftViewHelpers";
import { usagePercentLeft } from "@/renderer/viscosity/accountPools/poolModel";
import { getProviderManifest } from "@/renderer/components/providers/providerManifest";
import { smartStartProviderOf, type SmartStartCandidate } from "./scoring";

export interface SmartStartCandidateInput {
  agents: readonly AgentStatus[];
  disabledAgents: readonly string[];
  /** The draft's presentation (Chat or CLI); Auto picks within it. */
  presentationMode: ThreadPresentationMode;
  lastDraftConfig: ProjectDraftConfig | undefined;
  providerConfigs: Record<string, ProviderDraftConfig>;
  providerModelPreferences: Record<string, Record<string, ProviderModelPreference>>;
  pools: AccountPools;
  instances: AgentInstanceConfigMap | undefined;
  snapshots: Readonly<Record<string, UsageSnapshot>>;
  now: number;
  /** Usage snapshot id that meters an account (`usageProviderIdForAgent`). */
  usageIdFor: (agentKind: string) => string;
  /** Model-picker order of a provider (lower first); absent keeps the input order. */
  rankOf?: (agentKind: string) => number;
}

/** True when `agent` can start a new thread in `mode` right now. */
export function isReadyForPresentation(
  agent: AgentStatus,
  mode: ThreadPresentationMode,
  disabledAgents: readonly string[],
): boolean {
  if (!agent.installed || disabledAgents.includes(agent.kind)) return false;
  const supported = agent.capabilities.presentationModes ?? [agent.capabilities.presentationMode];
  if (!supported.includes(mode)) return false;
  if (authStateForPresentation(agent, mode) === "missing") return false;
  return agentWithCapabilities(agent, mode).capabilities.models.length > 0;
}

/** The provider's saved default model for a new thread (what the picker would show). */
export function defaultModelFor(
  agent: AgentStatus,
  mode: ThreadPresentationMode,
  input: Pick<
    SmartStartCandidateInput,
    "lastDraftConfig" | "providerConfigs" | "providerModelPreferences"
  >,
): string {
  const projected = agentWithCapabilities(agent, mode);
  const saved = resolveSavedProviderDraftConfig(
    projected.kind,
    input.lastDraftConfig,
    input.providerConfigs,
    input.providerModelPreferences,
    projected.capabilities,
  );
  const draft = resolveProviderDraftConfig(projected, saved);
  const models = projected.capabilities.models;
  if (models.some((model) => model.id === draft.model)) return draft.model;
  return models[0]?.id ?? "";
}

function poolPosition(
  agentKind: string,
  pools: AccountPools,
  instances: AgentInstanceConfigMap | undefined,
): { index: number; switchAtPercent: number } {
  const pool = poolForAgentKind(pools, agentKind, instances);
  if (!pool?.enabled) return { index: Number.MAX_SAFE_INTEGER, switchAtPercent: 100 };
  return {
    index: pool.members.indexOf(agentKind),
    switchAtPercent: pool.switchAtPercent ?? DEFAULT_SWITCH_AT_PERCENT,
  };
}

function describeAccount(
  agent: AgentStatus,
  input: SmartStartCandidateInput,
): { candidate: SmartStartCandidate; poolIndex: number } {
  const { index: poolIndex, switchAtPercent } = poolPosition(
    agent.kind,
    input.pools,
    input.instances,
  );
  const usageId = input.usageIdFor(agent.kind);
  const snapshot = Object.hasOwn(input.snapshots, usageId) ? input.snapshots[usageId] : undefined;
  const percentLeft = usagePercentLeft(snapshot, input.now);
  return {
    candidate: {
      agentKind: agent.kind,
      provider: smartStartProviderOf(agent.kind),
      model: defaultModelFor(agent, input.presentationMode, input),
      presentationMode: input.presentationMode,
      availability: memberAvailability(snapshot, input.now, switchAtPercent),
      ...(percentLeft !== undefined ? { percentLeft } : {}),
    },
    poolIndex,
  };
}

/**
 * Any account described the way a candidate is, without the readiness check:
 * names the owner's own pick (for example one that still needs a sign-in).
 * `model` is "" when the account has no model for the presentation.
 */
export function describeSmartStartAccount(
  agent: AgentStatus,
  input: SmartStartCandidateInput,
): SmartStartCandidate {
  return describeAccount(agent, input).candidate;
}

/**
 * Ready accounts as Smart start candidates, in the model picker's provider
 * order; within a provider, an enabled pool's member order comes first.
 */
export function buildSmartStartCandidates(input: SmartStartCandidateInput): SmartStartCandidate[] {
  const seen = new Set<string>();
  const entries: Array<{ candidate: SmartStartCandidate; rank: number; poolIndex: number }> = [];
  for (const agent of input.agents) {
    // First row per kind wins (native before WSL), as everywhere else.
    if (seen.has(agent.kind)) continue;
    seen.add(agent.kind);
    if (getProviderManifest(agent.kind)?.manualSelectionOnly) continue;
    if (!isReadyForPresentation(agent, input.presentationMode, input.disabledAgents)) continue;
    // An account the owner left out of an enabled pool never takes new threads.
    const driver = baseAgentKind(agent.kind);
    const pool = Object.hasOwn(input.pools, driver) ? input.pools[driver] : undefined;
    if (pool?.enabled && isPoolMemberExcluded(pool, agent.kind)) continue;
    const { candidate, poolIndex } = describeAccount(agent, input);
    if (!candidate.model) continue;
    entries.push({ candidate, rank: input.rankOf?.(agent.kind) ?? 0, poolIndex });
  }
  // A provider's accounts stay together, at the position of its first account.
  const providerIndex = new Map<string, number>();
  entries.forEach((entry, index) => {
    if (!providerIndex.has(entry.candidate.provider)) {
      providerIndex.set(entry.candidate.provider, index);
    }
  });
  return entries
    .map((entry, index) => ({
      ...entry,
      index,
      group: providerIndex.get(entry.candidate.provider) ?? index,
    }))
    .toSorted(
      (left, right) =>
        left.rank - right.rank ||
        left.group - right.group ||
        left.poolIndex - right.poolIndex ||
        left.index - right.index,
    )
    .map((entry) => entry.candidate);
}
