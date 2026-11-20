/**
 * ViscosityCode: lists and follows cloud agents from every adapter that
 * declares `cloudAgents`. Pull-based and bounded: each source is cached for a
 * short TTL, sends one request at a time, and backs off after rate limits or
 * outages. Following replays the agent's conversation through the regular
 * `thread-runtime-events` path and then records its resume reference with a
 * `thread-state` event, so the host's single writer persists both.
 */
import {
  CLOUD_AGENT_PAGE_LIMIT,
  CLOUD_AGENT_RESULT_MAX_CHARS,
  type CloudAgentDetail,
  type CloudAgentSourceErrorCode,
  type CloudAgentSourceErrorInfo,
  type CloudAgentSourceListing,
  type CloudAgentSummary,
  type FollowCloudAgentPayload,
  type FollowCloudAgentResult,
  type GetCloudAgentPayload,
  type ListCloudAgentsPayload,
  type ListCloudAgentsResult,
} from "@/shared/contracts";
import type { SupervisorEvent } from "@/shared/ipc";
import { msg } from "@/shared/messages";
import type { AgentAdapter } from "../agents/base";
import {
  CloudAgentSourceError,
  type CloudAgentSource,
  type CloudAgentSourcePage,
} from "../agents/base/cloudAgents";
import { buildReplayEvents } from "../sessionImport/service";

export const CLOUD_AGENTS_CACHE_TTL_MS = 30_000;
export const CLOUD_AGENTS_BACKOFF_BASE_MS = 60_000;
export const CLOUD_AGENTS_BACKOFF_MAX_MS = 15 * 60_000;
/** A source call that has not settled by then counts as `unavailable`, so one hang never blocks the queue. */
export const CLOUD_AGENTS_REQUEST_TIMEOUT_MS = 30_000;
/** Newest messages kept when a followed conversation is longer. */
export const CLOUD_AGENT_FOLLOW_MAX_MESSAGES = 1_000;
const REPLAY_BATCH_SIZE = 200;

interface SourceState {
  /** The adapter's source object; a rebuilt profile (new key) starts fresh. */
  source: CloudAgentSource;
  pages: Map<string, { page: CloudAgentSourcePage; at: number }>;
  details: Map<string, CloudAgentDetail>;
  /** Tail of this source's request chain: one request at a time. */
  queue: Promise<unknown>;
  /** In-flight list request per page key, shared by concurrent callers. */
  inflight: Map<string, Promise<CloudAgentSourcePage>>;
  backoffUntil: number;
  failures: number;
  /** What caused the current backoff, reported while it lasts. */
  backoffCode: CloudAgentSourceErrorCode;
}

function toSourceError(error: unknown): CloudAgentSourceError {
  return error instanceof CloudAgentSourceError
    ? error
    : new CloudAgentSourceError("unavailable", msg("cloudAgents.unavailable"), { cause: error });
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new CloudAgentSourceError("unavailable", msg("cloudAgents.unavailable"))),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export class CloudAgentsService {
  private readonly states = new Map<string, SourceState>();
  private readonly following = new Set<string>();

  constructor(
    private readonly adapters: ReadonlyMap<string, AgentAdapter>,
    private readonly emit: (event: SupervisorEvent) => void,
    private readonly now: () => number = Date.now,
  ) {}

  async list(payload: ListCloudAgentsPayload): Promise<ListCloudAgentsResult> {
    const kinds = [...this.adapters.values()]
      .filter(
        (adapter) =>
          adapter.cloudAgents && (!payload.agentKind || adapter.kind === payload.agentKind),
      )
      .map((adapter) => adapter.kind);
    // Sources fail independently: one bad key never hides the others.
    const sources = await Promise.all(kinds.map((kind) => this.listSource(kind, payload)));
    return { sources, fetchedAt: this.now() };
  }

  async get(payload: GetCloudAgentPayload): Promise<CloudAgentDetail> {
    const state = this.requireState(payload.agentKind);
    const listed = this.listedSummary(state, payload.agentId);
    const cached = state.details.get(payload.agentId);
    if (cached && listed && cached.updatedAt === listed.updatedAt) return cached;
    const detail = await this.request(state, () => state.source.getAgent(payload.agentId));
    const result: CloudAgentDetail = {
      ...detail,
      agentKind: payload.agentKind,
      ...(detail.latestRun
        ? {
            latestRun: {
              ...detail.latestRun,
              ...(detail.latestRun.result !== undefined
                ? { result: truncate(detail.latestRun.result, CLOUD_AGENT_RESULT_MAX_CHARS) }
                : {}),
            },
          }
        : {}),
    };
    state.details.set(payload.agentId, result);
    return result;
  }

  async follow(payload: FollowCloudAgentPayload): Promise<FollowCloudAgentResult> {
    const state = this.requireState(payload.agentKind);
    const key = `${payload.agentKind}:${payload.agentId}`;
    if (this.following.has(key)) throw new Error(msg("cloudAgents.followInProgress"));
    this.following.add(key);
    try {
      // Ownership check: the same key that will resume the agent must see it.
      const detail = await this.request(state, () => state.source.getAgent(payload.agentId));
      const transcript = await this.request(state, () =>
        state.source.readTranscript(payload.agentId),
      );
      const messages = transcript.messages.slice(-CLOUD_AGENT_FOLLOW_MAX_MESSAGES);
      const events = buildReplayEvents(payload.threadId, { messages });
      for (let index = 0; index < events.length; index += REPLAY_BATCH_SIZE) {
        this.emit({
          type: "thread-runtime-events",
          threadId: payload.threadId,
          events: events.slice(index, index + REPLAY_BATCH_SIZE),
        });
      }
      this.emit({
        type: "thread-state",
        threadId: payload.threadId,
        agentKind: payload.agentKind,
        status: "inactive",
        attention: "none",
        canResumeWithConfig: true,
        sessionRef: {
          providerSessionId: state.source.providerSessionId(payload.agentId),
          discoveredAt: new Date(this.now()).toISOString(),
        },
      });
      const truncated =
        transcript.truncated === true || messages.length < transcript.messages.length;
      return {
        messageCount: messages.length,
        running: detail.status === "running" || detail.latestRun?.status === "running",
        ...(truncated ? { truncated: true } : {}),
      };
    } finally {
      this.following.delete(key);
    }
  }

  private async listSource(
    agentKind: string,
    payload: ListCloudAgentsPayload,
  ): Promise<CloudAgentSourceListing> {
    const state = this.requireState(agentKind);
    const pageKey = payload.cursor ?? "";
    const cached = state.pages.get(pageKey);
    const toListing = (page: CloudAgentSourcePage, error?: CloudAgentSourceErrorInfo) => ({
      agentKind,
      items: page.items
        .slice(0, CLOUD_AGENT_PAGE_LIMIT)
        .map((item): CloudAgentSummary => ({ ...item, agentKind })),
      ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
      ...(error ? { error } : {}),
    });
    if (cached && !payload.refresh && this.now() - cached.at < CLOUD_AGENTS_CACHE_TTL_MS) {
      return toListing(cached.page);
    }
    let pending = state.inflight.get(pageKey);
    if (!pending) {
      pending = this.request(state, () => state.source.listAgents(payload.cursor)).finally(() =>
        state.inflight.delete(pageKey),
      );
      state.inflight.set(pageKey, pending);
    }
    try {
      const page = await pending;
      state.pages.set(pageKey, { page, at: this.now() });
      return toListing(page);
    } catch (error) {
      const { code } = toSourceError(error);
      const retryAfterMs = Math.max(0, state.backoffUntil - this.now());
      // The last good page stays visible, marked stale by the error.
      return toListing(cached?.page ?? { items: [] }, {
        code,
        ...(retryAfterMs > 0 ? { retryAfterMs } : {}),
      });
    }
  }

  /** Runs one source request after the previous one, honoring the backoff. */
  private request<T>(state: SourceState, run: () => Promise<T>): Promise<T> {
    const result = state.queue.then(async () => {
      const waitMs = state.backoffUntil - this.now();
      if (waitMs > 0) {
        throw new CloudAgentSourceError(state.backoffCode, msg("cloudAgents.backingOff"), {
          retryAfterMs: waitMs,
        });
      }
      try {
        const value = await withTimeout(run(), CLOUD_AGENTS_REQUEST_TIMEOUT_MS);
        state.failures = 0;
        return value;
      } catch (error) {
        const sourceError = toSourceError(error);
        // Auth and plan errors need the user to act, not a backoff; the next poll retries once.
        if (sourceError.code === "rate_limited" || sourceError.code === "unavailable") {
          state.failures += 1;
          const backoff = Math.min(
            CLOUD_AGENTS_BACKOFF_BASE_MS * 2 ** (state.failures - 1),
            CLOUD_AGENTS_BACKOFF_MAX_MS,
          );
          // A provider's Retry-After never pauses the source longer than our own cap.
          state.backoffUntil =
            this.now() + Math.min(sourceError.retryAfterMs ?? backoff, CLOUD_AGENTS_BACKOFF_MAX_MS);
          state.backoffCode = sourceError.code;
        }
        throw sourceError;
      }
    });
    state.queue = result.catch(() => undefined);
    return result;
  }

  private requireState(agentKind: string): SourceState {
    const source = this.adapters.get(agentKind)?.cloudAgents;
    if (!source) throw new Error(msg("cloudAgents.unsupported"));
    let state = this.states.get(agentKind);
    if (state?.source !== source) {
      state = {
        source,
        pages: new Map(),
        details: new Map(),
        queue: Promise.resolve(),
        inflight: new Map(),
        backoffUntil: 0,
        failures: 0,
        backoffCode: "unavailable",
      };
      this.states.set(agentKind, state);
    }
    return state;
  }

  private listedSummary(state: SourceState, agentId: string) {
    for (const { page } of state.pages.values()) {
      const match = page.items.find((item) => item.id === agentId);
      if (match) return match;
    }
    return undefined;
  }
}
