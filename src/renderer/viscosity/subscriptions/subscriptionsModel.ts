/**
 * ViscosityCode: Subscriptions dashboard, pure model (fork of Poracode).
 *
 * Turns the managed host's agent statuses, profiles, account pools and usage
 * snapshots into one row per provider with nested rows per account, plus the
 * "Who has room right now" ranking. Decisions come from the shared account
 * pool core (`memberAvailability`, the rule the host failover policy uses),
 * which counts a credit balance only for a credit-only account, so a zero
 * balance the usage panel hides never reads as "out of usage".
 * Nothing here knows a provider by name: an account is a profile
 * driver's base kind or one of its `<driver>:<id>` profile kinds, and every
 * other agent kind is a provider with a single account.
 */
import {
  DEFAULT_SWITCH_AT_PERCENT,
  memberAvailability,
  type AccountPools,
  type MemberAvailability,
} from "@/shared/accountPools";
import {
  agentProfileKind,
  isAgentProfileDriver,
  parseAgentProfileKind,
  type AgentInstanceConfigMap,
  type AgentStatus,
  type UsageSnapshot,
} from "@/shared/contracts";
import { hasDisplayableCredits } from "@/renderer/components/providers/usageFormat";
import {
  enabledPoolMembers,
  poolUsageTone,
  usagePercentLeft,
  type PoolUsageTone,
} from "@/renderer/viscosity/accountPools/poolModel";

/** Whether an account can take work right now, as the dashboard shows it. */
export type AccountReadiness =
  /** Installed, enabled and the provider reports a signed-in account. */
  | "signed-in"
  /** Installed and enabled; the provider can't say whether it is signed in. */
  | "ready"
  | "needs-sign-in"
  | "disabled"
  | "not-installed";

/** An account's place in its provider's enabled pool. */
export interface SubscriptionPoolMembership {
  /** 1-based position in the owner's pool order. */
  position: number;
  size: number;
  switchAtPercent: number;
}

export interface SubscriptionAccount {
  agentKind: string;
  label: string;
  /** Usage snapshot id that meters this account. */
  usageId: string;
  /** First status row for this kind on the managed host (native before WSL). */
  status: AgentStatus | undefined;
  readiness: AccountReadiness;
  snapshot: UsageSnapshot | undefined;
  /** A usage source exists for this account at all. */
  usageSupported: boolean;
  /** Usage for this account is collected (the owner did not turn it off). */
  usageTracked: boolean;
  /** The latest snapshot carries something to show (windows or credits). */
  hasUsageData: boolean;
  /** Availability at the pool's switch threshold when pooled, else at 100%. */
  availability: MemberAvailability;
  /** Usage left in the most-used live window, when known. */
  percentLeft: number | undefined;
  tone: PoolUsageTone;
  pool: SubscriptionPoolMembership | undefined;
}

export interface SubscriptionProvider {
  /** The profile driver, or the agent kind of a single-account provider. */
  id: string;
  label: string;
  accounts: SubscriptionAccount[];
  /** The provider supports several accounts (a profile driver), so it can pool. */
  supportsPool: boolean;
  /** Present while the provider's pool is on with at least two members. */
  pool: { size: number; switchAtPercent: number } | undefined;
}

export interface SubscriptionsInput {
  /** Managed host statuses, native first then WSL (the first row per kind wins). */
  statuses: readonly AgentStatus[];
  instances: AgentInstanceConfigMap | undefined;
  /** `sharedSettings.disabledAgents`. */
  disabledAgents: readonly string[];
  /** Effective pools (empty where pools are not this host's settings). */
  pools: AccountPools;
  snapshots: Readonly<Record<string, UsageSnapshot>>;
  /** Usage ids that are not collected (`usageCollectionDisabledProviders`). */
  disabledUsageProviders: readonly string[];
  /** Usage ids a usage source exists for (static providers plus profiles). */
  usageSupportedIds: ReadonlySet<string>;
  /** Usage snapshot id for an agent kind (`usageProviderIdForAgent`). */
  usageIdFor: (agentKind: string) => string;
  providerLabel: (providerId: string) => string;
  accountLabel: (agentKind: string) => string;
  /** Sort key for providers (lower first); ties sort by label. */
  providerRank: (providerId: string) => number;
  now: number;
}

/** Provider row an agent kind belongs to: a profile's driver, else the kind itself. */
export function subscriptionProviderId(agentKind: string): string {
  return parseAgentProfileKind(agentKind)?.driver ?? agentKind;
}

/**
 * True when the snapshot has something a bar or a credits row can show
 * (credits by the usage panel's own rule, so a zero balance next to live
 * windows does not count on its own).
 */
export function snapshotHasUsageData(snapshot: UsageSnapshot | undefined): boolean {
  if (!snapshot) return false;
  return snapshot.windows.length > 0 || hasDisplayableCredits(snapshot.credits, snapshot.windows);
}

export function accountReadiness(
  agentKind: string,
  status: AgentStatus | undefined,
  instances: AgentInstanceConfigMap | undefined,
  disabledAgents: readonly string[],
): AccountReadiness {
  if (disabledAgents.includes(agentKind)) return "disabled";
  const profile = parseAgentProfileKind(agentKind);
  if (profile && instances && Object.hasOwn(instances, profile.instanceId)) {
    if (instances[profile.instanceId]?.enabled === false) return "disabled";
  }
  if (!status?.installed) return "not-installed";
  if (status.authState === "missing") return "needs-sign-in";
  return status.authState === "authenticated" ? "signed-in" : "ready";
}

/** Signed in (or not known to be signed out), installed and enabled. */
export function isAccountReady(readiness: AccountReadiness): boolean {
  return readiness === "signed-in" || readiness === "ready";
}

function firstStatusByKind(statuses: readonly AgentStatus[]): Map<string, AgentStatus> {
  const byKind = new Map<string, AgentStatus>();
  for (const status of statuses) {
    if (!byKind.has(status.kind)) byKind.set(status.kind, status);
  }
  return byKind;
}

/**
 * Every account kind the dashboard considers, grouped by provider row:
 * status rows, configured profiles of profile drivers (disabled ones too, so
 * they read as disabled) and the drivers those profiles belong to.
 */
function collectKinds(input: SubscriptionsInput, byKind: Map<string, AgentStatus>): Set<string> {
  const kinds = new Set<string>(byKind.keys());
  for (const instance of Object.values(input.instances ?? {})) {
    if (!isAgentProfileDriver(instance.driver)) continue;
    kinds.add(instance.driver);
    kinds.add(agentProfileKind(instance.driver, instance.id));
  }
  return kinds;
}

/**
 * Accounts in display order: an enabled pool's members in the owner's order,
 * then the base account, then profiles by label.
 */
function orderAccounts(
  accounts: SubscriptionAccount[],
  providerId: string,
  poolMembers: readonly string[] | undefined,
): SubscriptionAccount[] {
  const rank = (account: SubscriptionAccount): number => {
    const poolIndex = poolMembers?.indexOf(account.agentKind) ?? -1;
    if (poolIndex >= 0) return poolIndex;
    return (poolMembers?.length ?? 0) + (account.agentKind === providerId ? 0 : 1);
  };
  return accounts.toSorted(
    (left, right) => rank(left) - rank(right) || left.label.localeCompare(right.label),
  );
}

function buildAccount(
  agentKind: string,
  input: SubscriptionsInput,
  status: AgentStatus | undefined,
  pool: { members: readonly string[]; switchAtPercent: number } | undefined,
): SubscriptionAccount {
  const usageId = input.usageIdFor(agentKind);
  const snapshot = Object.hasOwn(input.snapshots, usageId) ? input.snapshots[usageId] : undefined;
  const position = pool ? pool.members.indexOf(agentKind) : -1;
  const membership =
    pool && position >= 0
      ? { position: position + 1, size: pool.members.length, switchAtPercent: pool.switchAtPercent }
      : undefined;
  const availability = memberAvailability(
    snapshot,
    input.now,
    membership?.switchAtPercent ?? DEFAULT_SWITCH_AT_PERCENT,
  );
  return {
    agentKind,
    label: input.accountLabel(agentKind),
    usageId,
    status,
    readiness: accountReadiness(agentKind, status, input.instances, input.disabledAgents),
    snapshot,
    usageSupported: input.usageSupportedIds.has(usageId) || snapshot !== undefined,
    usageTracked: !input.disabledUsageProviders.includes(usageId),
    hasUsageData: snapshotHasUsageData(snapshot),
    availability,
    percentLeft: usagePercentLeft(snapshot, input.now),
    tone: poolUsageTone(availability),
    pool: membership,
  };
}

/**
 * One row per provider the owner has: any provider with an installed or
 * configured account, or with usage data for an account. Agents that are
 * neither installed nor configured and report nothing are left out.
 */
export function buildSubscriptionProviders(input: SubscriptionsInput): SubscriptionProvider[] {
  const byKind = firstStatusByKind(input.statuses);
  const kindsByProvider = new Map<string, string[]>();
  for (const kind of collectKinds(input, byKind)) {
    const providerId = subscriptionProviderId(kind);
    const list = kindsByProvider.get(providerId);
    if (list) list.push(kind);
    else kindsByProvider.set(providerId, [kind]);
  }

  const providers: SubscriptionProvider[] = [];
  for (const [providerId, kinds] of kindsByProvider) {
    const storedPool = Object.hasOwn(input.pools, providerId) ? input.pools[providerId] : undefined;
    const members = enabledPoolMembers(providerId, storedPool, input.instances);
    const pool =
      members && storedPool
        ? {
            members,
            switchAtPercent: storedPool.switchAtPercent ?? DEFAULT_SWITCH_AT_PERCENT,
          }
        : undefined;
    const accounts = kinds.map((kind) => buildAccount(kind, input, byKind.get(kind), pool));
    // Usage data alone counts only on the kind that owns the meter, so an
    // alias kind reporting under another provider's id adds no second row.
    const owned = accounts.some(
      (account) =>
        account.status?.installed === true ||
        parseAgentProfileKind(account.agentKind) !== undefined ||
        (account.hasUsageData && account.usageId === account.agentKind),
    );
    if (!owned) continue;
    providers.push({
      id: providerId,
      label: input.providerLabel(providerId),
      accounts: orderAccounts(accounts, providerId, pool?.members),
      supportsPool: isAgentProfileDriver(providerId),
      pool: pool ? { size: pool.members.length, switchAtPercent: pool.switchAtPercent } : undefined,
    });
  }
  return providers.toSorted(
    (left, right) =>
      input.providerRank(left.id) - input.providerRank(right.id) ||
      left.label.localeCompare(right.label),
  );
}

export interface RoomEntry {
  providerId: string;
  agentKind: string;
  label: string;
  usageId: string;
  /** Usage left in the most-used live window (percent, rounded). */
  percentLeft: number;
  tone: PoolUsageTone;
}

export interface OutEntry {
  providerId: string;
  agentKind: string;
  label: string;
  usageId: string;
  /** Epoch ms when the limiting window resets, when the provider says. */
  until: number | undefined;
}

export interface RoomSummary {
  /** Ready accounts with known headroom, most room first. */
  room: RoomEntry[];
  /** Ready accounts that are out of usage, soonest reset first. */
  out: OutEntry[];
}

/**
 * "Who has room right now": ready accounts ranked by headroom
 * (`memberAvailability` at 100%, i.e. usage left), most first; ties keep the
 * dashboard order. An account that is out by its pool's own threshold is
 * listed as out instead. Accounts metered together (one usage id) appear
 * once. Accounts whose usage is unknown are in neither list, and neither are
 * accounts that report no usage windows (a plan or a credit balance alone):
 * they have no percentage of room to rank, so none is claimed for them.
 */
export function summarizeRoom(
  providers: readonly SubscriptionProvider[],
  now: number,
): RoomSummary {
  const seen = new Set<string>();
  const room: RoomEntry[] = [];
  const out: OutEntry[] = [];
  for (const provider of providers) {
    for (const account of provider.accounts) {
      if (!isAccountReady(account.readiness) || seen.has(account.usageId)) continue;
      const own = account.availability;
      if (own.kind === "exhausted") {
        seen.add(account.usageId);
        out.push({
          providerId: provider.id,
          agentKind: account.agentKind,
          label: account.label,
          usageId: account.usageId,
          until: own.until,
        });
        continue;
      }
      if (own.kind !== "available" || !account.snapshot?.windows.length) continue;
      const headroom = memberAvailability(account.snapshot, now);
      if (headroom.kind !== "available") continue;
      seen.add(account.usageId);
      room.push({
        providerId: provider.id,
        agentKind: account.agentKind,
        label: account.label,
        usageId: account.usageId,
        percentLeft: Math.round(headroom.headroomPercent),
        tone: account.tone,
      });
    }
  }
  return {
    room: room.toSorted((left, right) => right.percentLeft - left.percentLeft),
    out: out.toSorted(
      (left, right) =>
        (left.until ?? Number.POSITIVE_INFINITY) - (right.until ?? Number.POSITIVE_INFINITY),
    ),
  };
}

/** Latest `fetchedAt` among the dashboard's snapshots, or 0 when none arrived. */
export function lastUsageUpdate(providers: readonly SubscriptionProvider[]): number {
  let latest = 0;
  for (const provider of providers) {
    for (const account of provider.accounts) {
      const fetchedAt = account.snapshot?.fetchedAt ?? 0;
      if (fetchedAt > latest) latest = fetchedAt;
    }
  }
  return latest;
}
