/**
 * ViscosityCode: account pool status bar item (fork of Poracode).
 *
 * When the focused thread runs on a pooled account, the bar shows
 * "<account> · 62% left", amber when the account is running low and red once
 * it counts as out (at the pool's "Switch at" level). Clicking opens that
 * account's usage. Hidden for unpooled threads, drafts and paired-host
 * threads (that host keeps its own pools). Subscribes with primitive
 * selectors so streaming never re-renders it.
 */
import { Button, Tooltip } from "@heroui/react";
import { plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { UsersRound } from "lucide-react";
import { formatResetCountdown } from "@poracode/agents-usage/formatters";
import { DEFAULT_SWITCH_AT_PERCENT } from "@/shared/accountPools";
import type { Thread } from "@/shared/contracts";
import { openUsagePanelForProvider } from "@/renderer/actions/panelActions";
import { selectFocusedThreadId } from "@/renderer/hooks/uiSelectors";
import { useAppStore } from "@/renderer/state/appStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { getThreadMap } from "@/renderer/state/useThread";
import { registerStatusBarItem } from "@/renderer/viscosity/layout/statusBar/statusBarRegistry";
import { useMinuteClock } from "./minuteClock";
import { usePoolMemberViews } from "./poolHooks";
import { activePoolFor, type PoolUsageTone } from "./poolModel";
import { useAccountPools } from "./poolSettings";

export const ACCOUNT_POOL_STATUS_ITEM_ID = "account-pool";

/** Right side, just before the agent/model item (100). */
const ACCOUNT_POOL_STATUS_ORDER = 95;

// Matches the built-in status bar items' class list.
const ITEM_CLASS = "vc-statusbar__item h-full min-w-0 shrink-0 gap-1 rounded-none px-2 font-normal";

type AppState = ReturnType<typeof useAppStore.getState>;

function focusedThread(state: AppState): Thread | undefined {
  const paneId = selectFocusedThreadId(state);
  return paneId ? getThreadMap(state.threads).get(paneId) : undefined;
}

/** The focused managed-host thread's agent kind; undefined for drafts and paired-host threads. */
export function selectFocusedManagedAgentKind(state: AppState): string | undefined {
  const thread = focusedThread(state);
  return thread && !thread.remoteServerId ? thread.agentKind : undefined;
}

export function selectFocusedIsTerminal(state: AppState): boolean {
  return focusedThread(state)?.presentationMode === "terminal";
}

/** The status bar's `data-tone` for a pool usage tone (amber "attention", red "error"). */
export function statusToneFor(tone: PoolUsageTone): "attention" | "error" | undefined {
  if (tone === "exhausted") return "error";
  if (tone === "low") return "attention";
  return undefined;
}

export function AccountPoolStatusItem() {
  const { t } = useLingui();
  const agentKind = useAppStore(selectFocusedManagedAgentKind);
  const isTerminal = useAppStore(selectFocusedIsTerminal);
  const pools = useAccountPools();
  const instances = useSharedSettings((state) => state.agentInstances);
  const now = useMinuteClock();
  const active = agentKind ? activePoolFor(agentKind, pools, instances) : undefined;
  const views = usePoolMemberViews(
    active && agentKind ? [agentKind] : [],
    active?.pool.switchAtPercent,
  );
  const view = views[0];
  if (!active || !view) return null;

  const percentLeft = view.percentLeft;
  const label = percentLeft === undefined ? view.label : t`${view.label} · ${percentLeft}% left`;
  const switchAt = active.pool.switchAtPercent ?? DEFAULT_SWITCH_AT_PERCENT;
  const count = active.members.length;
  const until = view.availability.kind === "exhausted" ? view.availability.until : undefined;
  const resetIn = formatResetCountdown(until, now);
  const details = [
    t`Account pool: ${plural(count, { one: "# account", other: "# accounts" })}, switches at ${switchAt}% used.`,
    view.tone === "exhausted"
      ? resetIn && resetIn !== "now"
        ? t`${view.label} is out of usage; it resets in ${resetIn}.`
        : t`${view.label} is out of usage.`
      : view.tone === "low"
        ? t`${view.label} is running low.`
        : undefined,
    isTerminal
      ? t`Terminal threads don't switch accounts automatically; use Continue in another provider.`
      : undefined,
  ]
    .filter((line): line is string => Boolean(line))
    .join(" ");
  const tone = statusToneFor(view.tone);

  return (
    <Tooltip delay={400}>
      <Tooltip.Trigger>
        <Button
          size="sm"
          variant="ghost"
          aria-label={t`${label}. ${details}`}
          data-vc-status-item={ACCOUNT_POOL_STATUS_ITEM_ID}
          data-pool-tone={view.tone}
          {...(tone ? { "data-tone": tone } : {})}
          className={`${ITEM_CLASS} inline-flex max-w-[32ch] items-center`}
          onPress={() => openUsagePanelForProvider(view.usageProviderId)}
        >
          <UsersRound aria-hidden="true" className="size-3 shrink-0" />
          <span className="truncate tabular-nums">{label}</span>
        </Button>
      </Tooltip.Trigger>
      <Tooltip.Content placement="top">{details}</Tooltip.Content>
    </Tooltip>
  );
}

let unregister: (() => void) | undefined;

/** Idempotent: registers the item once per renderer; returns its unregister. */
export function registerAccountPoolStatusBarItem(): () => void {
  unregister ??= registerStatusBarItem({
    id: ACCOUNT_POOL_STATUS_ITEM_ID,
    align: "right",
    order: ACCOUNT_POOL_STATUS_ORDER,
    component: AccountPoolStatusItem,
  });
  const current = unregister;
  return () => {
    current();
    if (unregister === current) unregister = undefined;
  };
}
