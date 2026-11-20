/**
 * ViscosityCode: one cloud agent in the Cloud tab, and its detail (fork of
 * Poracode). The detail is read from the host when the row first expands.
 */
import { useEffect, useId, useState } from "react";
import { Button, Chip } from "@heroui/react";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { ChevronDown, ChevronRight, ExternalLink, GitBranch, GitPullRequest } from "lucide-react";
import { friendlyError } from "@/shared/messages";
import { parseAgentProfileKind } from "@/shared/contracts";
import { PixelLoader } from "@/renderer/components/common";
import { getProviderManifest } from "@/renderer/components/providers/providerManifest";
import { ProviderIcon } from "@/renderer/components/providers/ProviderIcon";
import type { TranslateFn } from "@/renderer/i18n/i18n";
import { openExternalWithFeedback } from "@/renderer/utils/openExternal";
import { formatUpdatedAgo } from "@/renderer/viscosity/subscriptions/ui/SubscriptionsDashboard";
import {
  cloudAgentsBridge,
  type CloudAgentDetail,
  type CloudAgentStatus,
  type CloudAgentSummary,
} from "../cloudAgentsContract";

/** Longest result excerpt the detail shows; the host already bounds it. */
const RESULT_EXCERPT_CHARS = 1_200;

export function cloudAgentStatusLabel(status: CloudAgentStatus, t: TranslateFn): string {
  switch (status) {
    case "running":
      return t(msg`Running`);
    case "finished":
      return t(msg`Finished`);
    case "error":
      return t(msg`Error`);
    case "cancelled":
      return t(msg`Cancelled`);
    case "expired":
      return t(msg`Expired`);
    case "idle":
      return t(msg`Idle`);
    case "unknown":
      return t(msg`Unknown`);
  }
}

function statusColor(status: CloudAgentStatus): "accent" | "success" | "danger" | "default" {
  if (status === "running") return "accent";
  if (status === "finished") return "success";
  if (status === "error") return "danger";
  return "default";
}

/** "github.com/acme/api" → "acme/api". */
export function repoShortName(url: string): string {
  const parts = url
    .replace(/^[a-z]+:\/\//iu, "")
    .replace(/\.git$/u, "")
    .split("/")
    .filter(Boolean);
  return parts.length >= 3 ? parts.slice(-2).join("/") : parts.join("/");
}

/** The provider's display name for a (profile) agent kind, for "Open in …". */
function providerName(agentKind: string, t: TranslateFn): string {
  const base = parseAgentProfileKind(agentKind)?.driver ?? agentKind;
  const manifest = getProviderManifest(base);
  return manifest ? t(manifest.label) : base;
}

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60
    ? `${minutes}m ${seconds % 60}s`
    : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function CloudAgentRow(props: {
  item: CloudAgentSummary;
  now: number;
  /** The thread that already follows this agent, if any. */
  followingThreadId: string | undefined;
  onFollow: () => void;
  onOpenThread: (threadId: string) => void;
  following: boolean;
}) {
  const { item, now, followingThreadId } = props;
  const { t } = useLingui();
  const [expanded, setExpanded] = useState(false);
  const detailId = useId();
  const updated = Date.parse(item.updatedAt);
  const repo = item.repos[0] ? repoShortName(item.repos[0].url) : undefined;
  const provider = providerName(item.agentKind, t);

  return (
    <li
      data-cloud-agent={item.id}
      className={`rounded-lg border border-border/15 bg-surface-secondary/30 ${
        item.archived ? "opacity-60" : ""
      }`}
    >
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={detailId}
        className="flex w-full min-w-0 items-center gap-2 rounded-lg px-3 py-2 text-left outline-none transition-colors hover:bg-surface-secondary/50 focus-visible:focus-ring"
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded ? (
          <ChevronDown aria-hidden="true" className="size-3.5 shrink-0 text-muted" />
        ) : (
          <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 text-muted" />
        )}
        <ProviderIcon kind={item.agentKind} className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-sm text-foreground">{item.name}</span>
        {followingThreadId ? (
          <Chip size="sm" variant="soft" color="accent" data-cloud-agent-following="">
            <Trans>Following</Trans>
          </Chip>
        ) : null}
        <Chip size="sm" variant="soft" color={statusColor(item.status)}>
          {item.archived ? t`Archived` : cloudAgentStatusLabel(item.status, t)}
        </Chip>
        {repo ? <span className="hidden truncate text-xs text-muted sm:inline">{repo}</span> : null}
        {Number.isFinite(updated) ? (
          <span className="shrink-0 text-[11px] text-muted/80">
            {formatUpdatedAgo(updated, now, t)}
          </span>
        ) : null}
      </button>
      {expanded ? (
        <div id={detailId} className="border-t border-border/10 px-3 py-2">
          {/* Keyed by updatedAt so the detail is read again when the agent changes on the host. */}
          <CloudAgentDetailView key={item.updatedAt} item={item} />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {followingThreadId ? (
              <Button
                size="sm"
                variant="secondary"
                className="h-7 min-h-7 px-2 text-xs"
                onPress={() => props.onOpenThread(followingThreadId)}
              >
                <Trans>Open thread</Trans>
              </Button>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                className="h-7 min-h-7 px-2 text-xs"
                isDisabled={props.following}
                onPress={props.onFollow}
              >
                {props.following ? <Trans>Following…</Trans> : <Trans>Follow</Trans>}
              </Button>
            )}
            {item.webUrl ? (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 min-h-7 gap-1 px-2 text-xs"
                onPress={() => openExternalWithFeedback(item.webUrl!)}
              >
                <ExternalLink aria-hidden="true" className="size-3.5" />
                <Trans>Open in {provider}</Trans>
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </li>
  );
}

function CloudAgentDetailView(props: { item: CloudAgentSummary }) {
  const { item } = props;
  const { t } = useLingui();
  const [detail, setDetail] = useState<CloudAgentDetail | undefined>(undefined);
  const [error, setError] = useState<unknown>(undefined);

  useEffect(() => {
    let cancelled = false;
    const bridge = cloudAgentsBridge();
    if (!bridge) return;
    bridge
      .getCloudAgent({ agentKind: item.agentKind, agentId: item.id })
      .then((next) => {
        if (!cancelled) setDetail(next);
      })
      .catch((next: unknown) => {
        if (!cancelled) setError(next);
      });
    return () => {
      cancelled = true;
    };
  }, [item.agentKind, item.id]);

  if (error !== undefined) {
    return <p className="text-xs text-danger">{friendlyError(error)}</p>;
  }
  if (!detail) {
    return (
      <div className="flex items-center py-2">
        <PixelLoader />
      </div>
    );
  }
  const run = detail.latestRun;
  const result = run?.result?.trim();
  const duration = run?.durationMs;
  const runStatus = run ? cloudAgentStatusLabel(run.status, t) : "";
  return (
    <div className="flex flex-col gap-1.5 text-xs">
      {item.summary ? <p className="text-muted">{item.summary}</p> : null}
      {run ? (
        <p className="text-muted">
          <Trans>Latest run: {runStatus}</Trans>
          {duration !== undefined ? ` · ${formatDuration(duration)}` : null}
        </p>
      ) : null}
      {result ? (
        <p className="whitespace-pre-wrap break-words text-foreground" data-cloud-agent-result="">
          {result.length > RESULT_EXCERPT_CHARS
            ? `${result.slice(0, RESULT_EXCERPT_CHARS)}…`
            : result}
        </p>
      ) : null}
      {detail.branches.map((branch) => (
        <div
          key={`${branch.repoUrl}\u0000${branch.branch ?? ""}`}
          className="flex flex-wrap items-center gap-2 text-muted"
        >
          <GitBranch aria-hidden="true" className="size-3.5" />
          <span className="truncate">
            {repoShortName(branch.repoUrl)}
            {branch.branch ? ` @ ${branch.branch}` : ""}
          </span>
          {branch.prUrl ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 min-h-6 gap-1 px-1.5 text-xs"
              onPress={() => openExternalWithFeedback(branch.prUrl!)}
            >
              <GitPullRequest aria-hidden="true" className="size-3.5" />
              <Trans>Open PR</Trans>
            </Button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
