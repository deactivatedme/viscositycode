/**
 * ViscosityCode: Subscriptions dashboard, store-backed hook (fork of Poracode).
 *
 * Reads the managed host's agent statuses, profiles, pools and usage
 * snapshots and builds the dashboard model. Nothing here follows thread
 * streaming: statuses, settings and usage snapshots change rarely, and "now"
 * comes from the shared minute clock. The owner's order, pretend entries and
 * display overrides of real accounts come from this device's dashboard
 * preferences (subscriptionsPrefs.ts); overrides are drawn in last
 * (subscriptionOverrides.ts), so only this view sees them.
 */
import { useLingui } from "@lingui/react/macro";
import { usageCollectionDisabledProviders } from "@/shared/accountPoolUsage";
import { parseAgentProfileKind } from "@/shared/contracts";
import {
  getProviderManifest,
  getProviderManifests,
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
import { pretendSubscriptionProviders } from "./pretendSubscriptions";
import {
  applySubscriptionOverrides,
  seenPlanNames,
  subscriptionPlanSuggestions,
} from "./subscriptionOverrides";
import {
  buildSubscriptionProviders,
  knownAccountKinds,
  lastUsageUpdate,
  sortSubscriptionProviders,
  summarizeRoom,
  type RoomSummary,
  type SubscriptionProvider,
} from "./subscriptionsModel";
import { subscriptionRank, useSubscriptionsPrefsStore } from "./subscriptionsPrefs";

export interface KnownProviderName {
  kind: string;
  label: string;
}

/**
 * Known providers' display names for the editor's provider picker: the
 * provider registry, then installed agents it does not list (profile
 * accounts are accounts, not providers).
 */
export function useKnownProviderNames(): KnownProviderName[] {
  const { t } = useLingui();
  const statuses = useManagedAgentStatuses();
  const known: KnownProviderName[] = getProviderManifests().map((manifest) => ({
    kind: manifest.kind,
    label: t(manifest.label),
  }));
  for (const status of statuses) {
    if (!status.installed || parseAgentProfileKind(status.kind)) continue;
    const label = status.label.trim();
    if (!label || known.some((entry) => sameName(entry.label, label))) continue;
    if (known.some((entry) => entry.kind === status.kind)) continue;
    known.push({ kind: status.kind, label });
  }
  return known;
}

function sameName(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

export interface SubscriptionsView {
  /** Real providers and pretend rows together, in the owner's order. */
  providers: SubscriptionProvider[];
  room: RoomSummary;
  /** Latest usage fetch among the shown accounts (0 when none arrived). */
  lastUpdated: number;
  now: number;
  knownNames: KnownProviderName[];
  /** The plan picker's choices for a typed provider name. */
  planNamesFor: (providerName: string) => string[];
  /** Every account kind the host knows, hidden ones included (overrides stay keyed on these). */
  accountKinds: string[];
  /** A real provider's name before the owner's overrides. */
  realProviderLabel: (providerId: string) => string;
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
  const order = useSubscriptionsPrefsStore((state) => state.providerOrder);
  const pretend = useSubscriptionsPrefsStore((state) => state.pretend);
  const overrides = useSubscriptionsPrefsStore((state) => state.overrides);
  const knownNames = useKnownProviderNames();
  const rank = subscriptionRank(order, getProviderModelPickerRank);

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

  const providerLabel = (providerId: string) => {
    const manifest = getProviderManifest(providerId);
    // A standalone instance kind ("<driver>:<id>" that is not a profile) has
    // its own name; the shared manifest would only name its driver.
    if (manifest && !providerId.includes(":")) return t(manifest.label);
    return statusLabel(providerId) ?? (manifest ? t(manifest.label) : providerId);
  };

  const real = buildSubscriptionProviders({
    statuses,
    instances,
    disabledAgents,
    pools,
    snapshots,
    disabledUsageProviders,
    usageSupportedIds,
    usageIdFor: (agentKind) => usageProviderIdForAgent(agentKind, undefined, instances),
    providerLabel,
    accountLabel,
    providerRank: rank,
    now,
    keepKinds: new Set(overrides.map((override) => override.key)),
  });
  const kindForName = (name: string) =>
    knownNames.find((known) => sameName(known.label, name.trim()))?.kind;
  // Overrides go in after sorting, so a renamed provider keeps its place.
  const providers = applySubscriptionOverrides(
    sortSubscriptionProviders(
      [...real, ...pretendSubscriptionProviders(pretend, now, kindForName)],
      rank,
    ),
    overrides,
    now,
    kindForName,
  );

  return {
    providers,
    room: summarizeRoom(providers, now),
    lastUpdated: lastUsageUpdate(providers),
    now,
    knownNames,
    accountKinds: knownAccountKinds({ statuses, instances, disabledAgents }),
    realProviderLabel: providerLabel,
    planNamesFor: (providerName) => {
      const kind = kindForName(providerName);
      return subscriptionPlanSuggestions(kind, seenPlanNames(real, kind));
    },
  };
}
