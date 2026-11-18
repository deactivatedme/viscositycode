/**
 * ViscosityCode: one account inside a provider on the Subscriptions dashboard
 * (fork of Poracode): plan, readiness, pool position, usage windows as bars
 * with reset countdowns, credits, or an honest "No usage data".
 */
import { useState } from "react";
import { Button, Chip } from "@heroui/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { LogIn, Settings2 } from "lucide-react";
import { formatResetCountdown } from "@poracode/agents-usage/formatters";
import { ProviderUsageCircle } from "@/renderer/components/providers/ProviderUsageCircle";
import {
  summarizeUsageSnapshot,
  UsageCreditsRow,
} from "@/renderer/components/providers/UsageProviderCardView";
import { UsageWindowBars } from "@/renderer/components/providers/UsageWindowBars";
import {
  sharedWindowResetLabel,
  usageStatusText,
} from "@/renderer/components/providers/usageFormat";
import { usesSharedWindowReset } from "@/renderer/components/providers/usageProviders";
import { agentKindAttribute } from "@/renderer/viscosity/agentColors/api";
import {
  canOpenLocalAgentSettings,
  canStartTerminalSignIn,
  openProviderAgentSettings,
  startAccountSignIn,
} from "../subscriptionsActions";
import type {
  AccountReadiness,
  SubscriptionAccount,
  SubscriptionPoolMembership,
} from "../subscriptionsModel";

function ReadinessChip(props: { readiness: AccountReadiness }) {
  switch (props.readiness) {
    case "signed-in":
      return (
        <Chip size="sm" variant="soft" color="success" data-subscription-readiness="signed-in">
          <Trans>Signed in</Trans>
        </Chip>
      );
    case "ready":
      return (
        <Chip size="sm" variant="soft" color="default" data-subscription-readiness="ready">
          <Trans>Ready</Trans>
        </Chip>
      );
    case "needs-sign-in":
      return (
        <Chip size="sm" variant="soft" color="warning" data-subscription-readiness="needs-sign-in">
          <Trans>Needs sign-in</Trans>
        </Chip>
      );
    case "disabled":
      return (
        <Chip size="sm" variant="soft" color="default" data-subscription-readiness="disabled">
          <Trans>Disabled</Trans>
        </Chip>
      );
    case "not-installed":
      return (
        <Chip size="sm" variant="soft" color="default" data-subscription-readiness="not-installed">
          <Trans>Not installed</Trans>
        </Chip>
      );
  }
}

function UsageBadge(props: { account: SubscriptionAccount; now: number }) {
  const { availability, tone } = props.account;
  if (availability.kind === "exhausted") {
    const resetIn = formatResetCountdown(availability.until, props.now);
    return (
      <Chip size="sm" variant="soft" color="danger" data-subscription-badge="exhausted">
        {resetIn && resetIn !== "now" ? (
          <Trans>Out of usage · resets in {resetIn}</Trans>
        ) : (
          <Trans>Out of usage</Trans>
        )}
      </Chip>
    );
  }
  if (tone === "low") {
    return (
      <Chip size="sm" variant="soft" color="warning" data-subscription-badge="low">
        <Trans>Running low</Trans>
      </Chip>
    );
  }
  return null;
}

/** "Pooled", with the account's place in the pool order and the switch rule. */
function PooledBadge(props: { pool: SubscriptionPoolMembership }) {
  const { position, size, switchAtPercent } = props.pool;
  return (
    <Chip size="sm" variant="soft" color="accent" data-subscription-badge="pooled">
      <Trans>
        Pooled · {position} of {size} · switches at {switchAtPercent}% used
      </Trans>
    </Chip>
  );
}

/** Why there is nothing to draw, in the most specific words available. */
function NoUsageData(props: { account: SubscriptionAccount; now: number }) {
  const { t } = useLingui();
  const { account } = props;
  const reason = !account.usageSupported
    ? t`This account doesn't report usage.`
    : !account.usageTracked
      ? t`Usage tracking is off for this account.`
      : account.snapshot
        ? usageStatusText(account.snapshot, account.label, account.usageId, props.now)
        : t`No usage reported yet.`;
  return (
    <p className="mt-1 text-xs text-muted" data-subscription-usage="none">
      <span className="font-medium text-foreground/80">
        <Trans>No usage data</Trans>
      </span>{" "}
      · {reason}
    </p>
  );
}

function SignInAction(props: { account: SubscriptionAccount }) {
  const { t } = useLingui();
  const { account } = props;
  const [pending, setPending] = useState(false);
  const status = account.status;
  if (canStartTerminalSignIn(status)) {
    return (
      <Button
        size="sm"
        variant="secondary"
        className="h-7 min-h-7 gap-1 px-2 text-xs"
        aria-label={t`Sign in to ${account.label}`}
        isDisabled={pending}
        onPress={() => {
          setPending(true);
          startAccountSignIn(status, account.usageId, () => setPending(false));
        }}
      >
        <LogIn aria-hidden="true" className="size-3.5" />
        <Trans>Sign in</Trans>
      </Button>
    );
  }
  // A browser client has no desktop settings for this host's sign-in.
  if (!canOpenLocalAgentSettings()) return null;
  return (
    <Button
      size="sm"
      variant="ghost"
      className="h-7 min-h-7 gap-1 px-2 text-xs"
      aria-label={t`Open sign-in settings for ${account.label}`}
      onPress={() => openProviderAgentSettings(account.agentKind)}
    >
      <Settings2 aria-hidden="true" className="size-3.5" />
      <Trans>Sign-in settings</Trans>
    </Button>
  );
}

export function SubscriptionAccountRow(props: { account: SubscriptionAccount; now: number }) {
  const { account, now } = props;
  const snapshot = account.snapshot;
  const windows = snapshot?.windows ?? [];
  const { credits } = summarizeUsageSnapshot(snapshot, false);
  const sharedReset = usesSharedWindowReset(account.usageId);
  const sharedResetIn = sharedReset ? sharedWindowResetLabel(snapshot, now) : undefined;
  const signedInAs = snapshot?.authenticatedAs;
  const plan = snapshot?.plan;
  const pool = account.pool;

  return (
    <li
      data-subscription-account={account.agentKind}
      data-subscription-tone={account.tone}
      {...agentKindAttribute(account.agentKind)}
      className="flex items-start gap-3 rounded-lg border border-border/15 bg-surface px-3 py-2.5"
    >
      <ProviderUsageCircle
        kind={account.usageId}
        windows={windows}
        size={24}
        showProviderIcon={false}
      />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="truncate text-sm font-medium text-foreground">{account.label}</span>
          {plan ? (
            <Chip size="sm" variant="tertiary" data-subscription-plan="">
              {plan}
            </Chip>
          ) : null}
          <ReadinessChip readiness={account.readiness} />
          {pool ? <PooledBadge pool={pool} /> : null}
          <UsageBadge account={account} now={now} />
        </div>
        {signedInAs && signedInAs !== account.label ? (
          <p className="mt-0.5 truncate text-[11px] text-muted">{signedInAs}</p>
        ) : null}
        {account.hasUsageData ? (
          <div className="mt-2 space-y-2">
            {windows.length > 0 ? (
              // Remounted once a minute: the bars read the clock at mount for
              // their reset countdowns.
              <UsageWindowBars
                key={now}
                windows={windows}
                showPace={false}
                showReset={!sharedReset}
              />
            ) : null}
            {sharedResetIn ? (
              <p className="text-[11px] tabular-nums text-muted">
                <Trans>Resets in {sharedResetIn}</Trans>
              </p>
            ) : null}
            {credits ? (
              <UsageCreditsRow credits={credits} showSeparator={windows.length > 0} />
            ) : null}
          </div>
        ) : (
          <NoUsageData account={account} now={now} />
        )}
      </div>
      {account.readiness === "needs-sign-in" ? (
        <div className="shrink-0">
          <SignInAction account={account} />
        </div>
      ) : null}
    </li>
  );
}
