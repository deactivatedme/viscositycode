/**
 * ViscosityCode: account pools, renderer model (fork of Poracode).
 *
 * Pure helpers the pool settings card, the draft composer, the status bar item
 * and Roundtable share. Decisions come from `src/shared/accountPools.ts` (the
 * same core the host failover service uses), so every surface agrees with the
 * host about which account is best and which ones are out. Nothing here knows
 * a provider by name: accounts are a profile driver's base kind plus its
 * `<driver>:<id>` profile kinds.
 */
import {
  accountPoolSchema,
  bestPoolMember,
  creditBalanceExhausted,
  DEFAULT_SWITCH_AT_PERCENT,
  MIN_POOL_MEMBERS_IN_USE,
  poolMembersInUse,
  poolMemberStates,
  type AccountPool,
  type AccountPools,
  type MemberAvailability,
  type PoolMemberState,
} from "@/shared/accountPools";
import {
  agentProfileKind,
  baseAgentKind,
  isAgentProfileDriver,
  type AgentInstanceConfigMap,
  type AgentStatus,
  type UsageSnapshot,
} from "@/shared/contracts";

/** "Switch at" choices offered in settings, in percent of any usage window. */
export const SWITCH_AT_PERCENT_OPTIONS = [100, 95, 90] as const;

/** Most members a pool can hold (mirrors `accountPoolSchema.members.max`). */
export const MAX_POOL_MEMBERS = 16;

/** Headroom (percent) at or below which an available account reads as "running low". */
export const LOW_HEADROOM_PERCENT = 20;

/**
 * Every account a profile driver can pool, in a stable default order: the
 * base account first, then its enabled profiles by name.
 */
export function driverAccountKinds(
  driver: string,
  instances: AgentInstanceConfigMap | undefined,
): string[] {
  const profiles = Object.values(instances ?? {})
    .filter((instance) => instance.driver === driver && instance.enabled !== false)
    .toSorted((left, right) =>
      (left.displayName ?? left.id).localeCompare(right.displayName ?? right.id),
    )
    .map((instance) => agentProfileKind(driver, instance.id));
  return [driver, ...profiles];
}

/**
 * The owner's saved member order resolved against the accounts that exist
 * now: saved members that still exist (first occurrence wins), then any
 * account the pool has not listed yet, in the driver's default order.
 */
export function resolvePoolOrder(
  members: readonly string[] | undefined,
  accounts: readonly string[],
): string[] {
  const existing = new Set(accounts);
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const kind of members ?? []) {
    if (!existing.has(kind) || seen.has(kind)) continue;
    seen.add(kind);
    ordered.push(kind);
  }
  for (const kind of accounts) {
    if (!seen.has(kind)) ordered.push(kind);
  }
  return ordered.slice(0, MAX_POOL_MEMBERS);
}

/** `order` with `kind` moved by `delta` places (clamped); unchanged when it can't move. */
export function moveMember(order: readonly string[], kind: string, delta: number): string[] {
  const from = order.indexOf(kind);
  if (from < 0) return [...order];
  const to = Math.max(0, Math.min(order.length - 1, from + delta));
  return reorderMember(order, from, to);
}

/** `order` with the item at `from` moved to index `to`; unchanged for out-of-range indexes. */
export function reorderMember(order: readonly string[], from: number, to: number): string[] {
  const next = [...order];
  if (from === to || from < 0 || to < 0 || from >= next.length || to >= next.length) return next;
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return [...order];
  next.splice(to, 0, moved);
  return next;
}

/**
 * The pool for `driver` with a new member order / toggle / threshold /
 * exclusion list applied. The full resolved order is always written, so the
 * host sees every account the owner sees in settings; accounts the owner left
 * out stay in that order and are listed in `excludedMembers` (absent when
 * none, so a pool without exclusions keeps its pre-exclusion shape).
 */
export function updatedPool(
  current: AccountPool | undefined,
  order: readonly string[],
  patch: Partial<Pick<AccountPool, "enabled" | "switchAtPercent" | "excludedMembers">> = {},
): AccountPool {
  const switchAtPercent = patch.switchAtPercent ?? current?.switchAtPercent;
  const members = order.slice(0, MAX_POOL_MEMBERS);
  const excluded = (patch.excludedMembers ?? current?.excludedMembers ?? []).filter(
    (kind, index, list) => members.includes(kind) && list.indexOf(kind) === index,
  );
  return accountPoolSchema.parse({
    enabled: patch.enabled ?? current?.enabled ?? false,
    members,
    ...(switchAtPercent !== undefined && switchAtPercent !== DEFAULT_SWITCH_AT_PERCENT
      ? { switchAtPercent }
      : {}),
    ...(excluded.length > 0 ? { excludedMembers: excluded } : {}),
  });
}

/** The exclusion list with `kind` included in (or left out of) the pool. */
export function withMemberIncluded(
  pool: AccountPool | undefined,
  kind: string,
  included: boolean,
): string[] {
  const excluded = (pool?.excludedMembers ?? []).filter((member) => member !== kind);
  return included ? excluded : [...excluded, kind];
}

/**
 * An enabled pool's members in use as every reader (the host included)
 * resolves them (`poolMembersInUse`: no duplicates, no removed or foreign
 * profiles, none the owner left out), or undefined when the pool is off or
 * has fewer than two such members: a pool of one has nothing to switch to.
 */
export function enabledPoolMembers(
  driver: string,
  pool: AccountPool | undefined,
  instances: AgentInstanceConfigMap | undefined,
): string[] | undefined {
  if (!pool?.enabled || !isAgentProfileDriver(driver)) return undefined;
  const members = poolMembersInUse(driver, pool, instances ?? {});
  return members.length >= MIN_POOL_MEMBERS_IN_USE ? members : undefined;
}

/**
 * The enabled pool `agentKind` belongs to, with its members resolved against
 * the accounts that exist now, or undefined when the kind is not pooled.
 */
export function activePoolFor(
  agentKind: string,
  pools: AccountPools,
  instances: AgentInstanceConfigMap | undefined,
): { driver: string; pool: AccountPool; members: string[] } | undefined {
  const driver = baseAgentKind(agentKind);
  const pool = Object.hasOwn(pools, driver) ? pools[driver] : undefined;
  const members = enabledPoolMembers(driver, pool, instances);
  if (!pool || !members?.includes(agentKind)) return undefined;
  return { driver, pool, members };
}

/**
 * Usage left on an account, in percent of its most-used live window
 * (`100 - usedPercent`), 0 when a credit-only account's balance ran out
 * (`creditBalanceExhausted`), or undefined when the latest snapshot can't say
 * (no snapshot, a polling hiccup, no windows).
 */
export function usagePercentLeft(
  snapshot: UsageSnapshot | undefined,
  now: number,
): number | undefined {
  if (!snapshot || snapshot.status !== "ok") return undefined;
  if (creditBalanceExhausted(snapshot)) return 0;
  let worst: number | undefined;
  for (const window of snapshot.windows) {
    if (window.resetsAt !== undefined && window.resetsAt <= now) continue;
    worst = Math.max(worst ?? 0, window.usedPercent);
  }
  if (worst === undefined) return undefined;
  return Math.max(0, Math.min(100, Math.round(100 - worst)));
}

export type PoolUsageTone = "ok" | "low" | "exhausted" | "unknown";

/** How urgent an account's usage reads: red when out, amber when running low. */
export function poolUsageTone(availability: MemberAvailability): PoolUsageTone {
  if (availability.kind === "exhausted") return "exhausted";
  if (availability.kind === "unknown") return "unknown";
  return availability.headroomPercent <= LOW_HEADROOM_PERCENT ? "low" : "ok";
}

export interface PoolMemberView extends PoolMemberState {
  label: string;
  /** Usage snapshot id that meters this account. */
  usageProviderId: string;
  snapshot: UsageSnapshot | undefined;
  percentLeft: number | undefined;
  tone: PoolUsageTone;
  /** False when usage for this account is not collected (the owner turned it off). */
  usageTracked: boolean;
}

export interface PoolMemberViewInput {
  order: readonly string[];
  statuses: readonly AgentStatus[];
  disabledAgents: readonly string[];
  instances: AgentInstanceConfigMap | undefined;
  snapshots: Readonly<Record<string, UsageSnapshot>>;
  /** Usage ids that are not collected (`usageCollectionDisabledProviders`). */
  disabledUsageProviders: readonly string[];
  /** Display name for an account. */
  labelFor: (agentKind: string) => string;
  switchAtPercent: number | undefined;
  now: number;
}

/**
 * Everything a surface shows about each account in `order`. Readiness and
 * availability come from the shared `poolMemberStates`, the same states the
 * host failover policy decides from.
 */
export function buildPoolMemberViews(input: PoolMemberViewInput): PoolMemberView[] {
  const states = poolMemberStates(
    {
      enabled: true,
      members: [...input.order],
      ...(input.switchAtPercent !== undefined ? { switchAtPercent: input.switchAtPercent } : {}),
    },
    {
      agentStatuses: input.statuses,
      usageSnapshots: input.snapshots,
      now: input.now,
      disabledAgents: input.disabledAgents,
      ...(input.instances ? { agentInstances: input.instances } : {}),
    },
  );
  return states.map((state) => {
    const usageProviderId = state.usageAccountId ?? state.agentKind;
    const snapshot = Object.hasOwn(input.snapshots, usageProviderId)
      ? input.snapshots[usageProviderId]
      : undefined;
    return {
      ...state,
      label: input.labelFor(state.agentKind),
      usageProviderId,
      snapshot,
      percentLeft: usagePercentLeft(snapshot, input.now),
      tone: poolUsageTone(state.availability),
      usageTracked: !input.disabledUsageProviders.includes(usageProviderId),
    };
  });
}

/**
 * The account a new thread should start on when `preferred` (the composer's
 * usual pick) belongs to an enabled pool: the ready member with the most
 * usage left (`bestPoolMember`). Returns `preferred` unchanged when it is not
 * pooled or no member is ready.
 *
 * `preferred` ranks first, so a tie (equal headroom, or usage unknown for
 * every account) never moves the pick, matching the host's scheduled-run
 * choice. `pooled` (the "most usage left" claim) is true only when the
 * winner's headroom is actually known.
 */
export function poolPreferredAgentKind(input: {
  preferred: string | undefined;
  /** Accounts the composer can actually start (installed, enabled, right presentation). */
  candidates: readonly AgentStatus[];
  pools: AccountPools;
  instances: AgentInstanceConfigMap | undefined;
  snapshots: Readonly<Record<string, UsageSnapshot>>;
  now: number;
}): { agentKind: string | undefined; pooled: boolean } {
  const { preferred } = input;
  if (!preferred) return { agentKind: preferred, pooled: false };
  const active = activePoolFor(preferred, input.pools, input.instances);
  if (!active) return { agentKind: preferred, pooled: false };
  const states = poolMemberStates(
    {
      ...active.pool,
      members: [preferred, ...active.members.filter((member) => member !== preferred)],
    },
    {
      agentStatuses: input.candidates,
      usageSnapshots: input.snapshots,
      now: input.now,
      ...(input.instances ? { agentInstances: input.instances } : {}),
    },
  );
  const best = bestPoolMember(states);
  const winner = states.find((state) => state.agentKind === best);
  return { agentKind: best ?? preferred, pooled: winner?.availability.kind === "available" };
}

/**
 * Best member per enabled pool (driver → agent kind), for surfaces that pick
 * an account without a composer (Roundtable seats).
 */
export function bestPoolMembersByDriver(input: {
  pools: AccountPools;
  statuses: readonly AgentStatus[];
  disabledAgents: readonly string[];
  instances: AgentInstanceConfigMap | undefined;
  snapshots: Readonly<Record<string, UsageSnapshot>>;
  now: number;
}): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [driver, pool] of Object.entries(input.pools)) {
    const members = enabledPoolMembers(driver, pool, input.instances);
    if (!members) continue;
    const best = bestPoolMember(
      poolMemberStates(
        { ...pool, members },
        {
          agentStatuses: input.statuses,
          usageSnapshots: input.snapshots,
          now: input.now,
          disabledAgents: input.disabledAgents,
          ...(input.instances ? { agentInstances: input.instances } : {}),
        },
      ),
    );
    if (best) result[driver] = best;
  }
  return result;
}

/**
 * Roundtable (and similar pickers): within each pooled provider, move the
 * best account to the front of that provider's entries so a default seat
 * lands on the account with the most usage left. Other entries keep their
 * order; unpooled providers are untouched.
 */
export function preferBestPoolMembers<T extends { agentKind: string }>(
  entries: readonly T[],
  bestByDriver: Readonly<Record<string, string>>,
): T[] {
  const next = [...entries];
  for (const [driver, best] of Object.entries(bestByDriver)) {
    const groupIndexes = next
      .map((entry, index) => (baseAgentKind(entry.agentKind) === driver ? index : -1))
      .filter((index) => index >= 0);
    const firstIndex = groupIndexes[0];
    const bestIndex = next.findIndex((entry) => entry.agentKind === best);
    if (firstIndex === undefined || bestIndex <= firstIndex) continue;
    const [moved] = next.splice(bestIndex, 1);
    if (moved) next.splice(firstIndex, 0, moved);
  }
  return next;
}
