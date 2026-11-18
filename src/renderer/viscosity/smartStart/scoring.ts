/**
 * ViscosityCode: Smart start scoring (fork of Poracode).
 *
 * Pure decisions behind "Let ViscosityCode pick". Every ready account is a
 * candidate; its score is the usage headroom it has left (the same
 * `memberAvailability` the account-pool failover uses) plus a mild bonus
 * from the owner's ordered preference for the prompt's task kind. Accounts
 * that are out of usage never win. Nothing here knows a provider by name:
 * a provider is an agent kind (a profile account's driver).
 */
import type { MemberAvailability } from "@/shared/accountPools";
import { baseAgentKind, type ThreadPresentationMode } from "@/shared/contracts";
import type { SmartStartPreferences } from "./smartStartStore";
import type { SmartStartTaskKind } from "./taskKind";

/** Bonus points by preference rank: first, second, third, fourth; the rest get none. */
export const PREFERENCE_BONUS: readonly number[] = [15, 10, 6, 3];
/** Headroom assumed for an account whose usage is not reported (neutral, not optimistic). */
export const UNKNOWN_HEADROOM = 50;
/**
 * The current selection is kept unless another account scores more than this
 * many points better, so small usage changes or a borderline task-kind guess
 * never flip the draft back and forth.
 */
export const STICKY_MARGIN = 3;

export interface SmartStartCandidate {
  /** Account to start on: a base kind ("<driver>") or a profile kind ("<driver>:<id>"). */
  agentKind: string;
  /** The provider the account belongs to (`smartStartProviderOf`). */
  provider: string;
  /** The provider's saved default model for new threads. */
  model: string;
  presentationMode: ThreadPresentationMode;
  availability: MemberAvailability;
  /** Usage left in percent of the most-used window, when reported. */
  percentLeft?: number;
}

export interface ScoredSmartStartCandidate extends SmartStartCandidate {
  score: number;
  /** Headroom points used for the score. */
  headroom: number;
  /** Position in the preference order, when listed. */
  preferenceRank?: number;
  bonus: number;
}

export type SmartStartNoPickReason = "no-ready-agent" | "all-exhausted";

export type SmartStartDecision =
  | {
      kind: "pick";
      pick: ScoredSmartStartCandidate;
      /** Every usable candidate, best first. */
      ranked: ScoredSmartStartCandidate[];
      /** The pick is the current selection, kept within `STICKY_MARGIN`. */
      keptCurrent: boolean;
    }
  | { kind: "none"; reason: SmartStartNoPickReason };

/**
 * The provider an account belongs to: a profile account's driver
 * ("<driver>:<id>"), otherwise the kind itself — the same split account
 * pools group by.
 */
export function smartStartProviderOf(agentKind: string): string {
  return baseAgentKind(agentKind);
}

/** Headroom points for an account, or undefined when it is out of usage. */
export function headroomPoints(availability: MemberAvailability): number | undefined {
  if (availability.kind === "exhausted") return undefined;
  if (availability.kind === "unknown") return UNKNOWN_HEADROOM;
  return Math.max(0, Math.min(100, availability.headroomPercent));
}

export function preferenceBonus(rank: number | undefined): number {
  if (rank === undefined || rank < 0) return 0;
  return PREFERENCE_BONUS[rank] ?? 0;
}

/**
 * The provider order for a task kind: the owner's explicit list for that
 * kind, otherwise the last-used order (also used when the kind is unknown).
 */
export function resolvePreferenceOrder(
  kind: SmartStartTaskKind | undefined,
  preferences: SmartStartPreferences,
  lastUsed: readonly string[],
): readonly string[] {
  const explicit = kind && Object.hasOwn(preferences, kind) ? preferences[kind] : undefined;
  return explicit ?? lastUsed;
}

/**
 * Score every candidate that still has usage left, best first. Ties go to
 * the better preference rank, then to the candidates' own order (the model
 * picker's provider order, pool order within a provider).
 */
export function scoreSmartStartCandidates(
  candidates: readonly SmartStartCandidate[],
  preferenceOrder: readonly string[],
): ScoredSmartStartCandidate[] {
  const scored: Array<ScoredSmartStartCandidate & { index: number }> = [];
  candidates.forEach((candidate, index) => {
    const headroom = headroomPoints(candidate.availability);
    if (headroom === undefined) return;
    const rank = preferenceOrder.indexOf(candidate.provider);
    const preferenceRank = rank >= 0 ? rank : undefined;
    const bonus = preferenceBonus(preferenceRank);
    scored.push({
      ...candidate,
      score: headroom + bonus,
      headroom,
      ...(preferenceRank !== undefined ? { preferenceRank } : {}),
      bonus,
      index,
    });
  });
  return scored
    .toSorted(
      (left, right) =>
        right.score - left.score ||
        (left.preferenceRank ?? Number.MAX_SAFE_INTEGER) -
          (right.preferenceRank ?? Number.MAX_SAFE_INTEGER) ||
        left.index - right.index,
    )
    .map(({ index: _index, ...candidate }) => candidate);
}

/**
 * Choose the account a new thread starts on. With no ready candidate, or
 * when every ready account is out of usage, there is no pick and the
 * composer falls back to the manual picker.
 */
export function decideSmartStart(input: {
  candidates: readonly SmartStartCandidate[];
  preferenceOrder: readonly string[];
  /** The draft's current account; kept unless another one is clearly better. */
  currentAgentKind?: string | undefined;
}): SmartStartDecision {
  if (input.candidates.length === 0) return { kind: "none", reason: "no-ready-agent" };
  const ranked = scoreSmartStartCandidates(input.candidates, input.preferenceOrder);
  const best = ranked[0];
  if (!best) return { kind: "none", reason: "all-exhausted" };
  const current = input.currentAgentKind
    ? ranked.find((candidate) => candidate.agentKind === input.currentAgentKind)
    : undefined;
  if (current && current !== best && best.score - current.score <= STICKY_MARGIN) {
    return { kind: "pick", pick: current, ranked, keptCurrent: true };
  }
  return { kind: "pick", pick: best, ranked, keptCurrent: current === best };
}

/**
 * Providers of existing threads, most recently active first. Read once when
 * a draft opens: the thread list changes on every status update.
 */
export function threadProviderOrder(
  threads: ReadonlyArray<{ agentKind: string; updatedAt: string }>,
): string[] {
  const byRecency = threads
    .map((thread) => ({ provider: smartStartProviderOf(thread.agentKind), at: thread.updatedAt }))
    .toSorted((left, right) => (left.at < right.at ? 1 : left.at > right.at ? -1 : 0));
  return lastUsedProviderOrder(
    byRecency.map((entry) => entry.provider),
    [],
  );
}

/**
 * The default ("last-used") provider order: providers the owner started
 * threads with by hand, most recent first, then providers of existing
 * threads by last activity (`threadProviderOrder`).
 */
export function lastUsedProviderOrder(
  recentProviders: readonly string[],
  threadProviders: readonly string[],
): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  for (const provider of [...recentProviders, ...threadProviders]) {
    if (!provider || seen.has(provider)) continue;
    seen.add(provider);
    order.push(provider);
  }
  return order;
}
