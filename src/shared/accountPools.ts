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

export const ACCOUNT_POOLS_VERSION = 1;

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
 * Classify one account from its latest usage snapshot. Polling hiccups
 * (`rate-limited` means the usage *endpoint* returned 429, `error`,
 * `app-not-running`, `unsupported`) are "unknown", never "exhausted".
 */
export function memberAvailability(
  snapshot: UsageSnapshot | undefined,
  now: number,
  switchAtPercent: number = DEFAULT_SWITCH_AT_PERCENT,
): MemberAvailability {
  if (!snapshot) return { kind: "unknown" };
  if (snapshot.status === "quota-hit") return { kind: "exhausted" };
  if (snapshot.status !== "ok") return { kind: "unknown" };
  const credits = snapshot.credits;
  if (credits && !credits.unlimited && credits.balance <= 0) return { kind: "exhausted" };
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
  for (let step = 1; step <= members.length; step += 1) {
    const member = members[(Math.max(0, start) + step) % members.length];
    if (!member || member.agentKind === current || tried.has(member.agentKind)) continue;
    if (!member.ready || member.availability.kind === "exhausted") continue;
    return member.agentKind;
  }
  return undefined;
}
