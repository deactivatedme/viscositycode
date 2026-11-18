/**
 * ViscosityCode: the "Account pool" card on a multi-account provider's
 * profile list (fork of Poracode).
 *
 * The owner turns the pool on, orders the accounts (drag or arrows), and picks
 * how early an account counts as out. Each row shows that account's live
 * usage, so the order and the threshold can be judged at a glance. Writes go
 * through the shared settings store (`poolSettings.ts`), so the host failover
 * policy, other clients and background threads see the same pool.
 */
import { DragDropProvider, type DragEndEvent } from "@dnd-kit/react";
import { isSortable, useSortable } from "@dnd-kit/react/sortable";
import { Button, Chip, toast } from "@heroui/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { ChevronDown, ChevronUp, GripVertical } from "lucide-react";
import { formatResetCountdown } from "@poracode/agents-usage/formatters";
import { DEFAULT_SWITCH_AT_PERCENT } from "@/shared/accountPools";
import { Select } from "@/renderer/components/common/Select";
import { ToggleSwitch } from "@/renderer/components/common/ToggleSwitch";
import { ProviderUsageCircle } from "@/renderer/components/providers/ProviderUsageCircle";
import { UsageWindowBars } from "@/renderer/components/providers/UsageWindowBars";
import { SettingRow } from "@/renderer/views/SettingsOverlay/parts/SettingsForm";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { useMinuteClock } from "./minuteClock";
import { usePoolMemberViews } from "./poolHooks";
import {
  driverAccountKinds,
  moveMember,
  reorderMember,
  resolvePoolOrder,
  SWITCH_AT_PERCENT_OPTIONS,
  updatedPool,
  type PoolMemberView,
} from "./poolModel";
import { useAccountPools, useCanWriteAccountPools, writeAccountPool } from "./poolSettings";

const SORTABLE_TYPE = "account-pool-member";

function PoolMemberRow(props: {
  view: PoolMemberView;
  index: number;
  count: number;
  now: number;
  onMove: (delta: number) => void;
}) {
  const { view, index, count, now } = props;
  const { t } = useLingui();
  const { ref, handleRef, isDragging } = useSortable({
    id: `${SORTABLE_TYPE}:${view.agentKind}`,
    index,
    type: SORTABLE_TYPE,
    accept: [SORTABLE_TYPE],
    group: SORTABLE_TYPE,
    data: { kind: view.agentKind },
  });
  const windows = view.snapshot?.windows ?? [];
  const until = view.availability.kind === "exhausted" ? view.availability.until : undefined;
  const resetIn = formatResetCountdown(until, now);

  return (
    <li
      ref={ref}
      data-pool-member={view.agentKind}
      className={`flex items-start gap-2 rounded-lg border border-border/15 bg-surface px-2 py-2 text-xs ${
        isDragging ? "opacity-40" : ""
      }`}
    >
      <button
        ref={handleRef}
        type="button"
        aria-label={t`Reorder ${view.label}`}
        className="mt-1 flex size-4 shrink-0 cursor-grab items-center justify-center text-muted/60 transition-colors hover:text-foreground active:cursor-grabbing"
      >
        <GripVertical className="size-3.5" />
      </button>
      <span aria-hidden="true" className="mt-0.5 w-3 shrink-0 text-right tabular-nums text-muted">
        {index + 1}
      </span>
      <ProviderUsageCircle
        kind={view.usageProviderId}
        windows={view.snapshot?.windows}
        size={20}
        showProviderIcon={false}
      />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="truncate text-sm font-medium text-foreground">{view.label}</span>
          {view.availability.kind === "exhausted" ? (
            <Chip size="sm" variant="soft" color="danger" data-pool-badge="exhausted">
              {resetIn && resetIn !== "now" ? (
                <Trans>Out of usage · resets in {resetIn}</Trans>
              ) : (
                <Trans>Out of usage</Trans>
              )}
            </Chip>
          ) : view.tone === "low" ? (
            <Chip size="sm" variant="soft" color="warning" data-pool-badge="low">
              <Trans>Running low</Trans>
            </Chip>
          ) : null}
          {!view.ready ? (
            <Chip size="sm" variant="soft" color="default" data-pool-badge="not-ready">
              <Trans>Not signed in</Trans>
            </Chip>
          ) : null}
        </div>
        {windows.length > 0 ? (
          <UsageWindowBars windows={windows} showPace={false} className="mt-1.5" />
        ) : (
          <p className="mt-0.5 text-[11px] text-muted">
            {view.usageTracked ? (
              <Trans>No usage reported yet.</Trans>
            ) : (
              <Trans>Usage tracking is off for this account.</Trans>
            )}
          </p>
        )}
      </div>
      <div className="flex shrink-0 flex-col">
        <Button
          isIconOnly
          size="sm"
          variant="ghost"
          aria-label={t`Move ${view.label} up`}
          className="h-5 w-6 min-w-6"
          isDisabled={index === 0}
          onPress={() => props.onMove(-1)}
        >
          <ChevronUp className="size-3" />
        </Button>
        <Button
          isIconOnly
          size="sm"
          variant="ghost"
          aria-label={t`Move ${view.label} down`}
          className="h-5 w-6 min-w-6"
          isDisabled={index === count - 1}
          onPress={() => props.onMove(1)}
        >
          <ChevronDown className="size-3" />
        </Button>
      </div>
    </li>
  );
}

export function AccountPoolCard(props: { driver: string }) {
  const { driver } = props;
  const { t } = useLingui();
  const pools = useAccountPools();
  const instances = useSharedSettings((state) => state.agentInstances);
  const now = useMinuteClock();
  const pool = pools[driver];
  const order = resolvePoolOrder(pool?.members, driverAccountKinds(driver, instances));
  const enabled = pool?.enabled === true;
  const views = usePoolMemberViews(enabled ? order : [], pool?.switchAtPercent);
  const switchAt = pool?.switchAtPercent ?? DEFAULT_SWITCH_AT_PERCENT;
  const canWrite = useCanWriteAccountPools();

  if (!canWrite) return null;
  if (order.length < 2) {
    return (
      <p data-account-pool={driver} className="mt-3 text-[11px] text-muted">
        <Trans>Add another profile to use your accounts as a pool.</Trans>
      </p>
    );
  }

  const save = (
    nextOrder: readonly string[],
    patch: { enabled?: boolean; switchAtPercent?: number } = {},
  ) => {
    if (!writeAccountPool(driver, updatedPool(pool, nextOrder, patch))) {
      toast.danger(t`Account pool settings couldn't be saved.`);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    if (event.canceled) return;
    const source = event.operation.source;
    if (!source || !isSortable(source)) return;
    const next = reorderMember(order, source.initialIndex, source.index);
    if (next.join("\n") !== order.join("\n")) save(next);
  };

  const switchAtOptions = SWITCH_AT_PERCENT_OPTIONS.map((percent) => ({
    id: String(percent),
    label: percent === 100 ? t`When fully used (100%)` : t`At ${percent}% used`,
  }));
  const toggleLabel = t`Use these accounts as a pool (switch automatically when one runs out)`;

  return (
    <section
      data-account-pool={driver}
      aria-label={t`Account pool`}
      className="mt-4 rounded-xl border border-border/15 bg-surface-secondary/30 p-3"
    >
      {/* The shared settings row, so the card reflows like every other row on narrow settings. */}
      <SettingRow title={t`Account pool`} description={toggleLabel}>
        <ToggleSwitch
          aria-label={toggleLabel}
          isSelected={enabled}
          onChange={(next) => save(order, { enabled: next })}
        />
      </SettingRow>

      {/* The order and threshold only matter once the pool is on. */}
      {enabled ? (
        <div>
          <SettingRow
            className="mt-3"
            title={t`Switch at`}
            description={
              <Trans>An account counts as out once any usage window reaches this level.</Trans>
            }
          >
            <Select
              aria-label={t`Switch at`}
              className="w-[170px] shrink-0"
              options={switchAtOptions}
              value={String(switchAt)}
              onChange={(value) => {
                const percent = Number(value);
                if (Number.isFinite(percent) && percent !== switchAt) {
                  save(order, { switchAtPercent: percent });
                }
              }}
            />
          </SettingRow>

          <p className="mt-3 text-[11px] text-muted">
            <Trans>
              New threads start on the account with the most usage left. When one runs out, work
              moves to the next account in this order.
            </Trans>
          </p>
          <DragDropProvider onDragEnd={handleDragEnd}>
            <ol aria-label={t`Pool order`} className="mt-1.5 flex flex-col gap-1.5">
              {views.map((view, index) => (
                <PoolMemberRow
                  key={view.agentKind}
                  view={view}
                  index={index}
                  count={views.length}
                  now={now}
                  onMove={(delta) => {
                    const next = moveMember(order, view.agentKind, delta);
                    if (next.join("\n") !== order.join("\n")) save(next);
                  }}
                />
              ))}
            </ol>
          </DragDropProvider>
          <p className="mt-2 text-[11px] text-muted">
            <Trans>
              Chat threads continue on the next account with the conversation handed over. Terminal
              threads stay on their account; use Continue in another provider to move them.
            </Trans>
          </p>
        </div>
      ) : null}
    </section>
  );
}
