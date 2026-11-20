/**
 * ViscosityCode: the Cloud tab of Mission Control (fork of Poracode).
 *
 * Lists every agent the host's cloud sources can see, one section per cloud
 * profile, with status, branch and pull request links, Follow (turns an agent
 * into a thread) and New cloud agent. Desktop host only: a remote session or a
 * host without the cloud procedures gets a short explanation instead.
 */
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@heroui/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Plus, RefreshCw } from "lucide-react";
import { friendlyError } from "@/shared/messages";
import { isRemoteSession } from "@/renderer/bridge";
import { openThread } from "@/renderer/actions/threadActions";
import { PixelLoader, ToggleSwitch } from "@/renderer/components/common";
import { useAppStore } from "@/renderer/state/appStore";
import { usePanelStore } from "@/renderer/state/panelStore";
import { useMinuteClock } from "@/renderer/viscosity/accountPools/minuteClock";
import { useAccountLabelResolver } from "@/renderer/viscosity/accountPools/poolHooks";
import { formatUpdatedAgo } from "@/renderer/viscosity/subscriptions/ui/SubscriptionsDashboard";
import { findFollowingThread, followCloudAgent, startNewCloudAgent } from "../cloudAgentsActions";
import type { CloudAgentSourceListing } from "../cloudAgentsContract";
import { useCloudAgentSetupHints } from "../cloudSetupHints";
import { useCloudAgents } from "../useCloudAgents";
import { CloudAgentRow } from "./CloudAgentRow";

function openAgentSettings(agentKind: string): void {
  usePanelStore.getState().openSettingsSection(`agents:${agentKind}`);
}

/** When a rate-limited source may be asked again, in epoch ms. */
function retryAt(source: CloudAgentSourceListing, fetchedAt: number): number | undefined {
  return source.error?.code === "rate_limited"
    ? fetchedAt + (source.error.retryAfterMs ?? 60_000)
    : undefined;
}

/** A one-second clock while `active`, for the rate-limit countdown. */
function useSecondClock(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

function Centered(props: { children: ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center px-6 py-8">
      <div className="flex max-w-md flex-col items-center gap-3 text-center text-sm text-muted">
        {props.children}
      </div>
    </div>
  );
}

export function CloudAgentsPanel() {
  if (isRemoteSession()) {
    return (
      <Centered>
        <p data-cloud-agents-remote="">
          <Trans>
            Cloud agents can't be listed here yet. Cloud threads still appear in your thread list.
          </Trans>
        </p>
      </Centered>
    );
  }
  return <CloudAgentsList />;
}

function CloudAgentsList() {
  const { t } = useLingui();
  const { unsupported, result, error, loading, refresh, loadMore } = useCloudAgents();
  const minuteNow = useMinuteClock();
  const threads = useAppStore((state) => state.threads);
  const labelFor = useAccountLabelResolver();
  const hints = useCloudAgentSetupHints();
  const [showArchived, setShowArchived] = useState(false);
  const [followingIds, setFollowingIds] = useState<ReadonlySet<string>>(new Set());
  const fetchedAt = result?.fetchedAt ?? 0;
  const retryTimes = (result?.sources ?? [])
    .map((source) => retryAt(source, fetchedAt))
    .filter((value): value is number => value !== undefined);
  const secondNow = useSecondClock(retryTimes.length > 0);
  const now = Math.max(minuteNow, secondNow);
  const nextRetry = retryTimes.length > 0 ? Math.max(...retryTimes) : undefined;
  const retrySeconds = nextRetry !== undefined ? Math.ceil((nextRetry - now) / 1000) : 0;
  const updatedAgo = fetchedAt > 0 ? formatUpdatedAgo(fetchedAt, now, t) : "";

  if (unsupported) {
    return (
      <Centered>
        <p data-cloud-agents-unsupported="">
          <Trans>This host cannot list cloud agents yet. Update ViscosityCode to use them.</Trans>
        </p>
      </Centered>
    );
  }
  if (!result) {
    if (error !== undefined && !loading) {
      return (
        <Centered>
          <p className="text-danger">{friendlyError(error)}</p>
          <Button size="sm" variant="secondary" onPress={refresh}>
            <Trans>Try again</Trans>
          </Button>
        </Centered>
      );
    }
    return (
      <Centered>
        <PixelLoader />
      </Centered>
    );
  }

  if (result.sources.length === 0) {
    return (
      <Centered>
        <p className="text-sm font-medium text-foreground" data-cloud-agents-setup="">
          <Trans>Run agents in the cloud</Trans>
        </p>
        <p>
          <Trans>
            Cloud agents keep working on a provider's servers while this computer is busy or asleep.
            Set one of your agent profiles to run in the cloud to see its agents here.
          </Trans>
        </p>
        {hints.map(({ id, Hint }) => (
          <div key={id} className="text-xs">
            <Hint openAgentSettings={openAgentSettings} />
          </div>
        ))}
      </Centered>
    );
  }

  const follow = async (key: string, run: () => Promise<unknown>) => {
    setFollowingIds((current) => new Set(current).add(key));
    try {
      await run();
    } finally {
      setFollowingIds((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  };

  return (
    <div data-vc-cloud-agents="" className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border/15 px-4 py-2.5">
        <p className="min-w-0 flex-1 text-xs text-muted">
          <Trans>
            Agents running in the cloud. Follow one to read and steer it as a thread here.
          </Trans>
        </p>
        <ToggleSwitch isSelected={showArchived} onChange={setShowArchived}>
          <span className="text-xs text-muted">
            <Trans>Show archived</Trans>
          </span>
        </ToggleSwitch>
        {retrySeconds > 0 ? (
          <span className="text-[11px] text-muted/80" data-cloud-agents-retry="">
            <Trans>Retry in {retrySeconds} s</Trans>
          </span>
        ) : updatedAgo ? (
          <span className="text-[11px] text-muted/80">
            <Trans>Updated {updatedAgo}</Trans>
          </span>
        ) : null}
        <Button
          size="sm"
          variant="secondary"
          className="h-7 min-h-7 gap-1 px-2 text-xs"
          aria-label={t`Refresh cloud agents`}
          isDisabled={loading || retrySeconds > 0}
          onPress={refresh}
        >
          <RefreshCw aria-hidden="true" className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
          <Trans>Refresh</Trans>
        </Button>
      </div>
      {error !== undefined ? (
        <p className="px-4 pt-2 text-xs text-warning">{friendlyError(error)}</p>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 [scrollbar-gutter:stable]">
        <div className="mx-auto flex max-w-5xl flex-col gap-4">
          {result.sources.map((source) => {
            const label = labelFor(source.agentKind);
            const items = source.items.filter((item) => showArchived || !item.archived);
            const sourceRetry = retryAt(source, fetchedAt);
            const sourceSeconds =
              sourceRetry !== undefined ? Math.max(0, Math.ceil((sourceRetry - now) / 1000)) : 0;
            return (
              <section
                key={source.agentKind}
                data-cloud-source={source.agentKind}
                aria-label={label}
                className="flex flex-col gap-2"
              >
                <header className="flex items-center gap-2">
                  <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
                    {label}
                  </h3>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 min-h-7 gap-1 px-2 text-xs"
                    onPress={() => void startNewCloudAgent(source.agentKind)}
                  >
                    <Plus aria-hidden="true" className="size-3.5" />
                    <Trans>New cloud agent</Trans>
                  </Button>
                </header>
                {source.error ? (
                  <SourceError source={source} label={label} seconds={sourceSeconds} />
                ) : null}
                {items.length > 0 ? (
                  <ul className="flex flex-col gap-1.5">
                    {items.map((item) => {
                      const key = `${item.agentKind}\u0000${item.id}`;
                      return (
                        <CloudAgentRow
                          key={item.id}
                          item={item}
                          now={now}
                          followingThreadId={findFollowingThread(item, threads)?.id}
                          following={followingIds.has(key)}
                          onFollow={() => void follow(key, () => followCloudAgent(item))}
                          onOpenThread={(threadId) => openThread(threadId)}
                        />
                      );
                    })}
                  </ul>
                ) : !source.error ? (
                  <p className="py-2 text-xs text-muted" data-cloud-source-empty="">
                    <Trans>No cloud agents yet.</Trans>
                  </p>
                ) : null}
                {source.nextCursor ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 min-h-7 self-start px-2 text-xs"
                    onPress={() => loadMore(source.agentKind)}
                  >
                    <Trans>Load more</Trans>
                  </Button>
                ) : null}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function SourceError(props: { source: CloudAgentSourceListing; label: string; seconds: number }) {
  const { source, label, seconds } = props;
  const code = source.error?.code;
  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-foreground"
      data-cloud-source-error={code}
    >
      <p className="min-w-0 flex-1">
        {code === "auth" ? (
          <Trans>
            The API key for {label} was rejected. Add a valid key in Settings → Agents → {label}.
          </Trans>
        ) : code === "plan" ? (
          <Trans>Your plan or team does not allow cloud agents through the API for {label}.</Trans>
        ) : code === "rate_limited" ? (
          seconds > 0 ? (
            <Trans>The provider asked us to slow down. Retrying in {seconds} s.</Trans>
          ) : (
            <Trans>The provider asked us to slow down. Retrying soon.</Trans>
          )
        ) : (
          <Trans>Cloud agents for {label} are unavailable right now. Showing the last list.</Trans>
        )}
      </p>
      {code === "auth" || code === "plan" ? (
        <Button
          size="sm"
          variant="ghost"
          className="h-7 min-h-7 px-2 text-xs"
          onPress={() => openAgentSettings(source.agentKind)}
        >
          <Trans>Check key</Trans>
        </Button>
      ) : null}
    </div>
  );
}
