/**
 * ViscosityCode: Subscriptions dashboard, store-backed hook (fork of Poracode).
 *
 * Reads the managed host's agent statuses, profiles, pools and usage
 * snapshots and builds the dashboard model. Nothing here follows thread
 * streaming: statuses, settings and usage snapshots change rarely, and "now"
 * comes from the shared minute clock.
 */
import { useLingui } from "@lingui/react/macro";
import { usageCollectionDisabledProviders } from "@/shared/accountPoolUsage";
import {
  getProviderManifest,
  getProviderModelPickerRank,
} from "@/renderer/components/providers/providerManifest";
import {
  usageProviderIdForAgent,
  usageProvidersForAgentInstances,
} from "@/renderer/components/providers/usageProviders";
import { useProviderUsageStore } from "@/renderer/state/providerUsageStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { useMinuteClock } from "@/renderer/viscosity/accountPools/minuteClock";
import {
  useAccountLabelResolver,
  useManagedAgentStatuses,
} from "@/renderer/viscosity/accountPools/poolHooks";
import { useAccountPools } from "@/renderer/viscosity/accountPools/poolSettings";
import {
  buildSubscriptionProviders,
  lastUsageUpdate,
  summarizeRoom,
  type RoomSummary,
  type SubscriptionProvider,
} from "./subscriptionsModel";

export interface SubscriptionsView {
  providers: SubscriptionProvider[];
  room: RoomSummary;
  /** Latest usage fetch among the shown accounts (0 when none arrived). */
  lastUpdated: number;
  now: number;
}

export function useSubscriptions(): SubscriptionsView {
  const { t } = useLingui();
  const statuses = useManagedAgentStatuses();
  const instances = useSharedSettings((state) => state.agentInstances);
  const disabledAgents = useSharedSettings((state) => state.disabledAgents);
  const usage = useSharedSettings((state) => state.usage);
  const storedPools = useSharedSettings((state) => state.accountPools);
  const pools = useAccountPools();
  const snapshots = useProviderUsageStore((state) => state.snapshots);
  const accountLabel = useAccountLabelResolver();
  const now = useMinuteClock();

  // Collection honours pools: members of enabled pools are tracked unless the
  // owner turned one off, so "tracking is off" matches what the host does.
  // A partial settings mirror without usage settings disables nothing.
  const disabledUsageProviders = usage
    ? usageCollectionDisabledProviders({
        usage,
        accountPools: storedPools,
        agentInstances: instances,
      })
    : [];
  const usageSupportedIds = new Set(
    usageProvidersForAgentInstances(instances).map((provider) => provider.id),
  );
  const statusLabel = (kind: string) => statuses.find((status) => status.kind === kind)?.label;

  const providers = buildSubscriptionProviders({
    statuses,
    instances,
    disabledAgents,
    pools,
    snapshots,
    disabledUsageProviders,
    usageSupportedIds,
    usageIdFor: (agentKind) => usageProviderIdForAgent(agentKind, undefined, instances),
    providerLabel: (providerId) => {
      const manifest = getProviderManifest(providerId);
      // A standalone instance kind ("<driver>:<id>" that is not a profile) has
      // its own name; the shared manifest would only name its driver.
      if (manifest && !providerId.includes(":")) return t(manifest.label);
      return statusLabel(providerId) ?? (manifest ? t(manifest.label) : providerId);
    },
    accountLabel,
    providerRank: getProviderModelPickerRank,
    now,
  });

  return {
    providers,
    room: summarizeRoom(providers, now),
    lastUpdated: lastUsageUpdate(providers),
    now,
  };
}
