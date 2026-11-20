/**
 * ViscosityCode: "Customize…" display overrides of real accounts (fork of
 * Poracode).
 *
 * The owner can type over a real account's provider name, plan, account
 * label and, when asked, usage bars. The dashboard's view model swaps those values in
 * after the real rows are built and ordered, so ordering, readiness and
 * pools stay real and nothing outside this dashboard's render path ever sees
 * an override (`subscriptionsIsolation.test.ts`). Nothing here knows a
 * provider by name: plan suggestions come from the provider manifest's
 * optional `subscriptionPlanNames` capability.
 */
import { usageWindowDisplayLabel } from "@poracode/agents-usage/formatters";
import { DEFAULT_SWITCH_AT_PERCENT, memberAvailability } from "@/shared/accountPools";
import { baseAgentKind, type UsageSnapshot } from "@/shared/contracts";
import { getProviderManifest } from "@/renderer/components/providers/providerManifest";
import { poolUsageTone, usagePercentLeft } from "@/renderer/viscosity/accountPools/poolModel";
import { pretendWindowId } from "./pretendSubscriptions";
import {
  snapshotHasUsageData,
  type SubscriptionAccount,
  type SubscriptionProvider,
} from "./subscriptionsModel";
import {
  MAX_PRETEND_BARS,
  PRETEND_PROVIDER_PREFIX,
  type PretendUsageBar,
  type SubscriptionOverride,
} from "./subscriptionsPrefs";

function sameName(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

/**
 * Kind whose icon and accent an overridden name borrows: none while the name
 * is still the real provider's (the real look stays), a known provider's kind,
 * or a kind no icon resolves for (a letter icon) for free text.
 */
function overrideStyleKind(
  name: string,
  realLabel: string,
  key: string,
  kindForName: (name: string) => string | undefined,
): string | undefined {
  if (sameName(name, realLabel)) return undefined;
  return kindForName(name) ?? `${PRETEND_PROVIDER_PREFIX}${key}`;
}

function overriddenSnapshot(
  account: SubscriptionAccount,
  override: SubscriptionOverride,
): UsageSnapshot | undefined {
  const base = account.snapshot;
  const bars = override.bars;
  if (!base && !bars && !override.plan) return undefined;
  // A typed account label replaces the real identity line; an unchanged one keeps it.
  const keepIdentity = !override.account || sameName(override.account, account.label);
  const plan = override.plan ? { plan: override.plan } : {};
  const identity =
    keepIdentity && base?.authenticatedAs !== undefined
      ? { authenticatedAs: base.authenticatedAs }
      : {};
  if (!bars) {
    // Real usage stays live: real windows, countdowns, status and errors.
    const source: UsageSnapshot = base ?? {
      providerId: account.usageId,
      status: "ok",
      fetchedAt: 0,
      windows: [],
    };
    const { plan: _realPlan, authenticatedAs: _realIdentity, ...real } = source;
    return { ...real, ...plan, ...identity };
  }
  return {
    providerId: base?.providerId ?? account.usageId,
    // Typed bars read as a healthy snapshot, like a pretend row.
    status: "ok",
    // The real fetch time keeps "Updated" honest about the real data.
    fetchedAt: base?.fetchedAt ?? 0,
    ...plan,
    ...identity,
    ...(base?.credits ? { credits: base.credits } : {}),
    windows: bars.map((bar, index) => ({
      id: pretendWindowId(index),
      label: bar.label,
      usedPercent: bar.usedPercent,
    })) as UsageSnapshot["windows"],
  };
}

function overriddenAccount(
  account: SubscriptionAccount,
  override: SubscriptionOverride,
  styleKind: string | undefined,
  now: number,
): SubscriptionAccount {
  const snapshot = overriddenSnapshot(account, override);
  const availability = memberAvailability(
    snapshot,
    now,
    account.pool?.switchAtPercent ?? DEFAULT_SWITCH_AT_PERCENT,
  );
  return {
    ...account,
    label: override.account ?? override.provider,
    snapshot,
    hasUsageData: snapshotHasUsageData(snapshot),
    availability,
    percentLeft: usagePercentLeft(snapshot, now),
    tone: poolUsageTone(availability),
    ...(styleKind ? { styleKind } : {}),
    // Typed bars carry typed reset text; live usage keeps the real countdowns.
    ...(override.bars
      ? {
          resetTexts: Object.fromEntries(
            override.bars.flatMap((bar, index) =>
              bar.reset ? [[pretendWindowId(index), bar.reset]] : [],
            ),
          ),
        }
      : {}),
  };
}

/**
 * Real rows with the owner's overrides drawn in. Apply after ordering so a
 * renamed provider keeps its place; pretend rows and accounts without an
 * override pass through, and overrides of missing accounts are ignored. A
 * section takes its name and icon from its first customized account.
 */
export function applySubscriptionOverrides(
  providers: readonly SubscriptionProvider[],
  overrides: readonly SubscriptionOverride[],
  now: number,
  kindForName: (name: string) => string | undefined,
): SubscriptionProvider[] {
  if (overrides.length === 0) return [...providers];
  const byKey = new Map(overrides.map((override) => [override.key, override]));
  return providers.map((provider) => {
    if (provider.pretendId !== undefined) return provider;
    let section: { label: string; styleKind: string | undefined } | undefined;
    const accounts = provider.accounts.map((account) => {
      const override = byKey.get(account.agentKind);
      if (!override) return account;
      const styleKind = overrideStyleKind(
        override.provider,
        provider.label,
        override.key,
        kindForName,
      );
      section ??= { label: override.provider, styleKind };
      return overriddenAccount(account, override, styleKind, now);
    });
    if (!section) return provider;
    return {
      ...provider,
      label: section.label,
      accounts,
      ...(section.styleKind ? { styleKind: section.styleKind } : {}),
    };
  });
}

/** The account a section's "Customize…" edits: the one that names it, else the first. */
export function sectionCustomizeAccount(
  provider: SubscriptionProvider,
  overrides: readonly SubscriptionOverride[],
): SubscriptionAccount | undefined {
  const keys = new Set(overrides.map((override) => override.key));
  return provider.accounts.find((account) => keys.has(account.agentKind)) ?? provider.accounts[0];
}

/**
 * The editor's starting values for a real account: its saved override, or
 * its real values (provider name, plan and account label) with its usage left
 * live. `realProviderLabel` is the name before overrides, so customizing a
 * second account never copies a section rename that "Reset to real" on the
 * first account could then not undo.
 */
export function overrideDraftSource(
  realProviderLabel: string,
  account: SubscriptionAccount,
  saved: SubscriptionOverride | undefined,
): SubscriptionOverride {
  if (saved) return saved;
  const plan = account.snapshot?.plan;
  return {
    key: account.agentKind,
    provider: realProviderLabel,
    ...(plan ? { plan } : {}),
    account: account.label,
  };
}

/**
 * Bars that start an account's typed usage: each shown window's name and
 * whole percent. No reset text: a countdown typed in now would go stale.
 */
export function realUsageBars(account: SubscriptionAccount): PretendUsageBar[] {
  return (account.snapshot?.windows ?? []).slice(0, MAX_PRETEND_BARS).map((window) => ({
    label: usageWindowDisplayLabel(window),
    usedPercent: Math.round(window.usedPercent),
  }));
}

/** Plan labels the real snapshots of a provider's accounts report now. */
export function seenPlanNames(
  providers: readonly SubscriptionProvider[],
  kind: string | undefined,
): string[] {
  if (!kind) return [];
  const base = baseAgentKind(kind);
  return providers.flatMap((provider) =>
    provider.pretendId === undefined && baseAgentKind(provider.id) === base
      ? provider.accounts.flatMap((account) =>
          account.snapshot?.plan ? [account.snapshot.plan] : [],
        )
      : [],
  );
}

/**
 * The plan picker's choices for a provider: its declared
 * `subscriptionPlanNames` (none when it declares none or is free text), then
 * plans seen in its real usage, without case-insensitive duplicates.
 */
export function subscriptionPlanSuggestions(
  kind: string | undefined,
  seen: readonly string[],
): string[] {
  const declared = kind ? (getProviderManifest(kind)?.subscriptionPlanNames ?? []) : [];
  const out: string[] = [];
  for (const name of [...declared, ...seen]) {
    if (!out.some((existing) => sameName(existing, name))) out.push(name);
  }
  return out;
}
