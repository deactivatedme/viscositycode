/**
 * ViscosityCode: account pools (fork of Poracode).
 *
 * The owner pays for several accounts of the same provider and wants work to
 * move to the next account when one runs out of usage. A pool groups the
 * profile agent kinds of one profile driver (e.g. "codex", "codex:work",
 * "codex:personal" — see src/shared/contracts/agentProfiles.ts) in the owner's
 * preferred order. This module holds the provider-agnostic schema and pure
 * decisions; the host failover service and the renderer UI build on it.
 *
 * Only drivers that support profiles (AGENT_PROFILE_DRIVERS) can pool:
 * separate accounts need separate credentials.
 */
import { z } from "zod";
import type { UsageSnapshot } from "@poracode/agents-usage/types";
import type { AgentStatus } from "./contracts/agent";
import { baseAgentKind, type AgentInstanceConfigMap } from "./contracts/agentInstance";
import { isAgentProfileDriver, parseAgentProfileKind } from "./contracts/agentProfiles";
import type { ThreadPresentationMode } from "./contracts/common";
import { usageAccountIdForAgent, type UsageAccountIdHooks } from "./usageAccountId";

/**
 * Pool shape version (informational; the settings document carries no per-key
 * version). Version 2 added the optional `excludedMembers` list. Compatibility
 * audit for that change:
 * - Documents written before it have no `excludedMembers`; they parse
 *   unchanged with every member in use (the key is never materialized, so a
 *   CAS write-back of an untouched pool stays byte-identical).
 * - An older reader's `accountPoolSchema` (a non-strict object) drops the key
 *   when it parses, so an older build treats excluded accounts as members —
 *   the pre-exclusion behavior. The settings authority keeps unknown nested
 *   keys from disk (`preserveUnknownSettingsValues`), so an older writer's
 *   edit to the same pool does not erase the exclusions.
 * - A newer client writing `excludedMembers` to an older authority is refused
 *   before any effect (unknown settings value field); nothing is half-written.
 * No SETTINGS_DOCUMENT_VERSION bump is needed: the key is optional and
 * additive. Pre-upgrade coverage: src/backend/settings/accountPoolsSettings.test.ts.
 */
export const ACCOUNT_POOLS_VERSION = 2;

export const accountPoolSchema = z.object({
  /** Automatically switch threads to the next member when one runs out. */
  enabled: z.boolean(),
  /** Pool members as agent kinds (base kind or "<driver>:<id>"), in preference order. */
  members: z.array(z.string().min(1)).max(16),
  /**
   * Treat an account as exhausted from this usage percent of any window
   * (default 100). Lower values switch earlier, leaving headroom.
   */
  switchAtPercent: z.number().min(50).max(100).optional(),
  /**
   * Accounts listed in `members` that the owner left out of the pool: they
   * keep their place in the order (so including one again restores it) but
   * never take new threads or failover work, and their usage is not
   * collected on the pool's behalf. Absent means every member is in use.
   */
  excludedMembers: z.array(z.string().min(1)).max(16).optional(),
});
export type AccountPool = z.infer<typeof accountPoolSchema>;

/** Pools keyed by profile driver id (e.g. "codex", "claude", "gemini"). */
export const accountPoolsSchema = z.record(z.string(), accountPoolSchema);
export type AccountPools = z.infer<typeof accountPoolsSchema>;

export const DEFAULT_SWITCH_AT_PERCENT = 100;

export type MemberAvailability =
  | { kind: "available"; headroomPercent: number }
  | { kind: "exhausted"; until?: number }
  | { kind: "unknown" };

/**
 * True when a snapshot's credit balance is its meter and has run out. A
 * balance meters an account only when the snapshot reports no usage windows
 * (a credit-only account). Next to windows the windows decide: some providers
 * report a zero balance whenever no extra credits were bought, which says
 * nothing about the plan's own usage.
 */
export function creditBalanceExhausted(
  snapshot: Pick<UsageSnapshot, "credits" | "windows">,
): boolean {
  const credits = snapshot.credits;
  return (
    credits !== undefined &&
    credits.unlimited !== true &&
    credits.balance <= 0 &&
    snapshot.windows.length === 0
  );
}

/**
 * Classify one account from its latest usage snapshot. Polling hiccups
 * (`rate-limited` means the usage *endpoint* returned 429, `error`,
 * `app-not-running`, `unsupported`) are "unknown", never "exhausted". A
 * credit balance counts only for a credit-only account
 * (`creditBalanceExhausted`).
 */
export function memberAvailability(
  snapshot: UsageSnapshot | undefined,
  now: number,
  switchAtPercent: number = DEFAULT_SWITCH_AT_PERCENT,
): MemberAvailability {
  if (!snapshot) return { kind: "unknown" };
  if (snapshot.status === "quota-hit") return { kind: "exhausted" };
  if (snapshot.status !== "ok") return { kind: "unknown" };
  if (creditBalanceExhausted(snapshot)) return { kind: "exhausted" };
  let worst = 0;
  let exhaustedUntil: number | undefined;
  for (const window of snapshot.windows) {
    // A window whose reset time has passed no longer limits anything.
    if (window.resetsAt !== undefined && window.resetsAt <= now) continue;
    worst = Math.max(worst, window.usedPercent);
    if (window.usedPercent >= switchAtPercent) {
      exhaustedUntil =
        window.resetsAt === undefined
          ? exhaustedUntil
          : Math.max(exhaustedUntil ?? 0, window.resetsAt);
    }
  }
  if (worst >= switchAtPercent) {
    return exhaustedUntil === undefined
      ? { kind: "exhausted" }
      : { kind: "exhausted", until: exhaustedUntil };
  }
  return { kind: "available", headroomPercent: Math.max(0, switchAtPercent - worst) };
}

export interface PoolMemberState {
  agentKind: string;
  /** Signed in and enabled (auth not "missing", not disabled). */
  ready: boolean;
  availability: MemberAvailability;
  /**
   * Usage snapshot id that meters this account (`usageAccountIdForAgent`).
   * Members that share one (profiles referencing the same login) share one
   * quota, so failover never moves between them.
   */
  usageAccountId?: string;
}

/**
 * Pick the account a NEW thread should start on: the ready member with the
 * most headroom; ties keep the owner's order; unknown usage ranks after any
 * account with known headroom but before exhausted ones. Returns undefined
 * when no member is ready.
 */
export function bestPoolMember(members: readonly PoolMemberState[]): string | undefined {
  let best: { agentKind: string; score: number; index: number } | undefined;
  members.forEach((member, index) => {
    if (!member.ready) return;
    const a = member.availability;
    const score =
      a.kind === "available" ? 1000 + a.headroomPercent : a.kind === "unknown" ? 500 : 0;
    if (!best || score > best.score || (score === best.score && index < best.index)) {
      best = { agentKind: member.agentKind, score, index };
    }
  });
  return best?.agentKind;
}

/**
 * Pick the account to fail over to after `current` ran out: the next ready,
 * non-exhausted member after `current` in the owner's order (wrapping), never
 * `current` itself and never one in `tried` (accounts already attempted for
 * this turn). Returns undefined when every other member is exhausted.
 */
export function nextPoolMember(
  members: readonly PoolMemberState[],
  current: string,
  tried: ReadonlySet<string> = new Set(),
): string | undefined {
  const start = members.findIndex((m) => m.agentKind === current);
  // Accounts metered together with `current` or a tried member are out too.
  const spentAccounts = new Set(
    members
      .filter((m) => m.agentKind === current || tried.has(m.agentKind))
      .flatMap((m) => (m.usageAccountId === undefined ? [] : [m.usageAccountId])),
  );
  for (let step = 1; step <= members.length; step += 1) {
    const member = members[(Math.max(0, start) + step) % members.length];
    if (!member || member.agentKind === current || tried.has(member.agentKind)) continue;
    if (!member.ready || member.availability.kind === "exhausted") continue;
    if (member.usageAccountId !== undefined && spentAccounts.has(member.usageAccountId)) continue;
    return member.agentKind;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// ViscosityCode: settings wiring helpers (stored pools → effective pools →
// member states). Stored pools are kept as written (see `accountPools` in
// src/shared/settings.ts); every reader goes through these helpers instead.
// ---------------------------------------------------------------------------

function hasOwnEntry<T>(record: Readonly<Record<string, T>>, key: string): boolean {
  return Object.hasOwn(record, key);
}

function profileInstance(agentInstances: AgentInstanceConfigMap | undefined, instanceId: string) {
  return agentInstances && hasOwnEntry(agentInstances, instanceId)
    ? agentInstances[instanceId]
    : undefined;
}

/**
 * Lenient read of a stored `accountPools` value for the tolerant settings
 * normalizer: a malformed pool is dropped on its own instead of resetting
 * every pool. Keys and members are not otherwise rewritten.
 */
export function parseStoredAccountPools(value: unknown): AccountPools {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  // fromEntries defines own keys, so a stored "__proto__" key stays inert data.
  return Object.fromEntries(
    Object.entries(value).flatMap(([driver, entry]) => {
      const parsed = accountPoolSchema.safeParse(entry);
      return parsed.success ? [[driver, parsed.data] as const] : [];
    }),
  );
}

/**
 * True when `agentKind` can belong to `driver`'s pool: the driver's base kind
 * or one of its profile kinds and, when `agentInstances` is given, a profile
 * that is still configured for that driver.
 */
export function isPoolMemberKind(
  driver: string,
  agentKind: string,
  agentInstances?: AgentInstanceConfigMap,
): boolean {
  if (!isAgentProfileDriver(driver)) return false;
  if (agentKind === driver) return true;
  const profile = parseAgentProfileKind(agentKind);
  if (!profile || profile.driver !== driver) return false;
  if (!agentInstances) return true;
  return profileInstance(agentInstances, profile.instanceId)?.driver === driver;
}

/**
 * The members of `driver`'s pool that can still run, in the owner's order:
 * duplicates, foreign or malformed kinds and (given `agentInstances`) removed
 * profiles are dropped.
 */
export function normalizePoolMembers(
  driver: string,
  members: readonly string[],
  agentInstances?: AgentInstanceConfigMap,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const member of members) {
    if (seen.has(member) || !isPoolMemberKind(driver, member, agentInstances)) continue;
    seen.add(member);
    out.push(member);
  }
  return out;
}

/** True when the owner left `agentKind` out of `pool` (`excludedMembers`). */
export function isPoolMemberExcluded(pool: AccountPool, agentKind: string): boolean {
  return pool.excludedMembers?.includes(agentKind) === true;
}

/**
 * The members of `driver`'s pool that take work, in the owner's order:
 * `normalizePoolMembers` without the accounts the owner left out. Every
 * policy reader (failover, new-thread choice, usage collection) goes through
 * this; only the settings card reads the full stored order.
 */
export function poolMembersInUse(
  driver: string,
  pool: AccountPool,
  agentInstances?: AgentInstanceConfigMap,
): string[] {
  return normalizePoolMembers(driver, pool.members, agentInstances).filter(
    (member) => !isPoolMemberExcluded(pool, member),
  );
}

/** `pool` with `members` replaced by its members in use and no exclusion list left to apply. */
function poolInUse(
  driver: string,
  pool: AccountPool,
  agentInstances?: AgentInstanceConfigMap,
): AccountPool {
  const { excludedMembers: _appliedBelow, ...rest } = pool;
  return { ...rest, members: poolMembersInUse(driver, pool, agentInstances) };
}

/**
 * Effective pools for policy: only drivers that support profiles
 * (`isAgentProfileDriver`), each with only its members in use
 * (`poolMembersInUse`: normalized, excluded accounts removed). The result is
 * what the host and clients decide from, not a value to write back: it no
 * longer carries the excluded accounts' places in the order.
 */
export function normalizeAccountPools(
  pools: AccountPools | undefined,
  agentInstances?: AgentInstanceConfigMap,
): AccountPools {
  const out: AccountPools = {};
  for (const [driver, pool] of Object.entries(pools ?? {})) {
    if (!isAgentProfileDriver(driver)) continue;
    out[driver] = poolInUse(driver, pool, agentInstances);
  }
  return out;
}

/**
 * The pool `agentKind` belongs to, with its members in use, or undefined when
 * its driver has no pool or the account is not a member (or was left out).
 * The pool is returned whether or not it is `enabled`; automatic switching
 * checks that flag.
 */
export function poolForAgentKind(
  pools: AccountPools | undefined,
  agentKind: string,
  agentInstances?: AgentInstanceConfigMap,
): AccountPool | undefined {
  const driver = baseAgentKind(agentKind);
  if (!pools || !isAgentProfileDriver(driver) || !hasOwnEntry(pools, driver)) return undefined;
  const pool = poolInUse(driver, pools[driver]!, agentInstances);
  return pool.members.includes(agentKind) ? pool : undefined;
}

/** Removes `agentKind` from every pool (a deleted profile), keeping the rest as stored. */
export function removePoolMember(pools: AccountPools | undefined, agentKind: string): AccountPools {
  return Object.fromEntries(
    Object.entries(pools ?? {}).map(([driver, pool]) => {
      if (!pool.members.includes(agentKind) && !isPoolMemberExcluded(pool, agentKind)) {
        return [driver, pool];
      }
      const { excludedMembers, ...rest } = pool;
      const excluded = excludedMembers?.filter((member) => member !== agentKind);
      return [
        driver,
        {
          ...rest,
          members: pool.members.filter((member) => member !== agentKind),
          // Absent stays absent; an emptied list is dropped rather than stored empty.
          ...(excluded && excluded.length > 0 ? { excludedMembers: excluded } : {}),
        },
      ];
    }),
  );
}

/** Fewest members in use a pool needs before it can move work (the host's failover rule). */
export const MIN_POOL_MEMBERS_IN_USE = 2;

/**
 * Usage snapshot ids of every member of an enabled pool, deduplicated. The
 * pool policy needs these accounts' usage, so collection treats them as on
 * unless the user opted out (`usageCollectionDisabledProviders`). A pool with
 * fewer than two members in use cannot fail over (the host ignores it), so it
 * forces no collection.
 */
export function poolUsageAccountIds(
  pools: AccountPools | undefined,
  agentInstances?: AgentInstanceConfigMap,
  hooks?: UsageAccountIdHooks,
): string[] {
  const ids = new Set<string>();
  for (const pool of Object.values(normalizeAccountPools(pools, agentInstances))) {
    if (!pool.enabled || pool.members.length < MIN_POOL_MEMBERS_IN_USE) continue;
    for (const member of pool.members)
      ids.add(usageAccountIdForAgent(member, undefined, agentInstances, hooks));
  }
  return [...ids];
}

/** Usage snapshots keyed by usage id, or the list a usage response carries. */
export type UsageSnapshotLookup =
  | ReadonlyMap<string, UsageSnapshot>
  | Readonly<Record<string, UsageSnapshot | undefined>>
  | readonly UsageSnapshot[];

/** The agent-status fields readiness depends on. */
export type PoolAgentStatus = Pick<
  AgentStatus,
  "kind" | "installed" | "authState" | "presentationAuthStates"
>;

export interface PoolMemberContext {
  /** Statuses of the environment the thread runs in (first row per kind wins). */
  agentStatuses: readonly PoolAgentStatus[];
  usageSnapshots: UsageSnapshotLookup;
  now: number;
  /** Agent kinds the user disabled (`sharedSettings.disabledAgents`). */
  disabledAgents?: readonly string[];
  /**
   * `sharedSettings.agentInstances`: a removed or disabled profile is not
   * ready, and drivers whose profiles share a meter resolve through it.
   */
  agentInstances?: AgentInstanceConfigMap;
  /** Presentation whose auth applies; absent uses the provider-wide auth state. */
  presentation?: ThreadPresentationMode;
  usageAccountIdHooks?: UsageAccountIdHooks;
}

function isSnapshotList(lookup: UsageSnapshotLookup): lookup is readonly UsageSnapshot[] {
  return Array.isArray(lookup);
}

function isSnapshotMap(lookup: UsageSnapshotLookup): lookup is ReadonlyMap<string, UsageSnapshot> {
  return lookup instanceof Map;
}

function findSnapshot(lookup: UsageSnapshotLookup, id: string): UsageSnapshot | undefined {
  if (isSnapshotList(lookup)) return lookup.find((snapshot) => snapshot.providerId === id);
  if (isSnapshotMap(lookup)) return lookup.get(id);
  return hasOwnEntry(lookup, id) ? lookup[id] : undefined;
}

function isMemberReady(agentKind: string, context: PoolMemberContext): boolean {
  if (context.disabledAgents?.includes(agentKind)) return false;
  const profile = parseAgentProfileKind(agentKind);
  if (profile && context.agentInstances) {
    const instance = profileInstance(context.agentInstances, profile.instanceId);
    if (!instance || instance.driver !== profile.driver || instance.enabled === false) return false;
  }
  const status = context.agentStatuses.find((entry) => entry.kind === agentKind);
  if (!status?.installed) return false;
  const auth =
    (context.presentation === undefined
      ? undefined
      : status.presentationAuthStates?.[context.presentation]) ?? status.authState;
  return auth !== "missing";
}

/**
 * One state per pool member, in the owner's order: ready when installed,
 * enabled and not signed out (`authState !== "missing"`), with availability
 * from that account's usage snapshot at the pool's switch threshold.
 */
export function poolMemberStates(pool: AccountPool, context: PoolMemberContext): PoolMemberState[] {
  const threshold = pool.switchAtPercent ?? DEFAULT_SWITCH_AT_PERCENT;
  return pool.members.map((agentKind) => {
    const usageAccountId = usageAccountIdForAgent(
      agentKind,
      undefined,
      context.agentInstances,
      context.usageAccountIdHooks,
    );
    return {
      agentKind,
      ready: isMemberReady(agentKind, context),
      availability: memberAvailability(
        findSnapshot(context.usageSnapshots, usageAccountId),
        context.now,
        threshold,
      ),
      usageAccountId,
    };
  });
}
