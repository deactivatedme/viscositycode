/**
 * ViscosityCode: Cursor's implementation of the cloud-agent listing hook
 * (`AgentAdapter.cloudAgents`).
 *
 * Reads the cloud agents a Cursor cloud profile's own CURSOR_API_KEY can see
 * through the supervisor-owned SDK worker (`cloud.*` methods), and normalizes
 * Cursor's statuses, timestamps and errors into the provider-neutral shapes
 * of `../base/cloudAgents`. The key only travels supervisor → worker.
 */
import type { CloudAgentStatus, ProjectLocation } from "@/shared/contracts";
import { msg } from "@/shared/messages";
import { assertAgentLaunchAllowed } from "@/supervisor/agentLaunchGuard";
import {
  CloudAgentSourceError,
  detectProbeLocation,
  type CloudAgentSource,
  type CloudAgentSourceSummary,
} from "../base";
import { readCursorSdkInstallPin } from "./sdkInstallPin";
import { CursorSdkWorkerRpcError, spawnCursorSdkWorker } from "./sdkWorkerClient";
import type {
  CursorSdkWorkerCloudAgent,
  CursorSdkWorkerCloudGetResult,
  CursorSdkWorkerCloudListResult,
  CursorSdkWorkerCloudTranscriptResult,
} from "./sdkWorkerProtocol";
import { CURSOR_SDK_SESSION_PREFIX } from "./structuredRuntime";

export const CURSOR_CLOUD_PAGE_SIZE = 50;
const TRANSCRIPT_MAX_RUNS = 20;
const TRANSCRIPT_MAX_BYTES = 512 * 1024;

/** The worker calls this source makes; `CursorSdkWorkerClient` implements them. */
export interface CursorCloudWorker {
  cloudList(input: {
    apiKey?: string;
    cursor?: string;
    limit: number;
  }): Promise<CursorSdkWorkerCloudListResult>;
  cloudGet(input: { apiKey?: string; agentId: string }): Promise<CursorSdkWorkerCloudGetResult>;
  cloudTranscript(input: {
    apiKey?: string;
    agentId: string;
    maxRuns: number;
    maxBytes: number;
  }): Promise<CursorSdkWorkerCloudTranscriptResult>;
  dispose(): Promise<void>;
}

export interface CursorCloudAgentSourceDependencies {
  spawnWorker(location: ProjectLocation): Promise<CursorCloudWorker>;
}

const DEFAULT_DEPENDENCIES: CursorCloudAgentSourceDependencies = {
  spawnWorker: (projectLocation) => {
    const pinnedRoot = projectLocation.kind === "wsl" ? undefined : readCursorSdkInstallPin();
    return spawnCursorSdkWorker({ projectLocation, ...(pinnedRoot ? { pinnedRoot } : {}) });
  },
};

/** Cursor's page for one cloud agent (the REST `url` field; the SDK omits it). */
export function cursorCloudAgentWebUrl(agentId: string): string {
  return `https://cursor.com/agents/${encodeURIComponent(agentId)}`;
}

/**
 * Agent status (latest run's state) or run status, in either SDK or REST
 * spelling. Listed agents carry none, which is `unknown`.
 */
export function normalizeCursorCloudStatus(status: string | undefined): CloudAgentStatus {
  switch (status?.toLowerCase()) {
    case "idle":
      return "idle";
    case "creating":
    case "running":
    case "waiting_for_background_work":
      return "running";
    case "finished":
    case "completed":
      return "finished";
    case "error":
    case "failed":
      return "error";
    case "cancelled":
    case "canceled":
      return "cancelled";
    case "expired":
      return "expired";
    default:
      return "unknown";
  }
}

/**
 * The typed error the listing service expects. Classifies on the error's name
 * and code only, never its message, and never carries the key or a body.
 */
export function cursorCloudSourceError(error: unknown): CloudAgentSourceError {
  if (error instanceof CloudAgentSourceError) return error;
  const name = error instanceof Error ? error.name : "";
  const code = error instanceof CursorSdkWorkerRpcError ? (error.code ?? "") : "";
  const reason = `${name} ${code}`;
  const typed = (kind: CloudAgentSourceError["code"], message: string) =>
    new CloudAgentSourceError(kind, message, { cause: error });
  if (/AuthenticationError|auth_invalid|auth_missing|unauthenticated|\b401\b/i.test(reason)) {
    return typed("auth", msg("cursor.cloud.authFailed"));
  }
  if (/RateLimitError|rate[_ -]?limit|too_many|resource_exhausted|\b429\b/i.test(reason)) {
    return typed("rate_limited", msg("cursor.cloud.rateLimited"));
  }
  if (/plan_required|feature_unavailable|key_not_supported|forbidden|\b403\b/i.test(reason)) {
    return typed("plan", msg("cursor.cloud.planRequired"));
  }
  return typed("unavailable", msg("cursor.cloud.unavailable"));
}

function isoTime(epochMs: number): string {
  const date = new Date(epochMs);
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}

function toSummary(agent: CursorSdkWorkerCloudAgent): CloudAgentSourceSummary {
  return {
    id: agent.agentId,
    providerSessionId: `${CURSOR_SDK_SESSION_PREFIX}${agent.agentId}`,
    name: agent.name,
    // The SDK fills `summary` with the name when Cursor has none.
    ...(agent.summary && agent.summary !== agent.name ? { summary: agent.summary } : {}),
    status: normalizeCursorCloudStatus(agent.status),
    ...(agent.archived ? { archived: true } : {}),
    ...(agent.createdAt !== undefined ? { createdAt: isoTime(agent.createdAt) } : {}),
    updatedAt: isoTime(agent.lastModified),
    webUrl: cursorCloudAgentWebUrl(agent.agentId),
    repos: (agent.repos ?? []).map((url) => ({ url })),
  };
}

export function createCursorCloudAgentSource(
  apiKey: string,
  dependencies: CursorCloudAgentSourceDependencies = DEFAULT_DEPENDENCIES,
): CloudAgentSource {
  // shortcut: one short-lived worker per read; the listing service already
  // caches and serializes per source. Keep a warm worker if reads get hot.
  async function withWorker<T>(read: (worker: CursorCloudWorker) => Promise<T>): Promise<T> {
    let worker: CursorCloudWorker | undefined;
    try {
      assertAgentLaunchAllowed("session-probe");
      worker = await dependencies.spawnWorker(detectProbeLocation(undefined));
      return await read(worker);
    } catch (error) {
      throw cursorCloudSourceError(error);
    } finally {
      await worker?.dispose().catch(() => undefined);
    }
  }

  return {
    listAgents: (cursor) =>
      withWorker(async (worker) => {
        const page = await worker.cloudList({
          apiKey,
          limit: CURSOR_CLOUD_PAGE_SIZE,
          ...(cursor ? { cursor } : {}),
        });
        return {
          items: page.items.map(toSummary),
          ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
        };
      }),
    getAgent: (agentId) =>
      withWorker(async (worker) => {
        const { agent, latestRun } = await worker.cloudGet({ apiKey, agentId });
        const runStatus = latestRun ? normalizeCursorCloudStatus(latestRun.status) : undefined;
        return {
          ...toSummary(agent),
          // Listed agents carry no run state; the latest run is the agent's status.
          ...(runStatus ? { status: runStatus } : {}),
          ...(latestRun && runStatus
            ? {
                latestRun: {
                  status: runStatus,
                  ...(latestRun.result ? { result: latestRun.result } : {}),
                  ...(latestRun.durationMs !== undefined
                    ? { durationMs: latestRun.durationMs }
                    : {}),
                },
              }
            : {}),
          branches: latestRun?.git?.branches ?? [],
        };
      }),
    readTranscript: (agentId) =>
      withWorker(async (worker) => {
        const transcript = await worker.cloudTranscript({
          apiKey,
          agentId,
          maxRuns: TRANSCRIPT_MAX_RUNS,
          maxBytes: TRANSCRIPT_MAX_BYTES,
        });
        return {
          providerSessionId: `${CURSOR_SDK_SESSION_PREFIX}${agentId}`,
          messages: transcript.messages,
          ...(transcript.truncated ? { truncated: true } : {}),
        };
      }),
    providerSessionId: (agentId) => `${CURSOR_SDK_SESSION_PREFIX}${agentId}`,
  };
}
