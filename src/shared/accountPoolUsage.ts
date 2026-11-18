/**
 * ViscosityCode: usage collection for account pools (fork of Poracode).
 *
 * Usage collection is opt-in per usage id: fresh installs store every
 * provider except the default-on ones in `usage.disabledProviders`
 * (DEFAULT_USAGE_DISABLED_PROVIDER_IDS). Pool decisions need the usage of
 * every member, so the collector applies this effective list instead of the
 * stored one. The stored list is never rewritten.
 */
import { poolUsageAccountIds } from "./accountPools";
import { DEFAULT_USAGE_DISABLED_PROVIDER_IDS, type SharedSettings } from "./settings";
import type { UsageAccountIdHooks } from "./usageAccountId";

const DEFAULT_OFF = new Set<string>(DEFAULT_USAGE_DISABLED_PROVIDER_IDS);

/**
 * `usage.disabledProviders` minus the members of enabled pools that are off
 * only because of the built-in default. The stored list cannot tell a default
 * opt-out from a user's own, so an entry the default would not have made (a
 * default-on provider, any profile account) is the user's explicit choice and
 * stays disabled; such a member's availability is then unknown to the pool.
 * The global `usage.autoRefresh` switch is not overridden either.
 */
export function usageCollectionDisabledProviders(
  settings: Pick<SharedSettings, "usage" | "accountPools" | "agentInstances">,
  hooks?: UsageAccountIdHooks,
): string[] {
  const disabled = settings.usage.disabledProviders;
  const pooled = new Set(
    poolUsageAccountIds(settings.accountPools, settings.agentInstances, hooks),
  );
  if (pooled.size === 0) return [...disabled];
  return disabled.filter((id) => !(pooled.has(id) && DEFAULT_OFF.has(id)));
}

/** Whether usage for `usageAccountId` is on once pools are honored (auto-refresh aside). */
export function isUsageProviderEnabledWithPools(
  settings: Pick<SharedSettings, "usage" | "accountPools" | "agentInstances">,
  usageAccountId: string,
  hooks?: UsageAccountIdHooks,
): boolean {
  return !usageCollectionDisabledProviders(settings, hooks).includes(usageAccountId);
}
