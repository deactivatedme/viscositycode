/**
 * ViscosityCode: host-owned account-pool failover (fork of Poracode).
 *
 * When a chat (GUI) thread's account runs out of usage mid-turn and that
 * account belongs to an enabled pool, the thread moves in place to the next
 * pool member — the existing provider switch with the thread-transcript
 * handoff, so the supervisor writes the `provider_handoff` divider every
 * client renders — and the interrupted prompt is sent again, once. The policy
 * lives with the host owner so background, scheduled and remote-client
 * threads fail over exactly like threads in an open window, and every client
 * agrees on the decision.
 *
 * Guarantees:
 * - each account is tried at most once per failover chain, so a chain never
 *   ping-pongs and always ends;
 * - when every account is out the thread is left in its error state and one
 *   clear notice is published;
 * - terminal threads are never switched in place; the owner gets a suggestion
 *   to use Continue in provider instead;
 * - approvals, permissions and sign-in are never touched.
 *
 * Decisions are pure (`failoverPolicy.ts`); this class only tracks events and
 * runs the injected effects.
 */
import type { UsageSnapshot } from "@poracode/agents-usage/types";
import type { AccountPools, MemberAvailability, PoolMemberState } from "@/shared/accountPools";
import { bestPoolMember, memberAvailability } from "@/shared/accountPools";
import { capabilitiesForPresentation } from "@/shared/agentSelection";
import { getProjectAgentStatuses } from "@/shared/agentStatus";
import {
  DEFAULT_TERMINAL_SIZE,
  type AgentStatus,
  type AgentStatusesResponse,
  type CanonicalContentBlock,
  type McpLaunchSnapshot,
  type Project,
  type PromptSegment,
  type RuntimeEvent,
  type StartThreadPayload,
  type Thread,
  type ThreadStatus,
} from "@/shared/contracts";
import type { SupervisorEvent } from "@/shared/ipc";
import { buildWorktreeLocation } from "@/shared/worktree";
import {
  exhaustedMessage,
  exhaustedNotice,
  formatResetTime as defaultFormatResetTime,
  switchedNotice,
  switchFailedMessage,
  switchFailedNotice,
  terminalNotice,
  type AccountPoolNotice,
} from "./accountPoolNotices";
import {
  AUTH_REQUIRED_ERROR_REASON,
  buildPoolMemberStates,
  classifyFailure,
  decideFailover,
  DEFAULT_EXHAUSTED_COOLDOWN_MS,
  exhaustedMarkFor,
  failoverThreadConfig,
  promptFromUserMessages,
  resolveAccountPool,
  userMessageContent,
  type ExhaustedMark,
  type FailoverDecision,
  type ResolvedAccountPool,
} from "./failoverPolicy";

/** How a held failover ended, for owners that pause their own bookkeeping (schedules). */
export type AccountFailoverOutcome =
  /** The thread continues: switched to another account, or someone else already acted. */
  | { kind: "continued" }
  /** The thread stays failed; `error` is the message to record. */
  | { kind: "failed"; error: string };

export interface AccountPoolFailoverDeps {
  getAccountPools(): AccountPools;
  getThread(threadId: string): Thread | null;
  getProject(projectId: string): Project | null;
  getAgentStatuses(wslDistros: string[]): Promise<AgentStatusesResponse>;
  /** Latest cached usage for these usage ids from the owning host (optional refresh). */
  getUsageSnapshots?(usageIds: readonly string[]): Promise<readonly UsageSnapshot[]>;
  resolveMcpLaunchSnapshot(
    project: Project,
    overrides: Record<string, boolean> | undefined,
  ): McpLaunchSnapshot;
  /** The host's in-place provider switch for a prepared payload (`applyThreadSwitch`). */
  switchThread(payload: StartThreadPayload & { threadId: string }): Promise<unknown>;
  /** False for threads another owner must not have switched under it (experiments). */
  canSwitchThread?(threadId: string): boolean;
  publishNotice(notice: AccountPoolNotice): void;
  /** Called synchronously, before later observers see the failing event. */
  onFailoverPending?(threadId: string): void;
  /** Called exactly once for every `onFailoverPending`. */
  onFailoverSettled?(threadId: string, outcome: AccountFailoverOutcome): void;
  /** Usage account id of an agent kind; defaults to the agent kind itself. */
  usageIdFor?(agentKind: string): string;
  /** Agent kinds the owner disabled (`disabledAgents`); never chosen as a target. */
  getDisabledAgents?(): readonly string[];
  reportError?(error: unknown): void;
  now?(): number;
  formatResetTime?(ms: number): string;
  /** Upper bound on waiting for the failed session to settle before switching. */
  settleTimeoutMs?: number;
  exhaustedCooldownMs?: number;
}

interface ThreadTrack {
  status?: ThreadStatus;
  /** Incremented on every `turn.started`, so a claim can tell a newer turn began. */
  turnSeq: number;
  turnMessages: CanonicalContentBlock[][];
  turnMessageIds: Set<string>;
  /** The most recent turn that carried user input (fallback when a turn has none). */
  lastMessages: CanonicalContentBlock[][];
  /** A runtime `error` was classified for the current turn. */
  errorSeen: boolean;
}

interface FailoverChain {
  /** Accounts already attempted since the chain began (current one included). */
  tried: Set<string>;
  inFlight: boolean;
  cancelled: boolean;
  /** Account the last switch moved the thread to. */
  current?: string;
  /** Account an in-flight switch is moving the thread to. */
  switchingTo?: string;
  /** Turn that failed over last: its late failure events are stragglers. */
  switchedAtTurnSeq?: number;
}

interface FailoverClaim {
  threadId: string;
  fromAgentKind: string;
  pool: ResolvedAccountPool;
  prompt: { prompt: string; segments?: PromptSegment[] };
  turnSeq: number;
  chain: FailoverChain;
  originalError: string;
  settled: boolean;
}

const DEFAULT_SETTLE_TIMEOUT_MS = 5_000;
const FALLBACK_ERROR = "The account ran out of usage.";

export class AccountPoolFailoverService {
  private readonly tracks = new Map<string, ThreadTrack>();
  private readonly chains = new Map<string, FailoverChain>();
  private readonly snapshots = new Map<string, UsageSnapshot>();
  private readonly exhaustedMarks = new Map<string, ExhaustedMark>();
  private readonly settleWaiters = new Map<string, () => void>();
  private readonly terminalSuggested = new Set<string>();
  private readonly runs = new Set<Promise<void>>();
  private disposed = false;

  constructor(private readonly deps: AccountPoolFailoverDeps) {}

  /** Never throws: it runs inside the host's shared supervisor-event fan-out. */
  observeSupervisorEvent(event: SupervisorEvent): void {
    if (this.disposed) return;
    try {
      switch (event.type) {
        case "provider-usage":
          this.snapshots.set(event.snapshot.providerId, event.snapshot);
          return;
        case "provider-usage-all":
          this.snapshots.clear();
          for (const snapshot of event.snapshots) this.snapshots.set(snapshot.providerId, snapshot);
          return;
        case "thread-runtime-event":
          this.observeRuntimeEvent(event.event);
          return;
        case "thread-runtime-events":
          for (const runtimeEvent of event.events) this.observeRuntimeEvent(runtimeEvent);
          return;
        case "thread-runtime-events-multi":
          for (const batch of event.batches) {
            for (const runtimeEvent of batch.events) this.observeRuntimeEvent(runtimeEvent);
          }
          return;
        case "thread-state":
          this.observeThreadState(
            event.threadId,
            event.status,
            event.agentKind,
            event.errorMessage,
          );
          return;
        case "thread-exited":
          this.observeThreadExited(event.threadId);
          return;
        default:
          return;
      }
    } catch (error) {
      this.report(error);
    }
  }

  /** The supervisor died with every session: drop live bookkeeping, keep usage knowledge. */
  handleSupervisorReset(): void {
    for (const [threadId, chain] of this.chains) {
      if (chain.inFlight) chain.cancelled = true;
      else this.chains.delete(threadId);
    }
    for (const release of [...this.settleWaiters.values()]) release();
    this.tracks.clear();
    this.terminalSuggested.clear();
  }

  /** Stop observing and join in-flight failovers. */
  dispose(): Promise<void> {
    this.disposed = true;
    for (const release of [...this.settleWaiters.values()]) release();
    return Promise.allSettled([...this.runs]).then(() => undefined);
  }

  /**
   * True when a failure of this thread could still be claimed by a failover:
   * a chat thread whose account is in an enabled pool. Owners that settle work
   * on failure (schedules) give such a failure a short grace, because some
   * providers report the error state before their reasoned error event.
   */
  mayFailOver(threadId: string): boolean {
    if (this.disposed) return false;
    try {
      const thread = this.deps.getThread(threadId);
      if (!thread || thread.archived || thread.presentationMode !== "gui") return false;
      if (!resolveAccountPool(this.deps.getAccountPools(), thread.agentKind)) return false;
      return !this.deps.canSwitchThread || this.deps.canSwitchThread(threadId);
    } catch (error) {
      this.report(error);
      return false;
    }
  }

  /**
   * The account a NEW chat thread on `agentKind` should start on when that
   * account is in an enabled pool: the ready member with the most usage left
   * (`bestPoolMember`); a tie keeps the requested account. Undefined keeps
   * the requested account.
   */
  async preferredAccount(
    agentKind: string,
    location: Project["location"],
  ): Promise<string | undefined> {
    if (this.disposed) return undefined;
    const pool = resolveAccountPool(this.deps.getAccountPools(), agentKind);
    if (!pool) return undefined;
    const statuses = await this.loadStatuses(location);
    // The requested account first, so a tie never moves the thread.
    const order = [agentKind, ...pool.members.filter((member) => member !== agentKind)];
    const best = bestPoolMember(await this.memberStates(pool, statuses, order));
    return best === agentKind ? undefined : best;
  }

  /** Test and diagnostics view: the accounts tried in a thread's open chain. */
  triedAccounts(threadId: string): readonly string[] {
    return [...(this.chains.get(threadId)?.tried ?? [])];
  }

  private observeRuntimeEvent(event: RuntimeEvent): void {
    switch (event.type) {
      case "turn.started": {
        const track = this.track(event.threadId);
        track.turnSeq += 1;
        track.turnMessages = [];
        track.turnMessageIds = new Set();
        track.errorSeen = false;
        return;
      }
      case "item.started": {
        const content = userMessageContent(event.itemType, event.payload, event.parentItemId);
        if (!content) return;
        const track = this.track(event.threadId);
        if (track.turnMessageIds.has(event.itemId)) return;
        track.turnMessageIds.add(event.itemId);
        track.turnMessages.push(content);
        track.lastMessages = track.turnMessages;
        return;
      }
      case "error": {
        const track = this.track(event.threadId);
        track.errorSeen = true;
        if (event.reason === AUTH_REQUIRED_ERROR_REASON) return;
        this.maybeFailOver(event.threadId, event.reason, event.message);
        return;
      }
      case "turn.completed": {
        if (event.state === "failed") {
          if (!this.track(event.threadId).errorSeen) {
            this.maybeFailOver(event.threadId, undefined, undefined);
          }
          return;
        }
        // A turn that finished (or that the user stopped) ends the chain: the
        // next out-of-usage failure starts over with every account eligible.
        const chain = this.chains.get(event.threadId);
        if (chain && !chain.inFlight) this.chains.delete(event.threadId);
        return;
      }
      default:
        return;
    }
  }

  private observeThreadState(
    threadId: string,
    status: ThreadStatus,
    agentKind: string | undefined,
    errorMessage: string | undefined,
  ): void {
    if (this.isStragglerState(threadId, agentKind)) return;
    const track = this.track(threadId);
    track.status = status;
    if (status === "launching" || status === "working") {
      track.errorSeen = false;
      this.terminalSuggested.delete(threadId);
      return;
    }
    if (status === "needs_approval" || status === "needs_reply") return;
    this.settleWaiters.get(threadId)?.();
    if (status === "error" && !track.errorSeen) {
      this.maybeFailOver(threadId, undefined, errorMessage);
    }
  }

  /**
   * The session a failover left behind can still report a final state after
   * the switch; it names its own provider, so it is told apart from the new
   * account. A state from a third provider means the owner moved the thread
   * on by hand, which ends the chain.
   */
  private isStragglerState(threadId: string, agentKind: string | undefined): boolean {
    const chain = this.chains.get(threadId);
    if (
      agentKind === undefined ||
      chain?.current === undefined ||
      agentKind === chain.current ||
      agentKind === chain.switchingTo
    ) {
      return false;
    }
    if (chain.inFlight || this.deps.getThread(threadId)?.agentKind !== agentKind) return true;
    this.chains.delete(threadId);
    return false;
  }

  private observeThreadExited(threadId: string): void {
    this.settleWaiters.get(threadId)?.();
    if (this.chains.get(threadId)?.inFlight) return;
    this.chains.delete(threadId);
    this.terminalSuggested.delete(threadId);
    // An errored thread keeps its last prompt: a failure can still be
    // classified after its session closed. Anything else is released.
    if (this.tracks.get(threadId)?.status !== "error") this.tracks.delete(threadId);
  }

  private track(threadId: string): ThreadTrack {
    let track = this.tracks.get(threadId);
    if (!track) {
      track = {
        turnSeq: 0,
        turnMessages: [],
        turnMessageIds: new Set(),
        lastMessages: [],
        errorSeen: false,
      };
      this.tracks.set(threadId, track);
    }
    return track;
  }

  /**
   * The synchronous part of a failover: classify, claim the chain and hold
   * dependent owners before any later observer sees the failing event.
   */
  private maybeFailOver(
    threadId: string,
    reason: string | undefined,
    message: string | undefined,
  ): void {
    const existing = this.chains.get(threadId);
    if (existing?.inFlight) return;
    // A late failure of the turn that already failed over is not a new failure.
    if (existing && existing.switchedAtTurnSeq === this.tracks.get(threadId)?.turnSeq) return;
    const thread = this.deps.getThread(threadId);
    if (!thread || thread.archived) return;
    const pool = resolveAccountPool(this.deps.getAccountPools(), thread.agentKind);
    if (!pool) return;
    const now = this.now();
    if (classifyFailure(reason, this.availabilityOf(thread.agentKind, pool, now)) !== "usage") {
      return;
    }
    this.markExhausted(thread.agentKind, pool, now);
    if (thread.presentationMode !== "gui") {
      this.suggestForTerminal(thread, pool);
      return;
    }
    if (this.deps.canSwitchThread && !this.deps.canSwitchThread(threadId)) return;

    const track = this.track(threadId);
    const chain = existing ?? { tried: new Set<string>(), inFlight: false, cancelled: false };
    chain.tried.add(thread.agentKind);
    chain.inFlight = true;
    chain.cancelled = false;
    this.chains.set(threadId, chain);
    const claim: FailoverClaim = {
      threadId,
      fromAgentKind: thread.agentKind,
      pool,
      prompt: promptFromUserMessages(
        track.turnMessages.length > 0 ? track.turnMessages : track.lastMessages,
      ),
      turnSeq: track.turnSeq,
      chain,
      originalError: message ?? thread.errorMessage ?? FALLBACK_ERROR,
      settled: false,
    };
    this.deps.onFailoverPending?.(threadId);
    this.trackRun(
      this.executeFailover(claim).catch((error: unknown) => {
        this.report(error);
        this.finish(claim, { kind: "failed", error: claim.originalError }, true);
      }),
    );
  }

  private async executeFailover(claim: FailoverClaim): Promise<void> {
    await this.waitForSettle(claim.threadId);
    if (this.isStale(claim)) return;
    const thread = this.deps.getThread(claim.threadId);
    if (!thread || thread.archived) {
      this.finish(claim, { kind: "failed", error: claim.originalError }, true);
      return;
    }
    if (this.wasSuperseded(claim, thread)) {
      this.finish(claim, { kind: "continued" }, true);
      return;
    }
    const project = this.deps.getProject(thread.projectId);
    if (!project) {
      this.finish(claim, { kind: "failed", error: claim.originalError }, true);
      return;
    }
    const projectLocation = thread.worktreePath
      ? buildWorktreeLocation(project.location, thread.worktreePath)
      : project.location;
    const statuses = await this.loadStatuses(projectLocation);
    const decision = await this.decide(
      claim.pool,
      statuses,
      claim.fromAgentKind,
      claim.chain.tried,
    );
    if (this.isStale(claim)) return;

    if (decision.kind === "exhausted") {
      const message = this.exhaustedText(claim.pool, statuses, decision);
      this.publish(
        exhaustedNotice({
          threadId: claim.threadId,
          providerLabel: labelOf(statuses, claim.pool.driver),
          message,
        }),
      );
      this.finish(claim, { kind: "failed", error: message }, true);
      return;
    }

    const current = this.deps.getThread(claim.threadId);
    if (!current || this.wasSuperseded(claim, current)) {
      this.finish(claim, { kind: "continued" }, true);
      return;
    }
    const target = statuses.find((status) => status.kind === decision.to);
    if (!target) {
      this.finish(claim, { kind: "failed", error: claim.originalError }, true);
      return;
    }
    const config = failoverThreadConfig(
      current.config,
      capabilitiesForPresentation(target.capabilities, "gui"),
    );
    const { prompt, segments } = claim.prompt;
    const payload: StartThreadPayload & { threadId: string } = {
      threadId: current.id,
      projectLocation,
      agentKind: decision.to,
      config,
      prompt,
      ...(segments ? { segments } : {}),
      initialSize: DEFAULT_TERMINAL_SIZE,
      presentationMode: "gui",
      providerSwitch: { fromAgentKind: claim.fromAgentKind, contextStrategy: "thread-transcript" },
      ...this.deps.resolveMcpLaunchSnapshot(project, config.mcpServerOverrides),
    };
    claim.chain.tried.add(decision.to);
    claim.chain.switchingTo = decision.to;
    const fromLabel = labelOf(statuses, claim.fromAgentKind);
    const toLabel = target.label;
    try {
      await this.deps.switchThread(payload);
    } catch (error) {
      delete claim.chain.switchingTo;
      if (this.disposed) return;
      const message = switchFailedMessage({
        threadTitle: current.title,
        fromLabel,
        toLabel,
        error,
      });
      this.publish(switchFailedNotice({ threadId: claim.threadId, message }));
      this.finish(claim, { kind: "failed", error: message }, true);
      return;
    }
    claim.chain.current = decision.to;
    delete claim.chain.switchingTo;
    claim.chain.switchedAtTurnSeq = claim.turnSeq;
    this.publish(
      switchedNotice({ threadId: claim.threadId, threadTitle: current.title, fromLabel, toLabel }),
    );
    this.finish(claim, { kind: "continued" }, false);
  }

  /** Terminal threads never switch in place: suggest the existing Continue flow. */
  private suggestForTerminal(thread: Thread, pool: ResolvedAccountPool): void {
    if (this.terminalSuggested.has(thread.id)) return;
    this.terminalSuggested.add(thread.id);
    this.trackRun(
      (async () => {
        const project = this.deps.getProject(thread.projectId);
        const location = project
          ? thread.worktreePath
            ? buildWorktreeLocation(project.location, thread.worktreePath)
            : project.location
          : undefined;
        const statuses = location ? await this.loadStatuses(location) : [];
        const decision = await this.decide(pool, statuses, thread.agentKind, new Set());
        if (this.disposed) return;
        this.publish(
          decision.kind === "switch"
            ? terminalNotice({
                threadId: thread.id,
                threadTitle: thread.title,
                fromLabel: labelOf(statuses, thread.agentKind),
                toLabel: labelOf(statuses, decision.to),
              })
            : exhaustedNotice({
                threadId: thread.id,
                providerLabel: labelOf(statuses, pool.driver),
                message: this.exhaustedText(pool, statuses, decision),
              }),
        );
      })().catch((error: unknown) => this.report(error)),
    );
  }

  private async decide(
    pool: ResolvedAccountPool,
    statuses: readonly AgentStatus[],
    current: string,
    tried: ReadonlySet<string>,
  ): Promise<FailoverDecision> {
    return decideFailover(await this.memberStates(pool, statuses, pool.members), current, tried);
  }

  /** Fresh usage merged in, then every listed member classified (host marks included). */
  private async memberStates(
    pool: ResolvedAccountPool,
    statuses: readonly AgentStatus[],
    members: readonly string[],
  ): Promise<PoolMemberState[]> {
    await this.refreshUsage(pool);
    return buildPoolMemberStates({
      members,
      statuses,
      snapshotFor: (agentKind) => this.snapshots.get(this.usageIdFor(agentKind)),
      usageIdFor: (agentKind) => this.usageIdFor(agentKind),
      exhaustedMarks: this.exhaustedMarks,
      now: this.now(),
      switchAtPercent: pool.switchAtPercent,
      ...(this.deps.getDisabledAgents ? { disabledAgents: this.deps.getDisabledAgents() } : {}),
    });
  }

  private exhaustedText(
    pool: ResolvedAccountPool,
    statuses: readonly AgentStatus[],
    decision: Extract<FailoverDecision, { kind: "exhausted" }>,
  ): string {
    const format = this.deps.formatResetTime ?? defaultFormatResetTime;
    return exhaustedMessage({
      providerLabel: labelOf(statuses, pool.driver),
      ...(decision.until !== undefined ? { until: format(decision.until) } : {}),
      notReadyCount: decision.notReadyCount,
    });
  }

  private async loadStatuses(location: Project["location"]): Promise<readonly AgentStatus[]> {
    try {
      const statuses = await this.deps.getAgentStatuses(
        location.kind === "wsl" ? [location.distro] : [],
      );
      return getProjectAgentStatuses(location, statuses.windows, statuses.wsl);
    } catch (error) {
      this.report(error);
      return [];
    }
  }

  /** Merge the owning host's cached usage; a newer event-fed snapshot is never replaced. */
  private async refreshUsage(pool: ResolvedAccountPool): Promise<void> {
    if (!this.deps.getUsageSnapshots) return;
    const usageIds = [...new Set(pool.members.map((member) => this.usageIdFor(member)))];
    try {
      for (const snapshot of await this.deps.getUsageSnapshots(usageIds)) {
        const known = this.snapshots.get(snapshot.providerId);
        if (!known || known.fetchedAt <= snapshot.fetchedAt) {
          this.snapshots.set(snapshot.providerId, snapshot);
        }
      }
    } catch (error) {
      this.report(error);
    }
  }

  private availabilityOf(
    agentKind: string,
    pool: ResolvedAccountPool,
    now: number,
  ): MemberAvailability {
    const mark = this.exhaustedMarks.get(this.usageIdFor(agentKind));
    if (mark && mark.until > now) return { kind: "exhausted" };
    return memberAvailability(
      this.snapshots.get(this.usageIdFor(agentKind)),
      now,
      pool.switchAtPercent,
    );
  }

  /** Remember an out-of-usage failure so other threads skip the account too. */
  private markExhausted(agentKind: string, pool: ResolvedAccountPool, now: number): void {
    for (const [usageId, mark] of this.exhaustedMarks) {
      if (mark.until <= now) this.exhaustedMarks.delete(usageId);
    }
    const usageId = this.usageIdFor(agentKind);
    const next = exhaustedMarkFor(
      this.snapshots.get(usageId),
      now,
      pool.switchAtPercent,
      this.deps.exhaustedCooldownMs ?? DEFAULT_EXHAUSTED_COOLDOWN_MS,
    );
    const known = this.exhaustedMarks.get(usageId);
    if (!known || known.until < next.until) this.exhaustedMarks.set(usageId, next);
  }

  private waitForSettle(threadId: string): Promise<void> {
    const status = this.tracks.get(threadId)?.status;
    if (this.disposed || (status !== undefined && !isLive(status))) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const release = () => {
        clearTimeout(timer);
        if (this.settleWaiters.get(threadId) === release) this.settleWaiters.delete(threadId);
        resolve();
      };
      const timer = setTimeout(release, this.deps.settleTimeoutMs ?? DEFAULT_SETTLE_TIMEOUT_MS);
      timer.unref?.();
      this.settleWaiters.get(threadId)?.();
      this.settleWaiters.set(threadId, release);
    });
  }

  /** Another actor moved the thread on: a new turn began or its account changed. */
  private wasSuperseded(claim: FailoverClaim, thread: Thread): boolean {
    return (
      thread.agentKind !== claim.fromAgentKind ||
      thread.presentationMode !== "gui" ||
      (this.tracks.get(claim.threadId)?.turnSeq ?? claim.turnSeq) !== claim.turnSeq
    );
  }

  /** Disposal or a supervisor reset ended the claim; nothing more may run for it. */
  private isStale(claim: FailoverClaim): boolean {
    if (!this.disposed && !claim.chain.cancelled) return false;
    this.finish(claim, { kind: "continued" }, true);
    return true;
  }

  private finish(claim: FailoverClaim, outcome: AccountFailoverOutcome, closeChain: boolean): void {
    if (claim.settled) return;
    claim.settled = true;
    claim.chain.inFlight = false;
    if (closeChain && this.chains.get(claim.threadId) === claim.chain) {
      this.chains.delete(claim.threadId);
    }
    if (this.disposed) return;
    try {
      this.deps.onFailoverSettled?.(claim.threadId, outcome);
    } catch (error) {
      this.report(error);
    }
  }

  private publish(notice: AccountPoolNotice): void {
    if (this.disposed) return;
    try {
      this.deps.publishNotice(notice);
    } catch (error) {
      this.report(error);
    }
  }

  private trackRun(run: Promise<void>): void {
    this.runs.add(run);
    void run.finally(() => this.runs.delete(run));
  }

  private usageIdFor(agentKind: string): string {
    return this.deps.usageIdFor?.(agentKind) ?? agentKind;
  }

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }

  private report(error: unknown): void {
    try {
      this.deps.reportError?.(error);
    } catch {
      /* Reporting never changes failover state. */
    }
  }
}

function isLive(status: ThreadStatus): boolean {
  return status === "launching" || status === "working";
}

function labelOf(statuses: readonly AgentStatus[], agentKind: string): string {
  return statuses.find((status) => status.kind === agentKind)?.label ?? agentKind;
}
