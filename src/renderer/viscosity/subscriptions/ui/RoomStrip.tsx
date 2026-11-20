/**
 * ViscosityCode: "Who has room right now" (fork of Poracode). Signed-in
 * accounts ranked by usage left, then the ones that are out with their reset
 * countdowns, so the owner can pick where to start the next task.
 */
import { useId } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { formatResetCountdown } from "@poracode/agents-usage/formatters";
import { ProviderIcon } from "@/renderer/components/providers/ProviderIcon";
import { usageToneColor } from "@/renderer/components/providers/usageTone";
import { agentKindAttribute } from "@/renderer/viscosity/agentColors/api";
import type { OutEntry, RoomEntry, RoomSummary } from "../subscriptionsModel";

function RoomItem(props: { entry: RoomEntry; rank: number }) {
  const { entry, rank } = props;
  const kind = entry.styleKind ?? entry.agentKind;
  return (
    // The ordered list already announces the rank, so the visible number is decorative.
    <li
      data-subscription-room={entry.agentKind}
      {...agentKindAttribute(kind)}
      className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full border border-border/15 bg-surface px-2 py-1 text-xs"
    >
      <span aria-hidden="true" className="tabular-nums text-muted">
        {rank}
      </span>
      <ProviderIcon kind={kind} fallbackLabel={entry.label} className="size-3.5 shrink-0" />
      <span className="truncate text-foreground">{entry.label}</span>
      <span
        className="shrink-0 tabular-nums"
        style={{ color: usageToneColor(100 - entry.percentLeft) }}
      >
        <Trans>{entry.percentLeft}% left</Trans>
      </span>
    </li>
  );
}

function OutItem(props: { entry: OutEntry; now: number }) {
  const { entry, now } = props;
  const resetIn = formatResetCountdown(entry.until, now);
  const kind = entry.styleKind ?? entry.agentKind;
  return (
    <li
      data-subscription-out={entry.agentKind}
      {...agentKindAttribute(kind)}
      className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full border border-border/10 px-2 py-1 text-xs text-muted"
    >
      <ProviderIcon
        kind={kind}
        fallbackLabel={entry.label}
        className="size-3.5 shrink-0 opacity-70"
      />
      <span className="truncate">{entry.label}</span>
      <span className="shrink-0 tabular-nums">
        {resetIn && resetIn !== "now" ? (
          <Trans>resets in {resetIn}</Trans>
        ) : (
          <Trans>out of usage</Trans>
        )}
      </span>
    </li>
  );
}

export function RoomStrip(props: { summary: RoomSummary; now: number }) {
  const { t } = useLingui();
  const headingId = useId();
  const { room, out } = props.summary;

  return (
    <section
      aria-labelledby={headingId}
      data-subscriptions-room=""
      className="rounded-xl border border-border/15 bg-surface-secondary/30 p-3"
    >
      <h3 id={headingId} className="text-xs font-semibold text-muted">
        <Trans>Who has room right now</Trans>
      </h3>
      {room.length > 0 ? (
        <ol aria-label={t`Accounts by usage left`} className="mt-2 flex flex-wrap gap-1.5">
          {room.map((entry, index) => (
            <RoomItem key={entry.usageId} entry={entry} rank={index + 1} />
          ))}
        </ol>
      ) : (
        <p className="mt-2 text-xs text-muted">
          <Trans>No signed-in account reports usage left right now.</Trans>
        </p>
      )}
      {out.length > 0 ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-muted">
            <Trans>Out of usage:</Trans>
          </span>
          <ul aria-label={t`Accounts out of usage`} className="flex flex-wrap gap-1.5">
            {out.map((entry) => (
              <OutItem key={entry.usageId} entry={entry} now={props.now} />
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
