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
import { bestPoolMember } from "@/shared/accountPools";
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
  failureAvailability,
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
  /**
   * Delivers a host notice. Returns true when the notice was delivered in
   * place of the thread's error notification (one that leaves the thread
   * failed): the held generic error notification is then dropped, so the
   * owner hears about the failure once (`holdErrorNotification`).
   */
  publishNotice(notice: AccountPoolNotice): boolean | void;
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
  /** Longest a thread's error notification is held for its failover (`holdErrorNotification`). */
  errorNotificationHoldMs?: number;
  /** How long a held error notification waits for a failover to claim the failure. */
  errorNotificationGraceMs?: number;
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
  /** A user message (or a failover's re-sent prompt) arrived since the last `turn.completed`. */
  inputSinceTurnEnd: boolean;
  /** The last turn finished or was stopped and no new work began: nothing to resume. */
  idle: boolean;
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
/** Bounded hold: an error notification is never delayed longer than this. */
const DEFAULT_ERROR_NOTIFICATION_HOLD_MS = 10_000;
/** Matches the schedule coordinator's grace for a failover to claim a failure. */
const DEFAULT_ERROR_NOTIFICATION_GRACE_MS = 2_000;
const FALLBACK_ERROR = "The account ran out of usage.";

/** What a held error notification becomes once its failover settles. */
type HeldNotificationRelease = "publish" | "drop";

/**
 * A thread that stays failed publishes its held error notification, unless
 * the failover's own notice was delivered in its place.
 */
function releaseAfter(noticeReplacesError: boolean): HeldNotificationRelease {
  return noticeReplacesError ? "drop" : "publish";
}

export class AccountPoolFailoverService {
  private readonly tracks = new Map<string, ThreadTrack>();
  private readonly chains = new Map<string, FailoverChain>();
  private readonly snapshots = new Map<string, UsageSnapshot>();
  private readonly exhaustedMarks = new Map<string, ExhaustedMark>();
  private readonly settleWaiters = new Map<string, () => void>();
  private readonly terminalSuggested = new Set<string>();
  /** Error notifications held per thread until its failover settles (`holdErrorNotification`). */
  private readonly heldNotifications = new Map<string, Set<(publish: boolean) => void>>();
  /** Expiry of tracks an errored thread keeps after its session exits (`observeThreadExited`). */
  private readonly trackExpiries = new Map<string, ReturnType<typeof setTimeout>>();
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
    this.clearTrackExpiries();
    this.tracks.clear();
    this.terminalSuggested.clear();
  }

  /** Stop observing and join in-flight failovers. */
  dispose(): Promise<void> {
    this.disposed = true;
    for (const release of [...this.settleWaiters.values()]) release();
    this.clearTrackExpiries();
    // Held notifications are released, never lost, when the owner shuts down.
    for (const threadId of [...this.heldNotifications.keys()]) {
      this.releaseHeldNotifications(threadId, "publish");
    }
    return Promise.allSettled([...this.runs]).then(() => undefined);
  }

  /**
   * For the host's thread notification publisher: whether to hold this
   * thread's "error" notification because an account-pool failover may still
   * move the thread on. Undefined means publish now. Otherwise the promise
   * resolves true to publish the notification or false to drop it:
   * - a failover is pending (or claims the failure within a short grace, for
   *   providers that report the error state before their reasoned error) —
   *   dropped when the thread continued on another account, published when it
   *   stays failed;
   * - a late error from the session a finished failover left behind
   *   (`agentKind` is no longer the thread's account) — dropped at once;
   * - an error from the account a pending switch is moving the thread to is
   *   not the failover's to answer — published now.
   * The hold is bounded (`errorNotificationHoldMs`, default 10 s): when the
   * bound passes first, the notification is published.
   */
  holdErrorNotification(threadId: string, agentKind?: string): Promise<boolean> | undefined {
    if (this.disposed) return undefined;
    try {
      const chain = this.chains.get(threadId);
      // The account a switch is moving the thread to failed on its own: the
      // failover does not answer that failure, so its notification is never
      // held (a successful switch would otherwise drop it).
      if (chain?.inFlight && agentKind !== undefined && agentKind === chain.switchingTo) {
        return undefined;
      }
      if (chain && agentKind !== undefined && !chain.inFlight) {
        const current = this.deps.getThread(threadId)?.agentKind;
        if (current !== undefined && current !== agentKind) return Promise.resolve(false);
      }
      const pending = chain?.inFlight === true;
      if (!pending && !this.mayFailOver(threadId)) return undefined;
      return new Promise<boolean>((resolve) => {
        let waiters = this.heldNotifications.get(threadId);
        if (!waiters) {
          waiters = new Set();
          this.heldNotifications.set(threadId, waiters);
        }
        const held = waiters;
        let bound: ReturnType<typeof setTimeout> | undefined;
        let grace: ReturnType<typeof setTimeout> | undefined;
        const settle = (publish: boolean) => {
          clearTimeout(bound);
          clearTimeout(grace);
          held.delete(settle);
          if (held.size === 0 && this.heldNotifications.get(threadId) === held) {
            this.heldNotifications.delete(threadId);
          }
          resolve(publish);
        };
        held.add(settle);
        bound = setTimeout(
          () => settle(true),
          this.deps.errorNotificationHoldMs ?? DEFAULT_ERROR_NOTIFICATION_HOLD_MS,
        );
        bound.unref?.();
        if (!pending) {
          grace = setTimeout(() => {
            if (!this.chains.get(threadId)?.inFlight) settle(true);
          }, this.deps.errorNotificationGraceMs ?? DEFAULT_ERROR_NOTIFICATION_GRACE_MS);
          grace.unref?.();
        }
      });
    } catch (error) {
      this.report(error);
      return undefined;
    }
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
      if (this.tracks.get(threadId)?.idle) return false;
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
        track.idle = false;
        // A turn with no input since the last one ended (a resumed session)
        // must never inherit an earlier turn's prompt, whatever its outcome.
        if (!track.inputSinceTurnEnd) track.lastMessages = [];
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
        track.inputSinceTurnEnd = true;
        track.idle = false;
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
          const track = this.track(event.threadId);
          if (!track.errorSeen) this.maybeFailOver(event.threadId, undefined, undefined);
          // Its prompt stays readable (`turnMessages`) for a late classification.
          track.inputSinceTurnEnd = false;
          return;
        }
        // A turn that finished (or that the user stopped) ends the chain: the
        // next out-of-usage failure starts over with every account eligible.
        // Its prompt is done too: a later failure (a resumed turn without user
        // input, an idle error) must never re-send it.
        const track = this.track(event.threadId);
        track.turnMessages = [];
        track.lastMessages = [];
        track.inputSinceTurnEnd = false;
        track.idle = true;
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
      track.idle = false;
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
    // An errored thread keeps its last prompt for a bounded time: a failure
    // can still be classified after its session closed. Anything else is released.
    const track = this.tracks.get(threadId);
    if (track?.status === "error") this.expireTrack(threadId, track);
    else this.tracks.delete(threadId);
  }

  private expireTrack(threadId: string, track: ThreadTrack): void {
    clearTimeout(this.trackExpiries.get(threadId));
    const timer = setTimeout(() => {
      this.trackExpiries.delete(threadId);
      if (this.tracks.get(threadId) !== track || track.status !== "error") return;
      // A failover still running for this thread needs the prompt; check again later.
      if (this.chains.get(threadId)?.inFlight) this.expireTrack(threadId, track);
      else this.tracks.delete(threadId);
    }, this.deps.errorNotificationHoldMs ?? DEFAULT_ERROR_NOTIFICATION_HOLD_MS);
    timer.unref?.();
    this.trackExpiries.set(threadId, timer);
  }

  private clearTrackExpiries(): void {
    for (const timer of this.trackExpiries.values()) clearTimeout(timer);
    this.trackExpiries.clear();
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
        inputSinceTurnEnd: false,
        idle: false,
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
    const turnSeq = this.tracks.get(threadId)?.turnSeq ?? 0;
    // A late failure of the turn that already failed over is not a new failure.
    if (existing && existing.switchedAtTurnSeq === turnSeq) return;
    // A chain covers the failed turn and its re-sent turn only. A newer turn
    // (after the re-sent one ended some other way) starts a new chain, so
    // accounts that recovered since are eligible again.
    const chain =
      existing?.switchedAtTurnSeq !== undefined && turnSeq > existing.switchedAtTurnSeq + 1
        ? undefined
        : existing;
    const thread = this.deps.getThread(threadId);
    if (!thread || thread.archived) return;
    const pool = resolveAccountPool(this.deps.getAccountPools(), thread.agentKind);
    if (!pool) return;
    const now = this.now();
    if (classifyFailure(reason, this.failureAvailabilityOf(thread.agentKind, now)) !== "usage") {
      return;
    }
    this.markExhausted(thread.agentKind, now);
    if (thread.presentationMode !== "gui") {
      this.suggestForTerminal(thread, pool);
      return;
    }
    if (this.deps.canSwitchThread && !this.deps.canSwitchThread(threadId)) return;
    const track = this.track(threadId);
    // An idle thread's error interrupted no work: switching would start an
    // unrequested turn. The mark above still steers other threads away.
    if (track.idle) return;

    const claimed = chain ?? { tried: new Set<string>(), inFlight: false, cancelled: false };
    claimed.tried.add(thread.agentKind);
    claimed.inFlight = true;
    claimed.cancelled = false;
    this.chains.set(threadId, claimed);
    const claim: FailoverClaim = {
      threadId,
      fromAgentKind: thread.agentKind,
      pool,
      prompt: promptFromUserMessages(
        track.turnMessages.length > 0 ? track.turnMessages : track.lastMessages,
      ),
      turnSeq: track.turnSeq,
      chain: claimed,
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
      const replacesError = this.publish(
        exhaustedNotice({
          threadId: claim.threadId,
          providerLabel: labelOf(statuses, claim.pool.driver),
          message,
        }),
      );
      this.finish(claim, { kind: "failed", error: message }, true, releaseAfter(replacesError));
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
      const replacesError = this.publish(switchFailedNotice({ threadId: claim.threadId, message }));
      this.finish(claim, { kind: "failed", error: message }, true, releaseAfter(replacesError));
      return;
    }
    claim.chain.current = decision.to;
    delete claim.chain.switchingTo;
    claim.chain.switchedAtTurnSeq = claim.turnSeq;
    // The re-sent prompt is the next turn's input, even if it echoes no user message.
    const track = this.tracks.get(claim.threadId);
    if (track) track.inputSinceTurnEnd = true;
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

  /**
   * How a failure on `agentKind` is classified: by the default 100% rule (or a
   * recent host mark), never the pool's `switchAtPercent` (see `classifyFailure`).
   */
  private failureAvailabilityOf(agentKind: string, now: number): MemberAvailability {
    const usageId = this.usageIdFor(agentKind);
    return failureAvailability(this.snapshots.get(usageId), this.exhaustedMarks.get(usageId), now);
  }

  /**
   * Remember an out-of-usage failure so other threads skip the account too.
   * The mark also classifies later failures (`failureAvailability`), so it is
   * judged at the default 100% rule, never the pool's `switchAtPercent`.
   */
  private markExhausted(agentKind: string, now: number): void {
    for (const [usageId, mark] of this.exhaustedMarks) {
      if (mark.until <= now) this.exhaustedMarks.delete(usageId);
    }
    const usageId = this.usageIdFor(agentKind);
    const next = exhaustedMarkFor(
      this.snapshots.get(usageId),
      now,
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
    // The thread did not move on, so its error notification still stands.
    this.finish(claim, { kind: "continued" }, true, "publish");
    return true;
  }

  private releaseHeldNotifications(threadId: string, release: HeldNotificationRelease): void {
    const waiters = this.heldNotifications.get(threadId);
    if (!waiters) return;
    this.heldNotifications.delete(threadId);
    for (const settle of [...waiters]) settle(release === "publish");
  }

  /**
   * `notification` decides a held error notification (`holdErrorNotification`):
   * by default a thread that stays failed publishes it and a thread that moved
   * on drops it.
   */
  private finish(
    claim: FailoverClaim,
    outcome: AccountFailoverOutcome,
    closeChain: boolean,
    notification: HeldNotificationRelease = outcome.kind === "failed" ? "publish" : "drop",
  ): void {
    if (claim.settled) return;
    claim.settled = true;
    claim.chain.inFlight = false;
    if (closeChain && this.chains.get(claim.threadId) === claim.chain) {
      this.chains.delete(claim.threadId);
    }
    this.releaseHeldNotifications(claim.threadId, notification);
    if (this.disposed) return;
    try {
      this.deps.onFailoverSettled?.(claim.threadId, outcome);
    } catch (error) {
      this.report(error);
    }
  }

  /** True when the notice stands in for the thread's error notification (`publishNotice`). */
  private publish(notice: AccountPoolNotice): boolean {
    if (this.disposed) return false;
    try {
      return this.deps.publishNotice(notice) === true;
    } catch (error) {
      this.report(error);
      return false;
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
