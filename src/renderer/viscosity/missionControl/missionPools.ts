/**
 * ViscosityCode Mission Control: account and usage left for pooled accounts
 * (fork of Poracode). One lookup for the whole board, built from the same
 * shared member states the host failover policy decides from
 * (`poolMemberStates` through `buildPoolMemberViews`). Pools are this app's
 * host settings, so only managed-host threads use it; a paired host keeps its
 * own pools.
 */
import { usageCollectionDisabledProviders } from "@/shared/accountPoolUsage";
import { useMinuteClock } from "@/renderer/viscosity/accountPools/minuteClock";
import {
  useAccountLabelResolver,
  useManagedAgentStatuses,
} from "@/renderer/viscosity/accountPools/poolHooks";
import {
  buildPoolMemberViews,
  enabledPoolMembers,
  type PoolMemberView,
} from "@/renderer/viscosity/accountPools/poolModel";
import { useAccountPools } from "@/renderer/viscosity/accountPools/poolSettings";
import { useProviderUsageStore } from "@/renderer/state/providerUsageStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";

export type MissionPoolLookup = ReadonlyMap<string, PoolMemberView>;

const NO_POOL_VIEWS: MissionPoolLookup = new Map();

/** Agent kind → its pooled account view, for every member of an enabled pool. */
export function useMissionPoolViews(): MissionPoolLookup {
  const pools = useAccountPools();
  const statuses = useManagedAgentStatuses();
  const disabledAgents = useSharedSettings((state) => state.disabledAgents);
  const usage = useSharedSettings((state) => state.usage);
  const storedPools = useSharedSettings((state) => state.accountPools);
  const instances = useSharedSettings((state) => state.agentInstances);
  const snapshots = useProviderUsageStore((state) => state.snapshots);
  const labelFor = useAccountLabelResolver();
  const now = useMinuteClock();

  const groups = Object.entries(pools).flatMap(([driver, pool]) => {
    const members = enabledPoolMembers(driver, pool, instances);
    return members ? [{ members, switchAtPercent: pool.switchAtPercent }] : [];
  });
  if (groups.length === 0) return NO_POOL_VIEWS;
  // A settings snapshot without usage settings (a partial mirror) adds none.
  const disabledUsageProviders = usage
    ? usageCollectionDisabledProviders({
        usage,
        accountPools: storedPools,
        agentInstances: instances,
      })
    : [];
  const lookup = new Map<string, PoolMemberView>();
  for (const group of groups) {
    const views = buildPoolMemberViews({
      order: group.members,
      statuses,
      disabledAgents,
      instances,
      snapshots,
      disabledUsageProviders,
      labelFor,
      switchAtPercent: group.switchAtPercent,
      now,
    });
    for (const view of views) lookup.set(view.agentKind, view);
  }
  return lookup;
}
