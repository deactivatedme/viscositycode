/**
 * ViscosityCode: account pools, store-backed hooks (fork of Poracode).
 *
 * Pools are this app's host settings, so these hooks read the managed host's
 * agent statuses, usage snapshots and settings. Surfaces for a paired host's
 * projects or threads skip pools (that host keeps its own settings).
 */
import { useLingui } from "@lingui/react/macro";
import {
  parseAgentProfileKind,
  type AgentInstanceConfigMap,
  type AgentStatus,
} from "@/shared/contracts";
import { getProviderManifest } from "@/renderer/components/providers/providerManifest";
import { useHostAgentStatusPools } from "@/renderer/hooks/useHostAgentStatuses";
import { useProviderUsageStore } from "@/renderer/state/providerUsageStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { useMinuteClock } from "./minuteClock";
import {
  bestPoolMembersByDriver,
  buildPoolMemberViews,
  preferBestPoolMembers,
  type PoolMemberView,
} from "./poolModel";
import { useAccountPools } from "./poolSettings";
import { selectCollectedUsageDisabledProviders } from "./usageTracking";

/**
 * Display name for an account: its detected label ("Codex Work"), else the
 * profile's own name, else `fallback` (the provider's name for a base kind).
 */
export function accountLabel(
  agentKind: string,
  statuses: readonly AgentStatus[],
  instances: AgentInstanceConfigMap | undefined,
  fallback: string,
): string {
  const status = statuses.find((candidate) => candidate.kind === agentKind);
  if (status) return status.label;
  const profile = parseAgentProfileKind(agentKind);
  if (profile) {
    const instance = instances?.[profile.instanceId];
    return instance?.displayName ?? profile.instanceId;
  }
  return fallback;
}

/** The managed host's agent statuses, native first, then WSL. */
export function useManagedAgentStatuses(): AgentStatus[] {
  const pools = useHostAgentStatusPools(undefined);
  return [...pools.windows, ...pools.wsl];
}

/** `accountLabel` bound to the managed host's statuses and profiles. */
export function useAccountLabelResolver(): (agentKind: string) => string {
  const { t } = useLingui();
  const statuses = useManagedAgentStatuses();
  const instances = useSharedSettings((state) => state.agentInstances);
  return (agentKind) => {
    const manifest = getProviderManifest(agentKind);
    return accountLabel(agentKind, statuses, instances, manifest ? t(manifest.label) : agentKind);
  };
}

/** Live view of each account in `order` (usage, readiness, tone) for settings and the status bar. */
export function usePoolMemberViews(
  order: readonly string[],
  switchAtPercent: number | undefined,
): PoolMemberView[] {
  const statuses = useManagedAgentStatuses();
  const disabledAgents = useSharedSettings((state) => state.disabledAgents);
  const agentInstances = useSharedSettings((state) => state.agentInstances);
  // Collection honours pools (enabled pools' members in use are tracked unless
  // the owner turned one off), so "tracking is off" reflects what the host
  // does — the same list the usage settings, panel and rail show.
  const disabledUsageProviders = useSharedSettings(selectCollectedUsageDisabledProviders);
  const snapshots = useProviderUsageStore((state) => state.snapshots);
  const labelFor = useAccountLabelResolver();
  const now = useMinuteClock();
  if (order.length === 0) return [];
  return buildPoolMemberViews({
    order,
    statuses,
    disabledAgents,
    instances: agentInstances,
    snapshots,
    disabledUsageProviders,
    labelFor,
    switchAtPercent,
    now,
  });
}

/**
 * Best account per enabled pool (driver → agent kind) among `statuses`, for
 * pickers without a composer such as Roundtable seats.
 */
export function useBestPoolMembers(statuses: readonly AgentStatus[]): Record<string, string> {
  const pools = useAccountPools();
  const disabledAgents = useSharedSettings((state) => state.disabledAgents);
  const instances = useSharedSettings((state) => state.agentInstances);
  const snapshots = useProviderUsageStore((state) => state.snapshots);
  const now = useMinuteClock();
  return bestPoolMembersByDriver({ pools, statuses, disabledAgents, instances, snapshots, now });
}

/**
 * `entries` (Roundtable's ready agent brains, say) with each pooled
 * provider's best account moved to the front of that provider's entries.
 * `enabled` is false for a paired host's project (its own pools apply there).
 */
export function useAccountPoolPreferredOrder<T extends { agentKind: string }>(
  entries: readonly T[],
  statuses: readonly AgentStatus[],
  enabled = true,
): T[] {
  const best = useBestPoolMembers(statuses);
  return enabled ? preferBestPoolMembers(entries, best) : [...entries];
}
