/**
 * ViscosityCode: pretend subscriptions as dashboard rows (fork of Poracode).
 *
 * Turns the owner's device-local pretend entries into provider rows shaped
 * like real ones, so they render with the same plan chip, bars and badges.
 * They are display-only and live only in this dashboard's view model.
 */
import { DEFAULT_SWITCH_AT_PERCENT, memberAvailability } from "@/shared/accountPools";
import type { UsageSnapshot } from "@/shared/contracts";
import { poolUsageTone, usagePercentLeft } from "@/renderer/viscosity/accountPools/poolModel";
import { snapshotHasUsageData, type SubscriptionProvider } from "./subscriptionsModel";
import { PRETEND_PROVIDER_PREFIX, type PretendSubscription } from "./subscriptionsPrefs";

/** Synthetic usage window id of a pretend bar (a display key only). */
export function pretendWindowId(index: number): string {
  return `pretend-${index}`;
}

export function pretendSubscriptionProviders(
  entries: readonly PretendSubscription[],
  now: number,
  /** Known agent kind for a provider name, so the row borrows its icon and accent. */
  kindForName: (name: string) => string | undefined,
): SubscriptionProvider[] {
  return entries.map((entry) => {
    const id = `${PRETEND_PROVIDER_PREFIX}${entry.id}`;
    const snapshot = {
      providerId: id,
      status: "ok",
      // 0 keeps pretend rows out of the "Updated" time.
      fetchedAt: 0,
      plan: entry.plan,
      // Synthetic window ids are display keys only; nothing parses them.
      windows: entry.bars.map((bar, index) => ({
        id: pretendWindowId(index),
        label: bar.label,
        usedPercent: bar.usedPercent,
      })),
    } as UsageSnapshot;
    const availability = memberAvailability(snapshot, now, DEFAULT_SWITCH_AT_PERCENT);
    const styleKind = kindForName(entry.provider);
    return {
      id,
      label: entry.provider,
      supportsPool: false,
      pool: undefined,
      pretendId: entry.id,
      ...(styleKind ? { styleKind } : {}),
      accounts: [
        {
          agentKind: id,
          label: entry.account ?? entry.provider,
          usageId: id,
          status: undefined,
          readiness: "signed-in",
          snapshot,
          usageSupported: true,
          usageTracked: true,
          hasUsageData: snapshotHasUsageData(snapshot),
          availability,
          percentLeft: usagePercentLeft(snapshot, now),
          tone: poolUsageTone(availability),
          pool: undefined,
          // agentKind and usageId stay synthetic (dedupe, meter rules); only the look is borrowed.
          ...(styleKind ? { styleKind } : {}),
          resetTexts: Object.fromEntries(
            entry.bars.flatMap((bar, index) =>
              bar.reset ? [[pretendWindowId(index), bar.reset]] : [],
            ),
          ),
        },
      ],
    };
  });
}
