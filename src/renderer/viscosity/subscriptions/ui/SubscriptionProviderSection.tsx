/**
 * ViscosityCode: one provider on the Subscriptions dashboard (fork of
 * Poracode), with its accounts nested under it. The provider's accent colour
 * (agent colours contract) marks its edge.
 */
import { useId } from "react";
import { Button, Chip } from "@heroui/react";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { UsersRound } from "lucide-react";
import { ProviderIcon } from "@/renderer/components/providers/ProviderIcon";
import { AGENT_ACCENT_CSS, agentKindAttribute } from "@/renderer/viscosity/agentColors/api";
import { openProviderAgentSettings } from "../subscriptionsActions";
import type { SubscriptionProvider } from "../subscriptionsModel";
import { SubscriptionAccountRow } from "./SubscriptionAccountRow";

export function SubscriptionProviderSection(props: {
  provider: SubscriptionProvider;
  now: number;
  /** Pools are this client's host settings, so the pool card can edit them. */
  canManagePools: boolean;
}) {
  const { provider, now, canManagePools } = props;
  const { t } = useLingui();
  const headingId = useId();
  const count = provider.accounts.length;
  const switchAtPercent = provider.pool?.switchAtPercent;

  return (
    <li
      data-subscription-provider={provider.id}
      {...agentKindAttribute(provider.id)}
      className="overflow-hidden rounded-xl border border-l-[3px] border-border/15 bg-surface-secondary/30"
      style={{ borderLeftColor: AGENT_ACCENT_CSS }}
    >
      <section aria-labelledby={headingId}>
        <header className="flex flex-wrap items-center gap-2 px-3 pt-2.5 pb-2">
          <ProviderIcon
            kind={provider.id}
            fallbackLabel={provider.label}
            className="size-4 shrink-0"
          />
          <h3 id={headingId} className="truncate text-sm font-semibold text-foreground">
            {provider.label}
          </h3>
          <span className="text-xs text-muted">
            <Plural value={count} one="# account" other="# accounts" />
          </span>
          {switchAtPercent !== undefined ? (
            <Chip size="sm" variant="soft" color="accent" data-subscription-pool="on">
              <Trans>Pool on · switches at {switchAtPercent}% used</Trans>
            </Chip>
          ) : null}
          {provider.supportsPool && canManagePools ? (
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto h-7 min-h-7 gap-1 px-2 text-xs"
              aria-label={t`Manage pool for ${provider.label}`}
              onPress={() => openProviderAgentSettings(provider.id)}
            >
              <UsersRound aria-hidden="true" className="size-3.5" />
              <Trans>Manage pool</Trans>
            </Button>
          ) : null}
        </header>
        <ul aria-label={t`${provider.label} accounts`} className="flex flex-col gap-1.5 px-3 pb-3">
          {provider.accounts.map((account) => (
            <SubscriptionAccountRow key={account.agentKind} account={account} now={now} />
          ))}
        </ul>
      </section>
    </li>
  );
}
