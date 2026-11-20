/**
 * ViscosityCode: one provider on the Subscriptions dashboard (fork of
 * Poracode), with its accounts nested under it. The provider's accent colour
 * (agent colours contract) marks its edge. Sections are sortable by their
 * grip; the dashboard persists the order.
 */
import { useId } from "react";
import { useSortable } from "@dnd-kit/react/sortable";
import { Button, Chip } from "@heroui/react";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { GripVertical, Pencil, SlidersHorizontal, UsersRound } from "lucide-react";
import { ProviderIcon } from "@/renderer/components/providers/ProviderIcon";
import { AGENT_ACCENT_CSS, agentKindAttribute } from "@/renderer/viscosity/agentColors/api";
import { openProviderAgentSettings } from "../subscriptionsActions";
import type { SubscriptionProvider } from "../subscriptionsModel";
import { SubscriptionAccountRow } from "./SubscriptionAccountRow";

export const SUBSCRIPTION_SORTABLE_PREFIX = "subscription-provider:";

export function SubscriptionProviderSection(props: {
  provider: SubscriptionProvider;
  now: number;
  /** Pools are this client's host settings, so the pool card can edit them. */
  canManagePools: boolean;
  index: number;
  /** Two or more providers: show the drag grip. */
  reorderable: boolean;
  onEditPretend: (pretendId: string) => void;
  /** Customize a real account's look; without an account, the section's. */
  onCustomize: (agentKind?: string) => void;
}) {
  const { provider, now, canManagePools, index, reorderable, onEditPretend, onCustomize } = props;
  const { t } = useLingui();
  const headingId = useId();
  const count = provider.accounts.length;
  const switchAtPercent = provider.pool?.switchAtPercent;
  const styleKind = provider.styleKind ?? provider.id;
  const pretendId = provider.pretendId;
  const { ref, handleRef, isDragging } = useSortable({
    id: `${SUBSCRIPTION_SORTABLE_PREFIX}${provider.id}`,
    index,
    type: "subscription-provider",
    accept: ["subscription-provider"],
    group: "subscription-provider",
  });

  return (
    <li
      ref={ref}
      data-subscription-provider={provider.id}
      {...agentKindAttribute(styleKind)}
      className={`overflow-hidden rounded-xl border border-l-[3px] border-border/15 bg-surface-secondary/30 ${
        isDragging ? "opacity-40" : ""
      }`}
      style={{ borderLeftColor: AGENT_ACCENT_CSS }}
    >
      <section aria-labelledby={headingId}>
        <header className="flex flex-wrap items-center gap-2 px-3 pt-2.5 pb-2">
          {reorderable ? (
            // A plain button: the drag handle needs a raw DOM ref, and React
            // Aria's press handling would swallow the Space that starts a keyboard drag.
            <button
              ref={handleRef}
              type="button"
              aria-label={t`Reorder ${provider.label}`}
              className="-ml-1 flex size-4 shrink-0 cursor-grab items-center justify-center rounded text-muted/60 outline-none transition-colors hover:text-foreground focus-visible:focus-ring active:cursor-grabbing"
            >
              <GripVertical aria-hidden="true" className="size-3.5" />
            </button>
          ) : null}
          <ProviderIcon
            kind={styleKind}
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
          {pretendId !== undefined ? (
            <Button
              size="sm"
              variant="ghost"
              isIconOnly
              className="ml-auto size-7 min-h-7 min-w-7 text-muted"
              aria-label={t`Edit ${provider.label}`}
              onPress={() => onEditPretend(pretendId)}
            >
              <Pencil aria-hidden="true" className="size-3.5" />
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              isIconOnly
              className={`size-7 min-h-7 min-w-7 text-muted ${
                provider.supportsPool && canManagePools ? "" : "ml-auto"
              }`}
              aria-label={t`Customize ${provider.label}…`}
              onPress={() => onCustomize()}
            >
              <SlidersHorizontal aria-hidden="true" className="size-3.5" />
            </Button>
          )}
        </header>
        <ul aria-label={t`${provider.label} accounts`} className="flex flex-col gap-1.5 px-3 pb-3">
          {provider.accounts.map((account) => (
            <SubscriptionAccountRow
              key={account.agentKind}
              account={account}
              now={now}
              {...(pretendId === undefined
                ? { onCustomize: () => onCustomize(account.agentKind) }
                : {})}
            />
          ))}
        </ul>
      </section>
    </li>
  );
}
