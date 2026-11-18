/**
 * ViscosityCode: account pools, usage tracking as the host applies it (fork of
 * Poracode).
 *
 * The supervisor collects usage for every member of an enabled pool that is
 * off only by the built-in default (`usageCollectionDisabledProviders`), so
 * the pool can tell when an account runs out. The usage settings, the usage
 * panel and the sidebar rail read the same effective list through this
 * module, so a pooled account shows as tracked exactly when the host tracks
 * it. Writes keep using the stored `usage.disabledProviders`.
 */
import { usageCollectionDisabledProviders } from "@/shared/accountPoolUsage";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { poolsAreHostSettings } from "./poolSettings";

type SharedSettingsState = ReturnType<typeof useSharedSettings.getState>;

const NONE: readonly string[] = [];

let last:
  | {
      stored: readonly string[];
      pools: SharedSettingsState["accountPools"];
      instances: SharedSettingsState["agentInstances"];
      collected: readonly string[];
    }
  | undefined;

/**
 * Usage ids whose collection is off once pools are honored. Reference-stable:
 * the stored list itself when pools change nothing, and the same array until
 * the stored list, the pools or the profiles change (safe as a store selector).
 */
export function selectCollectedUsageDisabledProviders(
  state: SharedSettingsState,
): readonly string[] {
  const usage = state.usage as SharedSettingsState["usage"] | undefined;
  const stored = usage?.disabledProviders ?? NONE;
  if (
    last &&
    last.stored === stored &&
    last.pools === state.accountPools &&
    last.instances === state.agentInstances
  ) {
    return last.collected;
  }
  const effective =
    usage && poolsAreHostSettings()
      ? usageCollectionDisabledProviders({
          usage,
          accountPools: state.accountPools,
          agentInstances: state.agentInstances,
        })
      : stored;
  // The effective list only ever drops entries; same length means unchanged.
  const collected = effective.length === stored.length ? stored : effective;
  last = { stored, pools: state.accountPools, instances: state.agentInstances, collected };
  return collected;
}

/**
 * True when `usageId` is tracked only because an enabled pool needs it (its
 * stored entry is the built-in default opt-out). Turning tracking off there
 * cannot take effect while the pool needs the account, so the switch is
 * shown on and locked.
 */
export function useUsageTrackingRequiredByPool(usageId: string): boolean {
  return useSharedSettings(
    (state) =>
      (state.usage as SharedSettingsState["usage"] | undefined)?.disabledProviders.includes(
        usageId,
      ) === true && !selectCollectedUsageDisabledProviders(state).includes(usageId),
  );
}
