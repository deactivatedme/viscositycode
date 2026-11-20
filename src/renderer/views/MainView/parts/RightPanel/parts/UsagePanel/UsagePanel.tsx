// Modified for ViscosityCode (fork of Poracode). See FORK_CHANGES.md.
import { startTransition, useEffect, useRef, useState } from "react";
// ViscosityCode: account pools — pooled accounts the host collects show as tracked.
import { selectCollectedUsageDisabledProviders } from "@/renderer/viscosity/accountPools/usageTracking";
import { PanelActivity } from "@/renderer/components/layout/panelMotion";
import { PointerActivationConstraints } from "@dnd-kit/dom";
import { DragDropProvider, KeyboardSensor, PointerSensor, type DragEndEvent } from "@dnd-kit/react";
import { isSortable } from "@dnd-kit/react/sortable";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { RefreshCw, Settings2 } from "lucide-react";
import { openUsageSettings } from "@/renderer/actions/panelActions";
import {
  HostUsageStatus,
  useHostUsageView,
  useUsageClock,
} from "@/renderer/components/providers/HostUsageView";
import { HostUsageInfo } from "@/renderer/components/providers/HostUsageInfo";
import { UsageProviderCardView } from "@/renderer/components/providers/UsageProviderCardView";
import { useUsagePanelScope } from "@/renderer/components/providers/useUsagePanelScope";
import { fetchHostUsage } from "@/renderer/components/providers/hostUsage";
import { readBridge } from "@/renderer/bridge";
import { useCompactLayout } from "@/renderer/adaptiveLayout";
import { RemoteServerPicker } from "@/renderer/components/common/RemoteServerPicker";
import { floatingBubblePillClass } from "@/renderer/components/layout/floatingGlass";
import { MobilePageHeaderActions } from "@/renderer/components/layout/MobilePageHeaderActions";
import { MobileCircleButton } from "@/renderer/components/mobileComposer/MobileCircleButton";
import {
  detectedUsageIds,
  isUsageProviderShown,
  resolveDisplayedProviders,
  resolveHostUsageProviders,
  separateCurrentUsageProvider,
  usageProviderIdForAgent,
} from "@/renderer/components/providers/usageProviders";
import { useScrollFade } from "@/renderer/hooks/useScrollFade";
// ViscosityCode: usage surfaces list only detected agents (isUsageProviderShown).
import { useHostAgentStatusPools } from "@/renderer/hooks/useHostAgentStatuses";
import { useProviderUsageStore } from "@/renderer/state/providerUsageStore";
import { isHostProviderRefreshing, isWholeHostRefreshing } from "@/renderer/state/hostUsageStore";
import { useRemoteServersStore } from "@/renderer/state/remoteServersStore";
import { useUsageLoginStateStore } from "@/renderer/state/usageLoginStateStore";
import { useUsageScopeStore } from "@/renderer/state/usageScopeStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { UsageProviderCard } from "./parts/UsageProviderCard";
import type { TranslateFn } from "@/renderer/i18n/i18n";

const USAGE_SORT_SENSORS = [
  PointerSensor.configure({
    // The compact grip owns `touch-action: none`, so a short movement threshold
    // starts a direct finger drag without interfering with scrolling elsewhere.
    activationConstraints: [new PointerActivationConstraints.Distance({ value: 5 })],
  }),
  KeyboardSensor,
];

/** "Updated 12s ago" style relative label from an epoch-ms timestamp. */
function formatUpdatedAgo(fetchedAt: number, now: number, t: TranslateFn): string {
  const seconds = Math.max(0, Math.round((now - fetchedAt) / 1000));
  if (seconds < 5) return t(msg`just now`);
  if (seconds < 60) return t(msg`${seconds}s ago`);
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return t(msg`${minutes}m ago`);
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t(msg`${hours}h ago`);
  const days = Math.round(hours / 24);
  return t(msg`${days}d ago`);
}

export function UsagePanel(props: {
  onOpenUsageSettings?: (() => void) | undefined;
  visible?: boolean;
}) {
  const visible = props.visible ?? true;
  const nowTick = useUsageClock(visible);
  const compact = useCompactLayout();
  const refreshVersion = useUsageScopeStore((s) => s.refreshVersion);
  const {
    remote: remoteView,
    effectiveId: effectiveDesktopId,
    remoteSession: browserRuntime,
  } = useUsagePanelScope();
  const hostView = useHostUsageView(
    remoteView ? (effectiveDesktopId ?? "") : "",
    refreshVersion,
    remoteView && compact,
    visible,
  );
  useEffect(
    () => () => {
      // Moving between docks must preserve the sidebar's pending reveal.
      useUsageScopeStore.setState({ preferredProviderId: null });
    },
    [],
  );
  // Data ownership stays mounted: hiding this panel must not stop sidebar updates
  // or invalidate shared host data and re-fetch it on every tab switch.
  useEffect(() => {
    if (remoteView) return;
    let cancelled = false;
    const usageRequest =
      compact || refreshVersion > 0
        ? readBridge().refreshProviderUsage({ force: true })
        : readBridge().getProviderUsage({});
    void usageRequest
      .then((res) => {
        if (!cancelled) useProviderUsageStore.getState().setSnapshots(res.snapshots);
      })
      .catch(() => undefined);
    void readBridge()
      .getUsageLoginState({})
      .then((res) => {
        if (!cancelled) useUsageLoginStateStore.getState().setAll(res.stored);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [compact, refreshVersion, remoteView]);
  return (
    <PanelActivity visible={visible}>
      <UsagePanelContent
        onOpenUsageSettings={props.onOpenUsageSettings}
        compact={compact}
        remoteView={remoteView}
        effectiveDesktopId={effectiveDesktopId}
        browserRuntime={browserRuntime}
        hostView={hostView}
        nowTick={nowTick}
      />
    </PanelActivity>
  );
}

function UsagePanelContent(props: {
  onOpenUsageSettings?: (() => void) | undefined;
  compact: boolean;
  remoteView: boolean;
  effectiveDesktopId: string | null;
  browserRuntime: boolean;
  hostView: ReturnType<typeof useHostUsageView>;
  nowTick: number;
}) {
  const { compact, remoteView, effectiveDesktopId, browserRuntime, hostView, nowTick } = props;
  const { t } = useLingui();
  const providerOrder = useSharedSettings((s) => s.usage.providerOrder);
  // ViscosityCode: account pools — the list collection applies, not only the stored one.
  const disabledProviders = useSharedSettings(selectCollectedUsageDisabledProviders);
  const collapsedProviders = useSharedSettings((s) => s.usage.collapsedProviders);
  const agentInstances = useSharedSettings((s) => s.agentInstances);
  const disabledAgents = useSharedSettings((s) => s.disabledAgents);
  const localStatuses = useHostAgentStatusPools(undefined);
  const setUsageSetting = useSharedSettings((s) => s.setUsageSetting);
  const snapshots = useProviderUsageStore((s) => s.snapshots);
  const requestedDesktopId = useUsageScopeStore((s) => s.desktopId);
  const setRequestedDesktopId = useUsageScopeStore((s) => s.setDesktopId);
  const preferredProviderId = useUsageScopeStore((s) => s.preferredProviderId);
  const revealRequest = useUsageScopeStore((s) => s.revealRequest);
  const requestRefresh = useUsageScopeStore((s) => s.requestRefresh);
  const servers = useRemoteServersStore((s) => s.servers);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const { setScrollContainer, scrollFadeStyle } = useScrollFade<HTMLDivElement>({
    contentRef,
    maxFadePx: 10,
  });

  const localProviders = resolveDisplayedProviders(
    providerOrder,
    disabledProviders,
    agentInstances,
  );
  const orderedProviders = remoteView
    ? resolveHostUsageProviders(
        hostView.canRead ? hostView.usage.snapshots : [],
        providerOrder,
        hostView.agents,
      )
    : localProviders;
  const displayedSnapshots = remoteView
    ? Object.fromEntries(
        hostView.usage.snapshots.map((snapshot) => [snapshot.providerId, snapshot]),
      )
    : snapshots;
  // ViscosityCode: cards only for providers the shared usage-visibility rule
  // lists; `orderedProviders` keeps the full order for drag persistence.
  const detected = remoteView
    ? detectedUsageIds(hostView.agents, [], undefined)
    : detectedUsageIds(localStatuses, disabledAgents, agentInstances);
  const visibleProviders = orderedProviders.filter((provider) =>
    isUsageProviderShown(displayedSnapshots[provider.id], detected.has(provider.id)),
  );
  const revealAvailable = visibleProviders.some(
    (provider) => provider.id === revealRequest?.providerId,
  );
  useEffect(() => {
    if (!revealRequest || !revealAvailable) return;
    const frame = requestAnimationFrame(() => {
      const card = [
        ...(contentRef.current?.querySelectorAll<HTMLElement>("[data-usage-provider-id]") ?? []),
      ].find((element) => element.dataset.usageProviderId === revealRequest.providerId);
      card?.scrollIntoView({ block: "nearest" });
    });
    return () => cancelAnimationFrame(frame);
  }, [revealRequest, revealAvailable]);
  const { current: currentProvider, rest: sortableProviders } = separateCurrentUsageProvider(
    visibleProviders,
    preferredProviderId
      ? usageProviderIdForAgent(preferredProviderId, undefined, agentInstances)
      : null,
  );

  function renderCard(provider: { id: string; label: string }, index: number, draggable = true) {
    const common = {
      id: provider.id,
      label: provider.label,
      index,
      compact,
      collapsed: collapsedProviders.includes(provider.id),
      draggable,
      onToggleCollapse: toggleCollapse,
    };
    return remoteView ? (
      <UsageProviderCardView
        key={provider.id}
        {...common}
        snapshot={displayedSnapshots[provider.id]}
        showAccount
        // ViscosityCode: a card's refresh spins and disables only that card.
        refreshing={isHostProviderRefreshing(hostView.usage, provider.id)}
        refreshDisabled={!hostView.canRefresh}
        onRefresh={() =>
          void fetchHostUsage(effectiveDesktopId ?? "", true, {
            providerIds: [provider.id],
            force: true,
          })
        }
      />
    ) : (
      <UsageProviderCard key={provider.id} {...common} />
    );
  }

  const lastUpdated = (() => {
    let max = 0;
    for (const provider of visibleProviders) {
      const fetchedAt = displayedSnapshots[provider.id]?.fetchedAt;
      if (fetchedAt && fetchedAt > max) max = fetchedAt;
    }
    return max;
  })();

  const showPicker = servers.length > 0 || (!browserRuntime && requestedDesktopId !== null);
  const showFooter = !compact && (showPicker || lastUpdated > 0);

  const openSettings = props.onOpenUsageSettings ?? openUsageSettings;

  const hostRefreshing = isWholeHostRefreshing(hostView.usage);
  const refreshNow = () => {
    if (remoteView ? !hostView.canRefresh || hostRefreshing : isRefreshing) return;
    setIsRefreshing(true);
    requestRefresh();
    window.setTimeout(() => setIsRefreshing(false), 450);
  };

  const toggleCollapse = (id: string) => {
    const next = collapsedProviders.includes(id)
      ? collapsedProviders.filter((x) => x !== id)
      : [...new Set([...collapsedProviders, id])];
    startTransition(() => setUsageSetting("collapsedProviders", next));
  };

  function handleDragEnd(event: DragEndEvent) {
    if (event.canceled) return;
    const src = event.operation.source;
    if (!src || !isSortable(src)) return;
    const fromIndex = src.initialIndex;
    const toIndex = src.index;
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return;
    const reorderedIds = sortableProviders.map((provider) => provider.id);
    const [moved] = reorderedIds.splice(fromIndex, 1);
    if (!moved) return;
    reorderedIds.splice(toIndex, 0, moved);
    // ViscosityCode: splice back into the full order so the pinned current card
    // and hidden providers keep their `providerOrder` slots.
    const sortableIds = new Set(reorderedIds);
    let reorderedIndex = 0;
    const next = orderedProviders.map((provider) =>
      sortableIds.has(provider.id) ? reorderedIds[reorderedIndex++]! : provider.id,
    );
    startTransition(() => setUsageSetting("providerOrder", next));
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-[var(--content-background)]">
      {compact && (lastUpdated > 0 || remoteView) ? (
        <MobilePageHeaderActions>
          {lastUpdated > 0 ? (
            <p className="whitespace-nowrap text-[11px] text-muted/70">
              <Trans>Updated {formatUpdatedAgo(lastUpdated, nowTick, t)}</Trans>
            </p>
          ) : null}
          {remoteView ? <HostUsageInfo className="size-11 min-h-11 min-w-11 text-muted" /> : null}
        </MobilePageHeaderActions>
      ) : null}

      <div
        ref={setScrollContainer}
        className={`m-page-content min-h-0 flex-1 overflow-y-auto p-2.5 [scrollbar-gutter:stable] ${
          compact
            ? "pb-[calc(var(--m-floating-control-height)+2.5rem+env(safe-area-inset-bottom))]"
            : showFooter
              ? "scroll-pb-20 pb-20"
              : ""
        }`}
        style={scrollFadeStyle}
      >
        <div ref={contentRef} className="min-h-full">
          {remoteView ? <HostUsageStatus view={hostView} className="mb-2" /> : null}
          {visibleProviders.length === 0 ? (
            // ViscosityCode: "nothing tracked" only when nothing is; tracked but undetected yet shows nothing.
            remoteView || orderedProviders.length > 0 ? null : (
              <div className="flex min-h-full flex-col items-center justify-center gap-2 px-6 text-center">
                <p className="text-sm text-muted">
                  <Trans>No providers are being tracked.</Trans>
                </p>
                <button
                  type="button"
                  onClick={openSettings}
                  className="text-xs text-accent underline-offset-2 hover:underline"
                >
                  <Trans>Enable providers in settings</Trans>
                </button>
              </div>
            )
          ) : (
            <div className="flex flex-col gap-3">
              {currentProvider ? (
                <section aria-label={t`Current`} className="flex flex-col gap-1.5">
                  <p className="px-1 text-[10px] font-semibold uppercase tracking-wider text-muted/70">
                    <Trans>Current</Trans>
                  </p>
                  {renderCard(currentProvider, 0, false)}
                </section>
              ) : null}
              {sortableProviders.length > 0 ? (
                <DragDropProvider sensors={USAGE_SORT_SENSORS} onDragEnd={handleDragEnd}>
                  <div className="flex flex-col gap-2">
                    {sortableProviders.map((provider, index) => renderCard(provider, index))}
                  </div>
                </DragDropProvider>
              ) : null}
            </div>
          )}
        </div>
      </div>

      {showFooter ? (
        <div className="m-page-content pointer-events-none absolute bottom-0 left-0 right-1 z-10 flex justify-center [background-image:linear-gradient(to_top,var(--content-background)_35%,color-mix(in_oklab,var(--content-background)_70%,transparent)_65%,transparent)] px-3 pt-6 pb-2">
          {showPicker ? (
            <RemoteServerPicker
              value={effectiveDesktopId}
              includeLocal={!browserRuntime}
              onChange={setRequestedDesktopId}
              {...(lastUpdated > 0 ? { detail: formatUpdatedAgo(lastUpdated, nowTick, t) } : {})}
              buttonClassName={`${floatingBubblePillClass} pointer-events-auto max-w-[14rem] px-2.5`}
              opensUpward
            />
          ) : (
            <p className="text-[11px] text-muted/70">
              <Trans>Updated {formatUpdatedAgo(lastUpdated, nowTick, t)}</Trans>
            </p>
          )}
        </div>
      ) : null}

      {compact ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-10 grid grid-cols-[var(--m-floating-control-height)_minmax(0,1fr)_var(--m-floating-control-height)] items-center gap-[var(--m-floating-control-gap)] px-[var(--m-page-inline)]">
          <MobileCircleButton
            className="pointer-events-auto"
            aria-label={t`Usage settings`}
            onPress={openSettings}
          >
            <Settings2 className="size-4" />
          </MobileCircleButton>
          <RemoteServerPicker
            value={effectiveDesktopId}
            includeLocal={!browserRuntime}
            onChange={setRequestedDesktopId}
            buttonClassName="m-floating-selector pointer-events-auto w-full px-4 text-sm"
            opensUpward
          />
          <MobileCircleButton
            className="pointer-events-auto"
            aria-label={t`Refresh`}
            isDisabled={remoteView ? !hostView.canRefresh || hostRefreshing : isRefreshing}
            onPress={refreshNow}
          >
            <RefreshCw
              className={`size-4 ${(remoteView ? hostRefreshing : isRefreshing) ? "animate-spin" : ""}`}
            />
          </MobileCircleButton>
        </div>
      ) : null}
    </div>
  );
}
