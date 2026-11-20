import { z } from "zod";

/**
 * ViscosityCode: cloud agents a provider runs on its own infrastructure.
 * Agents that declare `AgentAdapter.cloudAgents` expose them; the supervisor
 * lists them with the profile's own key, and following one replays its
 * conversation into a thread whose `sessionRef` resumes it. Desktop-only in
 * v1: the procedures are local-shell and never enter the remote-v3 contract.
 */

export const CLOUD_AGENT_STATUSES = [
  "running",
  "finished",
  "error",
  "cancelled",
  "expired",
  "idle",
  "unknown",
] as const;
export type CloudAgentStatus = (typeof CLOUD_AGENT_STATUSES)[number];

export const CLOUD_AGENT_SOURCE_ERROR_CODES = [
  "auth",
  "plan",
  "rate_limited",
  "unavailable",
] as const;
export type CloudAgentSourceErrorCode = (typeof CLOUD_AGENT_SOURCE_ERROR_CODES)[number];

/** A latest-run result longer than this is cut before it leaves the supervisor. */
export const CLOUD_AGENT_RESULT_MAX_CHARS = 4096;
/** One listed page never carries more than this many agents. */
export const CLOUD_AGENT_PAGE_LIMIT = 50;

export interface CloudAgentRepo {
  url: string;
}

export interface CloudAgentSummary {
  /** Agent (profile) whose key listed this agent; a follow resumes with the same key. */
  agentKind: string;
  id: string;
  /** Resume reference a followed thread stores (`SessionRef.providerSessionId`). */
  providerSessionId: string;
  name: string;
  summary?: string;
  status: CloudAgentStatus;
  archived?: boolean;
  /** ISO timestamps. */
  createdAt?: string;
  updatedAt: string;
  /** The provider's own page for this agent. */
  webUrl?: string;
  repos: CloudAgentRepo[];
}

export interface CloudAgentBranch {
  repoUrl: string;
  branch?: string;
  prUrl?: string;
}

export interface CloudAgentDetail extends CloudAgentSummary {
  latestRun?: { status: CloudAgentStatus; result?: string; durationMs?: number };
  branches: CloudAgentBranch[];
}

export interface CloudAgentSourceErrorInfo {
  code: CloudAgentSourceErrorCode;
  /** Set while the source is backing off; the next request waits at least this long. */
  retryAfterMs?: number;
}

export interface CloudAgentSourceListing {
  agentKind: string;
  items: CloudAgentSummary[];
  nextCursor?: string;
  /** A failed source keeps its last cached items (stale) next to the error. */
  error?: CloudAgentSourceErrorInfo;
}

const agentKind = z.string().min(1).max(200);
const agentId = z.string().min(1).max(256);

export const listCloudAgentsPayloadSchema = z.object({
  agentKind: agentKind.optional(),
  /** Opaque provider page cursor from a previous `nextCursor`. */
  cursor: z.string().min(1).max(4096).optional(),
  /** Skips the cache TTL (never the backoff). */
  refresh: z.boolean().optional(),
});
export type ListCloudAgentsPayload = z.infer<typeof listCloudAgentsPayloadSchema>;

export interface ListCloudAgentsResult {
  sources: CloudAgentSourceListing[];
  /** Epoch ms. */
  fetchedAt: number;
}

export const getCloudAgentPayloadSchema = z.object({ agentKind, agentId });
export type GetCloudAgentPayload = z.infer<typeof getCloudAgentPayloadSchema>;

export const followCloudAgentPayloadSchema = z.object({
  /** Thread the renderer already created (inactive GUI row); the conversation is replayed into it. */
  threadId: z.string().min(1).max(256),
  agentKind,
  agentId,
});
export type FollowCloudAgentPayload = z.infer<typeof followCloudAgentPayloadSchema>;

export interface FollowCloudAgentResult {
  messageCount: number;
  /** The agent has an active run; the client should start the thread so it attaches. */
  running: boolean;
  /** Older messages were dropped to stay within the replay bound. */
  truncated?: boolean;
}
