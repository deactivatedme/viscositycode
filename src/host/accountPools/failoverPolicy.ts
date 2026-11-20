/**
 * ViscosityCode: pure account-pool failover decisions (fork of Poracode).
 *
 * Everything here is side-effect free so the host service stays a thin layer
 * of event bookkeeping and effects. Provider differences arrive only through
 * declared data — profile drivers, agent statuses and usage snapshots — never
 * through a provider-name branch.
 */
import type { UsageSnapshot } from "@poracode/agents-usage/types";
import {
  accountPoolSchema,
  DEFAULT_SWITCH_AT_PERCENT,
  isPoolMemberExcluded,
  memberAvailability,
  MIN_POOL_MEMBERS_IN_USE,
  nextPoolMember,
  type AccountPool,
  type AccountPools,
  type MemberAvailability,
  type PoolMemberState,
} from "@/shared/accountPools";
import {
  authStateForPresentation,
  resolveModelSelection,
  resolveReasoningSelection,
} from "@/shared/agentSelection";
import { supportsPresentation } from "@/shared/continueProviderRanking";
import { inlinePromptSegmentText } from "@/shared/promptContent";
import {
  baseAgentKind,
  isAgentProfileDriver,
  messageItemPayloadSchema,
  type AgentCapability,
  type AgentStatus,
  type CanonicalContentBlock,
  type PromptSegment,
  type ThreadConfig,
} from "@/shared/contracts";

/**
 * The normalized runtime error reason a provider declares when its account ran
 * out of usage. The wire value is an open string (see `runtimeErrorReasonSchema`),
 * so this module matches it by value and needs no contract change to read it.
 */
export const USAGE_LIMITED_ERROR_REASON = "usage_limited";
/** Sign-in problems always stay with the user; they never trigger a failover. */
export const AUTH_REQUIRED_ERROR_REASON = "auth_required";

/** How long an account that just ran out is skipped when its reset time is unknown. */
export const DEFAULT_EXHAUSTED_COOLDOWN_MS = 15 * 60_000;

/** Prompt sent when the interrupted turn's own prompt could not be recovered. */
export const FAILOVER_CONTINUE_PROMPT = "Continue where the previous account left off.";

/**
 * Read the pools from settings without trusting their shape: each pool is
 * validated on its own so one malformed entry (an older or newer writer) only
 * drops that pool, and a host whose settings predate the field reads none.
 */
export function readAccountPoolsSetting(settings: object): AccountPools {
  const raw = "accountPools" in settings ? settings.accountPools : undefined;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const pools: AccountPools = {};
  for (const [driver, value] of Object.entries(raw)) {
    const parsed = accountPoolSchema.safeParse(value);
    if (parsed.success) pools[driver] = parsed.data;
  }
  return pools;
}

export interface ResolvedAccountPool {
  /** Profile driver id the pool is keyed by (e.g. the base agent kind). */
  driver: string;
  pool: AccountPool;
  /** Members of this driver only, de-duplicated, in the owner's order. */
  members: readonly string[];
  switchAtPercent: number | undefined;
}

/**
 * The enabled pool `agentKind` belongs to, or undefined. Only profile drivers
 * pool (separate accounts need separate credentials), a member must belong to
 * the pool's driver and not be left out (`excludedMembers`), and a pool needs
 * a second member to fail over to.
 */
export function resolveAccountPool(
  pools: AccountPools,
  agentKind: string,
): ResolvedAccountPool | undefined {
  const driver = baseAgentKind(agentKind);
  if (!isAgentProfileDriver(driver)) return undefined;
  const pool = Object.hasOwn(pools, driver) ? pools[driver] : undefined;
  if (!pool?.enabled) return undefined;
  // Accounts the owner left out of the pool never take work over.
  const members = [...new Set(pool.members)].filter(
    (member) => baseAgentKind(member) === driver && !isPoolMemberExcluded(pool, member),
  );
  if (!members.includes(agentKind) || members.length < MIN_POOL_MEMBERS_IN_USE) return undefined;
  return { driver, pool, members, switchAtPercent: pool.switchAtPercent };
}

/** True when both kinds are accounts of one enabled pool (a failover can move between them). */
export function sharesEnabledAccountPool(pools: AccountPools, a: string, b: string): boolean {
  return a === b || resolveAccountPool(pools, a)?.members.includes(b) === true;
}

export type FailureClassification = "usage" | "auth" | "other";

/**
 * Whether a failed turn ran out of usage: the provider said so
 * (`usage_limited`), or the account's latest usage snapshot (or a recent
 * failure on another thread) shows it exhausted. `auth_required` always wins
 * so sign-in stays with the user.
 *
 * `currentAvailability` must be judged by the default rule (a window fully
 * used, credits gone; `failureAvailability`), never by the pool's earlier
 * `switchAtPercent`: that threshold steers which account takes work, but an
 * unrelated failure on an account at, say, 92% is not an out-of-usage failure.
 */
export function classifyFailure(
  reason: string | undefined,
  currentAvailability: MemberAvailability,
): FailureClassification {
  if (reason === AUTH_REQUIRED_ERROR_REASON) return "auth";
  if (reason === USAGE_LIMITED_ERROR_REASON) return "usage";
  return currentAvailability.kind === "exhausted" ? "usage" : "other";
}

/**
 * The availability a failure is classified against (`classifyFailure`): a
 * host mark from a recent provider-reported (or fully used) out-of-usage
 * failure, else the snapshot at the DEFAULT 100% rule.
 */
export function failureAvailability(
  snapshot: UsageSnapshot | undefined,
  mark: ExhaustedMark | undefined,
  now: number,
): MemberAvailability {
  if (mark && mark.until > now) return { kind: "exhausted" };
  return memberAvailability(snapshot, now, DEFAULT_SWITCH_AT_PERCENT);
}

/** A member is ready when its agent is registered, installed, chat-capable and not signed out. */
export function isPoolMemberReady(status: AgentStatus | undefined): boolean {
  if (!status?.installed) return false;
  if (!supportsPresentation(status, "gui")) return false;
  return authStateForPresentation(status, "gui") !== "missing";
}

/** A recent out-of-usage failure observed by the host, keyed by usage account id. */
export interface ExhaustedMark {
  until: number;
  /** False when `until` is only the cool-down guess, not a reported reset time. */
  resetKnown: boolean;
}

export interface PoolMemberStateInput {
  members: readonly string[];
  statuses: readonly AgentStatus[];
  snapshotFor(agentKind: string): UsageSnapshot | undefined;
  usageIdFor(agentKind: string): string;
  exhaustedMarks: ReadonlyMap<string, ExhaustedMark>;
  now: number;
  switchAtPercent: number | undefined;
  /** Agent kinds the owner disabled; they never take work over. */
  disabledAgents?: readonly string[];
}

/**
 * Classify every member for the decision. A host-observed failure outranks a
 * stale snapshot until its mark expires; members that share one usage account
 * share its marks.
 */
export function buildPoolMemberStates(input: PoolMemberStateInput): PoolMemberState[] {
  return input.members.map((agentKind) => {
    const status = input.statuses.find((entry) => entry.kind === agentKind);
    const mark = input.exhaustedMarks.get(input.usageIdFor(agentKind));
    const availability: MemberAvailability =
      mark && mark.until > input.now
        ? mark.resetKnown
          ? { kind: "exhausted", until: mark.until }
          : { kind: "exhausted" }
        : memberAvailability(input.snapshotFor(agentKind), input.now, input.switchAtPercent);
    return {
      agentKind,
      ready: !input.disabledAgents?.includes(agentKind) && isPoolMemberReady(status),
      availability,
      // Members metered by one usage account share its quota (see `nextPoolMember`).
      usageAccountId: input.usageIdFor(agentKind),
    };
  });
}

export type FailoverDecision =
  | { kind: "switch"; to: string }
  | {
      kind: "exhausted";
      /** Earliest known time any member's usage resets. */
      until?: number;
      /** Members skipped only because they are signed out or unavailable. */
      notReadyCount: number;
    };

/**
 * Choose where a thread goes after `current` ran out. Every account is tried
 * at most once per chain (`tried`), so a chain can never ping-pong.
 */
export function decideFailover(
  members: readonly PoolMemberState[],
  current: string,
  tried: ReadonlySet<string>,
): FailoverDecision {
  const to = nextPoolMember(members, current, tried);
  if (to) return { kind: "switch", to };
  let until: number | undefined;
  let notReadyCount = 0;
  for (const member of members) {
    const availability = member.availability;
    if (availability.kind === "exhausted" && availability.until !== undefined) {
      until = until === undefined ? availability.until : Math.min(until, availability.until);
    }
    if (
      !member.ready &&
      availability.kind !== "exhausted" &&
      member.agentKind !== current &&
      !tried.has(member.agentKind)
    ) {
      notReadyCount += 1;
    }
  }
  return until === undefined
    ? { kind: "exhausted", notReadyCount }
    : { kind: "exhausted", until, notReadyCount };
}

/**
 * The failed account's mark: its snapshot's reset when it reports one,
 * otherwise a cool-down guess that is never shown as a reset time. Judged at
 * the default 100% rule: the mark also classifies later failures
 * (`failureAvailability`), which the pool's `switchAtPercent` must not reach.
 */
export function exhaustedMarkFor(
  snapshot: UsageSnapshot | undefined,
  now: number,
  cooldownMs: number = DEFAULT_EXHAUSTED_COOLDOWN_MS,
): ExhaustedMark {
  const availability = memberAvailability(snapshot, now, DEFAULT_SWITCH_AT_PERCENT);
  if (availability.kind === "exhausted" && availability.until !== undefined) {
    return { until: availability.until, resetKnown: true };
  }
  return { until: now + cooldownMs, resetKnown: false };
}

/**
 * Carry the thread's settings to another account of the same provider: the
 * same model when the new account offers it, else that account's default, and
 * every model-scoped option only where the new account supports it. Approval
 * and sandbox posture are kept as they are (never escalated); an option the
 * account does not list falls back to its own default. The selection binding
 * names the previous account as its owner, so it never carries over.
 */
export function failoverThreadConfig(source: ThreadConfig, target: AgentCapability): ThreadConfig {
  const {
    selectionBinding: _ownedByPreviousAccount,
    effort: sourceEffort,
    contextSize: sourceContextSize,
    fast: sourceFast,
    thinking: sourceThinking,
    workflows: sourceWorkflows,
    approvalPolicy: sourceApprovalPolicy,
    sandboxMode: sourceSandboxMode,
    mode: sourceMode,
    ...rest
  } = source;
  const model = resolveModelSelection(target, source.model) || source.model;
  const effort =
    target.models.length > 0
      ? resolveReasoningSelection(target, model, sourceEffort)
      : sourceEffort;
  const contextSizes =
    target.modelContextSizes?.[model] ?? target.contextSizes?.map((entry) => entry.id);
  const keepContextSize =
    sourceContextSize !== undefined &&
    (contextSizes === undefined || contextSizes.includes(sourceContextSize));
  const listed = (options: readonly { id: string }[], value: string | undefined) =>
    value !== undefined && (options.length === 0 || options.some((option) => option.id === value));
  return {
    ...rest,
    model,
    ...(effort ? { effort } : {}),
    ...(keepContextSize ? { contextSize: sourceContextSize } : {}),
    ...(sourceFast !== undefined && target.fastModels?.includes(model) ? { fast: sourceFast } : {}),
    ...(sourceThinking !== undefined && target.thinkingModels?.includes(model)
      ? { thinking: sourceThinking }
      : {}),
    ...(sourceWorkflows !== undefined && target.workflowModels?.includes(model)
      ? { workflows: sourceWorkflows }
      : {}),
    ...(listed(target.approvalPolicies, sourceApprovalPolicy)
      ? { approvalPolicy: sourceApprovalPolicy }
      : {}),
    ...(listed(target.sandboxModes, sourceSandboxMode) ? { sandboxMode: sourceSandboxMode } : {}),
    ...(sourceMode !== undefined && (target.modes.length === 0 || target.modes.includes(sourceMode))
      ? { mode: sourceMode }
      : {}),
  };
}

/** Canonical content of a top-level user message item, or undefined for anything else. */
export function userMessageContent(
  itemType: string,
  payload: unknown,
  parentItemId: string | undefined,
): CanonicalContentBlock[] | undefined {
  if (itemType !== "user_message" || parentItemId !== undefined) return undefined;
  const parsed = messageItemPayloadSchema.safeParse(payload);
  if (!parsed.success || parsed.data.turnIndependent) return undefined;
  return parsed.data.content.length > 0 ? parsed.data.content : undefined;
}

/**
 * Rebuild the prompt of an interrupted turn from its user messages so it can
 * be sent again, once, to the next account. Text, file mentions, attachments
 * with a path, diff comments and thread mentions keep their structure; skill
 * and MCP chips go back to their typed text form, since the stored message no
 * longer carries their catalog identity.
 */
export function promptFromUserMessages(messages: readonly (readonly CanonicalContentBlock[])[]): {
  prompt: string;
  segments?: PromptSegment[];
} {
  const segments: PromptSegment[] = [];
  messages.forEach((content, index) => {
    if (index > 0) segments.push({ kind: "text", content: "\n\n" });
    for (const block of content) {
      const segment = segmentFromBlock(block);
      if (segment) segments.push(segment);
    }
  });
  const prompt = segments
    .filter((segment) => segment.kind !== "attachment")
    .map(inlinePromptSegmentText)
    .join("")
    .trim();
  const structured = segments.some((segment) => segment.kind !== "text");
  if (!prompt && !segments.some((segment) => segment.kind === "attachment")) {
    return { prompt: FAILOVER_CONTINUE_PROMPT };
  }
  return structured ? { prompt, segments } : { prompt };
}

function segmentFromBlock(block: CanonicalContentBlock): PromptSegment | undefined {
  switch (block.kind) {
    case "text":
      return block.text.length > 0 ? { kind: "text", content: block.text } : undefined;
    case "skill":
      return block.invocation ? { kind: "text", content: block.invocation } : undefined;
    case "mcp":
      return { kind: "text", content: `@${block.name}` };
    case "thread":
      return { kind: "thread", threadId: block.threadId, title: block.title };
    case "diff_comment":
      return block.body.length > 0 && block.path.length > 0
        ? {
            kind: "diff_comment",
            path: block.path,
            lineNumber: block.lineNumber,
            side: block.side,
            staged: block.staged,
            body: block.body,
          }
        : undefined;
    case "image":
      return block.path
        ? { kind: "attachment", path: block.path, mimeType: block.mimeType }
        : undefined;
    case "file":
      return block.source === "mention"
        ? { kind: "file", path: block.path }
        : {
            kind: "attachment",
            path: block.path,
            ...(block.mimeType ? { mimeType: block.mimeType } : {}),
          };
  }
}
