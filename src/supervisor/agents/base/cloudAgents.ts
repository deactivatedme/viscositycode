/**
 * ViscosityCode: provider hook for listing and following cloud agents (agents
 * a provider runs on its own infrastructure). A provider declares
 * `AgentAdapter.cloudAgents`; the shared service
 * (`src/supervisor/cloudAgents/service.ts`) owns caching, one-request-at-a-time,
 * backoff, page bounds and replay, and only ever sees the normalized shapes
 * below. Vendor payloads and statuses are normalized inside the provider.
 */
import type {
  CloudAgentDetail,
  CloudAgentSourceErrorCode,
  CloudAgentSummary,
} from "@/shared/contracts";
import type { ImportedTranscript } from "./sessionImport";

/** A listed agent as the provider reports it; the service adds `agentKind`. */
export type CloudAgentSourceSummary = Omit<CloudAgentSummary, "agentKind">;
export type CloudAgentSourceDetail = Omit<CloudAgentDetail, "agentKind">;

export interface CloudAgentSourcePage {
  items: CloudAgentSourceSummary[];
  nextCursor?: string;
}

/** Conversation for replay, oldest message first. */
export interface CloudAgentTranscript extends ImportedTranscript {
  /** The provider dropped older messages to stay within its own bounds. */
  truncated?: boolean;
}

export interface CloudAgentSource {
  /** One page of agents the profile's own key can see, newest first. */
  listAgents(cursor?: string): Promise<CloudAgentSourcePage>;
  /** Latest state of one agent; rejects when this key cannot see it (the follow ownership check). */
  getAgent(agentId: string): Promise<CloudAgentSourceDetail>;
  /** Bounded conversation for replay into a followed thread. */
  readTranscript(agentId: string): Promise<CloudAgentTranscript>;
  /** Resume reference a followed thread stores (`SessionRef.providerSessionId`). */
  providerSessionId(agentId: string): string;
}

/**
 * The only error a source should throw. Never carries the key or a raw
 * response body; anything else a source throws counts as `unavailable`.
 */
export class CloudAgentSourceError extends Error {
  readonly code: CloudAgentSourceErrorCode;
  /** From the provider's Retry-After, when it sent one. */
  readonly retryAfterMs: number | undefined;

  constructor(
    code: CloudAgentSourceErrorCode,
    message: string,
    options?: { cause?: unknown; retryAfterMs?: number },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "CloudAgentSourceError";
    this.code = code;
    this.retryAfterMs = options?.retryAfterMs;
  }
}
