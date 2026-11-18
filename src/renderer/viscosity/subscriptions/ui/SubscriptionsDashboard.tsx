/**
 * ViscosityCode: the Subscriptions tab of Mission Control (fork of Poracode).
 *
 * One row per provider the owner pays for, with each account (profiles and
 * pool members) nested under it, and a "Who has room right now" strip on top.
 * Data comes from the stores the usage panel and account pools already fill;
 * the refresh button runs the usage panel's forced refresh.
 */
import { useState } from "react";
import { Button } from "@heroui/react";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { RefreshCw } from "lucide-react";
import { useProviderUsageHydration } from "@/renderer/components/providers/useProviderUsageHydration";
import type { TranslateFn } from "@/renderer/i18n/i18n";
import { useCanWriteAccountPools } from "@/renderer/viscosity/accountPools/poolSettings";
import { refreshSubscriptionsUsage } from "../subscriptionsActions";
import { useSubscriptions } from "../useSubscriptions";
import { RoomStrip } from "./RoomStrip";
import { SubscriptionProviderSection } from "./SubscriptionProviderSection";

/** "just now" / "5m ago" / "2h ago" / "3d ago" at minute resolution. */
export function formatUpdatedAgo(fetchedAt: number, now: number, t: TranslateFn): string {
  const minutes = Math.max(0, Math.round((now - fetchedAt) / 60_000));
  if (minutes < 1) return t(msg`just now`);
  if (minutes < 60) return t(msg`${minutes}m ago`);
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t(msg`${hours}h ago`);
  const days = Math.round(hours / 24);
  return t(msg`${days}d ago`);
}

export function SubscriptionsDashboard() {
  const { t } = useLingui();
  // Read the host's cached usage on open; the supervisor keeps polling.
  useProviderUsageHydration();
  const { providers, room, lastUpdated, now } = useSubscriptions();
  const canManagePools = useCanWriteAccountPools();
  const [refreshing, setRefreshing] = useState(false);

  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await refreshSubscriptionsUsage();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div data-vc-subscriptions="" className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border/15 px-4 py-2.5">
        <p className="min-w-0 flex-1 text-xs text-muted">
          <Trans>Every subscription and account, with the usage each one has left.</Trans>
        </p>
        {lastUpdated > 0 ? (
          <span className="text-[11px] text-muted/80" data-subscriptions-updated="">
            <Trans>Updated {formatUpdatedAgo(lastUpdated, now, t)}</Trans>
          </span>
        ) : null}
        <Button
          size="sm"
          variant="secondary"
          className="h-7 min-h-7 gap-1 px-2 text-xs"
          aria-label={t`Refresh usage`}
          isDisabled={refreshing}
          onPress={() => void refresh()}
        >
          <RefreshCw
            aria-hidden="true"
            className={`size-3.5 ${refreshing ? "animate-spin" : ""}`}
          />
          <Trans>Refresh</Trans>
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 [scrollbar-gutter:stable]">
        <div className="mx-auto flex max-w-5xl flex-col gap-3">
          {providers.length > 0 ? <RoomStrip summary={room} now={now} /> : null}
          {providers.length === 0 ? (
            <p className="px-1 py-6 text-center text-sm text-muted" data-subscriptions-empty="">
              <Trans>
                No subscriptions yet. Install or sign in to an agent to see its usage here.
              </Trans>
            </p>
          ) : (
            <ul aria-label={t`Subscriptions`} className="flex flex-col gap-3">
              {providers.map((provider) => (
                <SubscriptionProviderSection
                  key={provider.id}
                  provider={provider}
                  now={now}
                  canManagePools={canManagePools}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
