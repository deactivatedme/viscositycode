/**
 * ViscosityCode: the Subscriptions tab of Mission Control (fork of Poracode).
 *
 * One row per provider the owner pays for, with each account (profiles and
 * pool members) nested under it, and a "Who has room right now" strip on top.
 * Data comes from the stores the usage panel and account pools already fill;
 * the refresh button runs the usage panel's forced refresh. Providers are
 * dragged into the owner's order, pretend subscriptions (display only) are
 * added and edited here, and real accounts can be customized (display only).
 */
import { useId, useState } from "react";
import { Accessibility } from "@dnd-kit/dom";
import { DragDropProvider, type DragEndEvent } from "@dnd-kit/react";
import { isSortable } from "@dnd-kit/react/sortable";
import { Button } from "@heroui/react";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { Plus, RefreshCw } from "lucide-react";
import { useProviderUsageHydration } from "@/renderer/components/providers/useProviderUsageHydration";
import type { TranslateFn } from "@/renderer/i18n/i18n";
import { useCanWriteAccountPools } from "@/renderer/viscosity/accountPools/poolSettings";
import { refreshSubscriptionsUsage } from "../subscriptionsActions";
import {
  overrideDraftSource,
  realUsageBars,
  sectionCustomizeAccount,
} from "../subscriptionOverrides";
import {
  MAX_PRETEND_SUBSCRIPTIONS,
  reorderSubscriptionProvider,
  useSubscriptionsPrefsStore,
} from "../subscriptionsPrefs";
import { useSubscriptions } from "../useSubscriptions";
import {
  PretendSubscriptionDialog,
  type SubscriptionEditorTarget,
} from "./PretendSubscriptionDialog";
import { RoomStrip } from "./RoomStrip";
import {
  SUBSCRIPTION_SORTABLE_PREFIX,
  SubscriptionProviderSection,
} from "./SubscriptionProviderSection";
import { useSubscriptionsDragAccessibility } from "./useSubscriptionsDragAccessibility";

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
  const {
    providers,
    room,
    lastUpdated,
    now,
    knownNames,
    planNamesFor,
    accountKinds,
    realProviderLabel,
  } = useSubscriptions();
  const canManagePools = useCanWriteAccountPools();
  const [refreshing, setRefreshing] = useState(false);
  const pretend = useSubscriptionsPrefsStore((state) => state.pretend);
  const overrides = useSubscriptionsPrefsStore((state) => state.overrides);
  // undefined: closed; null: adding; an id: editing that entry.
  const [editing, setEditing] = useState<string | null | undefined>(undefined);
  const editingEntry = editing ? pretend.find((entry) => entry.id === editing) : undefined;
  // The real account (agent kind) being customized.
  const [customizing, setCustomizing] = useState<string | undefined>(undefined);
  const editorTarget = ((): SubscriptionEditorTarget | undefined => {
    if (customizing !== undefined) {
      const provider = providers.find((candidate) =>
        candidate.accounts.some((account) => account.agentKind === customizing),
      );
      const account = provider?.accounts.find((candidate) => candidate.agentKind === customizing);
      if (!provider || !account || provider.pretendId !== undefined) return undefined;
      const saved = overrides.find((override) => override.key === customizing);
      return {
        kind: "customize",
        source: overrideDraftSource(realProviderLabel(provider.id), account, saved),
        realBars: realUsageBars(account),
        customized: saved !== undefined,
        knownKeys: accountKinds,
      };
    }
    if (editing === null || editingEntry) return { kind: "pretend", entry: editingEntry };
    return undefined;
  })();
  // The account or entry went away while its dialog was open: forget it, so
  // the dialog does not pop back open by itself when it returns.
  if (!editorTarget && (customizing !== undefined || editing !== undefined)) {
    setCustomizing(undefined);
    setEditing(undefined);
  }
  const pretendFull = pretend.length >= MAX_PRETEND_SUBSCRIPTIONS;
  const pretendLimitId = useId();
  const maxPretend = MAX_PRETEND_SUBSCRIPTIONS;
  const dragAccessibility = useSubscriptionsDragAccessibility(
    providers.map((provider) => ({
      id: `${SUBSCRIPTION_SORTABLE_PREFIX}${provider.id}`,
      label: provider.label,
    })),
  );

  // Applied by the moved provider's id, so a list that changed mid-drag
  // (minute clock, usage broadcast) cannot move the wrong row.
  const handleDragEnd = (event: DragEndEvent) => {
    if (event.canceled) return;
    const source = event.operation.source;
    if (!source || !isSortable(source)) return;
    const sortableId = String(source.id);
    if (!sortableId.startsWith(SUBSCRIPTION_SORTABLE_PREFIX)) return;
    reorderSubscriptionProvider(
      providers.map((provider) => provider.id),
      sortableId.slice(SUBSCRIPTION_SORTABLE_PREFIX.length),
      source.index,
    );
  };

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
          <Trans>
            Your enabled subscriptions and accounts, with the usage each one has left. Drag a
            provider to reorder.
          </Trans>
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
        {pretendFull ? (
          <span id={pretendLimitId} className="text-[11px] text-muted/80">
            <Trans>You can have up to {maxPretend} pretend subscriptions</Trans>
          </span>
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          className="h-7 min-h-7 gap-1 px-2 text-xs"
          isDisabled={pretendFull}
          {...(pretendFull ? { "aria-describedby": pretendLimitId } : {})}
          onPress={() => setEditing(null)}
        >
          <Plus aria-hidden="true" className="size-3.5" />
          <Trans>Add pretend subscription</Trans>
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 [scrollbar-gutter:stable]">
        <div className="mx-auto flex max-w-5xl flex-col gap-3">
          {providers.length > 0 ? <RoomStrip summary={room} now={now} /> : null}
          {providers.length === 0 ? (
            <p className="px-1 py-6 text-center text-sm text-muted" data-subscriptions-empty="">
              <Trans>
                No enabled subscriptions yet. Install, enable or sign in to an agent to see its
                usage here.
              </Trans>
            </p>
          ) : (
            <DragDropProvider
              plugins={(defaults) =>
                defaults.map((plugin) => (plugin === Accessibility ? dragAccessibility : plugin))
              }
              onDragEnd={handleDragEnd}
            >
              <ul aria-label={t`Subscriptions`} className="flex flex-col gap-3">
                {providers.map((provider, index) => (
                  <SubscriptionProviderSection
                    key={provider.id}
                    provider={provider}
                    now={now}
                    canManagePools={canManagePools}
                    index={index}
                    reorderable={providers.length > 1}
                    onEditPretend={setEditing}
                    onCustomize={(account) =>
                      setCustomizing(
                        account ?? sectionCustomizeAccount(provider, overrides)?.agentKind,
                      )
                    }
                  />
                ))}
              </ul>
            </DragDropProvider>
          )}
        </div>
      </div>
      {editorTarget ? (
        <PretendSubscriptionDialog
          key={customizing ?? editing ?? "new"}
          target={editorTarget}
          knownNames={knownNames}
          planNamesFor={planNamesFor}
          onClose={() => {
            setEditing(undefined);
            setCustomizing(undefined);
          }}
        />
      ) : null}
    </div>
  );
}
