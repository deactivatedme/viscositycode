/**
 * ViscosityCode: Cursor cloud-agent reads inside the SDK worker.
 *
 * Every call goes through the user-installed `@cursor/sdk` (`Agent.list`,
 * `Agent.get`, `Agent.listRuns`, `Agent.getRun`, `run.conversation()`) with
 * the caller's own key; nothing here talks HTTP itself. Results are trimmed
 * to the small, bounded shapes the worker protocol carries.
 */
import { asWorkerRecord, WorkerDiagnosticError } from "./sdkWorkerDiagnostics";
import type { RuntimeCloudRun, RuntimeSdkModule } from "./sdkWorkerRuntime";
import {
  CURSOR_SDK_WORKER_CLOUD_RESULT_MAX_CHARS,
  type CursorSdkWorkerAgentMessage,
  type CursorSdkWorkerCloudAgent,
  type CursorSdkWorkerCloudGetResult,
  type CursorSdkWorkerCloudListResult,
  type CursorSdkWorkerCloudRun,
  type CursorSdkWorkerCloudTranscriptResult,
} from "./sdkWorkerProtocol";

/** Cursor cloud agent ids; the SDK routes `bc-` ids to its cloud runtime. */
export function isCursorCloudAgentId(agentId: string | undefined): boolean {
  return agentId?.startsWith("bc-") === true;
}

/** The first create of an agent id that already exists server-side. */
export function isCursorCloudAgentIdConflict(error: unknown): boolean {
  const record = asWorkerRecord(error);
  return record?.status === 409 && record.code === "agent_id_conflict";
}

type CloudApi = Required<Pick<RuntimeSdkModule["Agent"], "list" | "get" | "listRuns" | "getRun">>;

function cloudApi(sdk: RuntimeSdkModule): CloudApi {
  const agent = sdk.Agent;
  if (
    typeof agent.list !== "function" ||
    typeof agent.get !== "function" ||
    typeof agent.listRuns !== "function" ||
    typeof agent.getRun !== "function"
  ) {
    throw new WorkerDiagnosticError(
      "cloud_unsupported",
      "The installed Cursor SDK does not support cloud agents. Update @cursor/sdk.",
    );
  }
  return agent as CloudApi;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function toCloudAgent(value: unknown): CursorSdkWorkerCloudAgent | undefined {
  const record = asWorkerRecord(value);
  const agentId = optionalString(record?.agentId);
  if (!record || !agentId) return undefined;
  const summary = optionalString(record.summary);
  const status = optionalString(record.status);
  const createdAt = optionalNumber(record.createdAt);
  const repos = Array.isArray(record.repos)
    ? record.repos.filter((repo): repo is string => typeof repo === "string")
    : undefined;
  return {
    agentId,
    name: optionalString(record.name) ?? agentId,
    ...(summary ? { summary } : {}),
    ...(status ? { status } : {}),
    ...(record.archived === true ? { archived: true } : {}),
    ...(createdAt !== undefined ? { createdAt } : {}),
    lastModified: optionalNumber(record.lastModified) ?? createdAt ?? 0,
    ...(repos?.length ? { repos } : {}),
  };
}

function toCloudRun(run: RuntimeCloudRun): CursorSdkWorkerCloudRun {
  const result = optionalString(run.result);
  const durationMs = optionalNumber(run.durationMs);
  return {
    id: run.id,
    status: optionalString(run.status) ?? "unknown",
    ...(result ? { result: result.slice(0, CURSOR_SDK_WORKER_CLOUD_RESULT_MAX_CHARS) } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(run.git?.branches ? { git: { branches: run.git.branches } } : {}),
  };
}

export async function listCursorCloudAgents(
  sdk: RuntimeSdkModule,
  input: { apiKey?: string; cursor?: string; limit: number },
): Promise<CursorSdkWorkerCloudListResult> {
  const page = await cloudApi(sdk).list({
    runtime: "cloud",
    limit: input.limit,
    ...(input.cursor ? { cursor: input.cursor } : {}),
    ...(input.apiKey ? { apiKey: input.apiKey } : {}),
  });
  const items = (Array.isArray(page?.items) ? page.items : []).flatMap((item) => {
    const agent = toCloudAgent(item);
    return agent ? [agent] : [];
  });
  return { items, ...(page?.nextCursor ? { nextCursor: page.nextCursor } : {}) };
}

export async function latestCursorCloudRun(
  sdk: RuntimeSdkModule,
  agentId: string,
  apiKey?: string,
): Promise<RuntimeCloudRun | undefined> {
  const page = await cloudApi(sdk).listRuns(agentId, {
    runtime: "cloud",
    limit: 1,
    ...(apiKey ? { apiKey } : {}),
  });
  return page?.items?.[0];
}

export async function getCursorCloudAgent(
  sdk: RuntimeSdkModule,
  input: { apiKey?: string; agentId: string },
): Promise<CursorSdkWorkerCloudGetResult> {
  const agent = toCloudAgent(
    await cloudApi(sdk).get(input.agentId, input.apiKey ? { apiKey: input.apiKey } : undefined),
  );
  if (!agent) {
    throw new WorkerDiagnosticError(
      "module_api_incompatible",
      "The installed Cursor SDK returned an invalid cloud agent.",
    );
  }
  const latest = await latestCursorCloudRun(sdk, input.agentId, input.apiKey);
  return { agent, ...(latest ? { latestRun: toCloudRun(latest) } : {}) };
}

function turnMessages(turns: unknown[]): CursorSdkWorkerCloudTranscriptResult["messages"] {
  const messages: CursorSdkWorkerCloudTranscriptResult["messages"] = [];
  for (const entry of turns) {
    const record = asWorkerRecord(entry);
    if (record?.type !== "agentConversationTurn") continue;
    const turn = asWorkerRecord(record.turn);
    const userText = optionalString(asWorkerRecord(turn?.userMessage)?.text);
    if (userText) messages.push({ role: "user", text: userText });
    const steps = Array.isArray(turn?.steps) ? turn.steps : [];
    const assistantText = steps
      .flatMap((step) => {
        const stepRecord = asWorkerRecord(step);
        if (stepRecord?.type !== "assistantMessage") return [];
        const text = optionalString(asWorkerRecord(stepRecord.message)?.text);
        return text ? [text] : [];
      })
      .join("\n\n");
    if (assistantText) messages.push({ role: "assistant", text: assistantText });
  }
  return messages;
}

/**
 * Text transcript of the newest `maxRuns` runs, kept newest-first until
 * `maxBytes` of text, then returned in chronological order.
 */
export async function readCursorCloudTranscript(
  sdk: RuntimeSdkModule,
  input: { apiKey?: string; agentId: string; maxRuns: number; maxBytes: number },
): Promise<CursorSdkWorkerCloudTranscriptResult> {
  const page = await cloudApi(sdk).listRuns(input.agentId, {
    runtime: "cloud",
    limit: input.maxRuns,
    ...(input.apiKey ? { apiKey: input.apiKey } : {}),
  });
  const runs = [...(page?.items ?? [])]
    .sort((left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0))
    .slice(0, input.maxRuns);
  const newestFirst: CursorSdkWorkerCloudTranscriptResult["messages"][] = [];
  let bytes = 0;
  let truncated = (page?.nextCursor ?? "") !== "";
  for (const run of runs) {
    // `conversation()` on a running run waits for it to finish; a follow
    // attaches to that run's live stream instead.
    if (run.status === "running") continue;
    const messages =
      typeof run.conversation === "function" ? turnMessages(await run.conversation()) : [];
    const size = messages.reduce((total, message) => total + Buffer.byteLength(message.text), 0);
    if (bytes + size > input.maxBytes) {
      truncated = true;
      break;
    }
    bytes += size;
    newestFirst.push(messages);
  }
  return { messages: newestFirst.reverse().flat(), truncated };
}

/** `messages.list` for a cloud agent, in the local store's message shape. */
export async function listCursorCloudAgentMessages(
  sdk: RuntimeSdkModule,
  input: { apiKey?: string; agentId: string; limit?: number; offset?: number },
): Promise<CursorSdkWorkerAgentMessage[]> {
  const transcript = await readCursorCloudTranscript(sdk, {
    agentId: input.agentId,
    // Each run's conversation opens one stream (Cursor allows 60 a minute).
    maxRuns: 20,
    maxBytes: 4 * 1024 * 1024,
    ...(input.apiKey ? { apiKey: input.apiKey } : {}),
  });
  const messages = transcript.messages.map((message, index): CursorSdkWorkerAgentMessage => ({
    type: message.role,
    uuid: `${input.agentId}:${index}`,
    agent_id: input.agentId,
    message: { role: message.role, content: [{ type: "text", text: message.text }] },
  }));
  const offset = input.offset ?? 0;
  return messages.slice(
    offset,
    input.limit === undefined ? undefined : offset + Math.max(0, input.limit),
  );
}
