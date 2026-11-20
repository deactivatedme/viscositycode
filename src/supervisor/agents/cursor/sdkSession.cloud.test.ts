import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectLocation, RuntimeEvent } from "@/shared/contracts";
import type { CursorCloudLaunchResult } from "./cloudLaunch";
import { cursorCloudAgentId, cursorSdkAgentId } from "./sdkSessionOptions";
import { CursorSdkSession, type CursorSdkSessionRuntime } from "./sdkSession";
import type { CursorSdkWorkerStartResult } from "./sdkWorkerProtocol";
import {
  baseConfig,
  FakeWorker,
  input,
  projectLocation,
  recordingListener,
  resultEvent,
} from "./sdkSession.testFixtures";

vi.mock("./sdkInstallPin", () => ({ readCursorSdkInstallPin: () => undefined }));
// Catalog keys land with the shared message handoff; assert the key chosen.
vi.mock("@/shared/messages", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/messages")>()),
  msg: (key: string, params?: Record<string, string>) =>
    params ? `${key} ${JSON.stringify(params)}` : key,
}));

class CloudWorker extends FakeWorker {
  readonly attach = vi.fn<(runId: string) => Promise<CursorSdkWorkerStartResult>>(
    async (runId) => ({ runId }),
  );
}

type ResolveLaunch = (location: ProjectLocation) => Promise<CursorCloudLaunchResult>;

const pushed: CursorCloudLaunchResult = {
  ok: true,
  repos: [{ url: "https://github.com/acme/widgets", startingRef: "feature/x" }],
};

afterEach(() => {
  vi.useRealTimers();
});

const IDLE_MS = 1_000;
const ownId = cursorCloudAgentId("thread-123456789");

/** A cloud session whose idle worker is reaped after `IDLE_MS` and replaced by the next worker. */
async function reapingCloudSession(workers: FakeWorker[]) {
  const spawnWorker = vi.fn<() => Promise<FakeWorker>>(async () => {
    const worker = workers.shift();
    if (!worker) throw new Error("No fake Cursor SDK worker remains.");
    return worker;
  });
  let id = 0;
  const session = await CursorSdkSession.create(
    input(),
    {
      spawnWorker,
      newId: () => `id-${++id}`,
      resolveCloudLaunch: async () => pushed,
      idleTimeoutMs: IDLE_MS,
    },
    { cloud: { autoCreatePR: true } },
  );
  const recorded = recordingListener();
  session.setListener(recorded.listener);
  await session.activate();
  return { session, recorded, spawnWorker };
}

async function cloudSession(
  worker: FakeWorker,
  runtime: CursorSdkSessionRuntime = { cloud: { autoCreatePR: true } },
  resolveCloudLaunch = vi.fn<ResolveLaunch>(async () => pushed),
) {
  let id = 0;
  const session = await CursorSdkSession.create(
    input(),
    { spawnWorker: async () => worker, newId: () => `id-${++id}`, resolveCloudLaunch },
    runtime,
  );
  const recorded = recordingListener();
  session.setListener(recorded.listener);
  await session.activate();
  return { session, recorded, resolveCloudLaunch };
}

describe("CursorSdkSession cloud runtime", () => {
  it("derives a stable bc- id per thread, distinct from the local id", () => {
    const id = cursorCloudAgentId("thread-123456789");
    expect(id).toMatch(/^bc-[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(cursorCloudAgentId("thread-123456789")).toBe(id);
    expect(id.slice(3)).not.toBe(cursorSdkAgentId("thread-123456789").slice(6));
  });

  it("creates a cloud agent on the pushed branch with no host MCP or local options", async () => {
    const worker = new FakeWorker();
    worker.initialize.mockResolvedValue({ agentId: cursorCloudAgentId("thread-123456789") });
    const { session, resolveCloudLaunch } = await cloudSession(worker);

    const id = await session.openThread(baseConfig);

    expect(resolveCloudLaunch).toHaveBeenCalledWith(projectLocation);
    expect(worker.initialize).toHaveBeenCalledWith({
      createOptions: {
        model: expect.objectContaining({ id: "composer" }),
        name: "poracode/thread-1",
        cloud: { repos: pushed.ok ? pushed.repos : [], autoCreatePR: true },
        mode: "agent",
        agentId: cursorCloudAgentId("thread-123456789"),
      },
    });
    expect(id).toBe(`sdk:${cursorCloudAgentId("thread-123456789")}`);

    const turn = session.startTurn("ship it", baseConfig);
    await vi.waitFor(() => expect(worker.start).toHaveBeenCalledOnce());
    const options = worker.start.mock.calls[0]?.[0].options;
    expect(options).not.toHaveProperty("local");
    expect(options).not.toHaveProperty("mcpServers");
    worker.emit(resultEvent());
    await turn;
  });

  it("refuses an unpushed branch before any Cursor call", async () => {
    const worker = new FakeWorker();
    const { session } = await cloudSession(
      worker,
      { cloud: {} },
      vi.fn<ResolveLaunch>(async () => ({
        ok: false as const,
        code: "no-upstream" as const,
        message: "Push feature/x to origin first.",
      })),
    );

    await expect(session.openThread(baseConfig)).rejects.toThrow("Push feature/x to origin first.");
    expect(worker.listModels).not.toHaveBeenCalled();
    expect(worker.initialize).not.toHaveBeenCalled();
  });

  it("resumes an sdk:bc- ref as cloud and attaches to its running run", async () => {
    const worker = new CloudWorker();
    worker.initialize.mockResolvedValue({ agentId: "bc-1", activeRunId: "run-live" });
    const { session, recorded, resolveCloudLaunch } = await cloudSession(worker, {});

    await session.openThread(baseConfig, {
      providerSessionId: "sdk:bc-1",
      discoveredAt: "2026-11-20T00:00:00.000Z",
    });

    expect(resolveCloudLaunch).not.toHaveBeenCalled();
    expect(worker.initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        resumeAgentId: "bc-1",
        createOptions: expect.objectContaining({ cloud: {} }),
      }),
    );
    expect(worker.attach).toHaveBeenCalledWith("run-live");
    expect(recorded.updates.at(-1)).toMatchObject({ status: "working" });

    worker.emit(resultEvent("finished", "run-live"));
    await vi.waitFor(() => expect(recorded.updates.at(-1)).toMatchObject({ status: "idle" }));
  });

  it("posts one notice with the pushed branch, pull request and Cursor link", async () => {
    const worker = new FakeWorker();
    worker.initialize.mockResolvedValue({ agentId: "bc-1" });
    const { session, recorded } = await cloudSession(worker);
    await session.openThread(baseConfig);

    const turn = session.startTurn("open a PR", baseConfig);
    await vi.waitFor(() => expect(worker.start).toHaveBeenCalledOnce());
    worker.emit({
      type: "result",
      requestId: "request-1",
      runId: "run-1",
      result: {
        id: "run-1",
        status: "finished",
        git: {
          branches: [
            { repoUrl: "github.com/acme/widgets", branch: "cursor/fix", prUrl: "https://pr/1" },
          ],
        },
      },
    });
    await turn;

    const notices = recorded.events.filter(
      (event): event is Extract<RuntimeEvent, { type: "warning" }> =>
        event.type === "warning" && event.presentation === "notice",
    );
    expect(notices).toHaveLength(1);
    expect(notices[0]?.message.split("\n")).toEqual([
      'cursor.cloud.branchPushed {"branch":"cursor/fix","repo":"github.com/acme/widgets"}',
      'cursor.cloud.pullRequest {"url":"https://pr/1"}',
      'cursor.cloud.openInCursor {"url":"https://cursor.com/agents/bc-1"}',
    ]);
  });

  it("keeps resuming an existing local sdk:agent- ref byte-identically on a cloud profile", async () => {
    const ref = { providerSessionId: "sdk:agent-1", discoveredAt: "2026-11-20T00:00:00.000Z" };
    const localWorker = new FakeWorker();
    const local = await cloudSession(localWorker, {});
    await local.session.openThread(baseConfig, ref);

    const cloudProfileWorker = new FakeWorker();
    const cloud = await cloudSession(cloudProfileWorker);
    await cloud.session.openThread(baseConfig, ref);

    expect(cloud.resolveCloudLaunch).not.toHaveBeenCalled();
    expect(cloudProfileWorker.initialize.mock.calls).toEqual(localWorker.initialize.mock.calls);
    expect(localWorker.initialize.mock.calls[0]?.[0].createOptions).toHaveProperty("local");
    expect(localWorker.initialize.mock.calls[0]?.[0].createOptions).not.toHaveProperty("cloud");
  });

  it("creates again, keeping the repo, when the worker is replaced before the first send landed", async () => {
    vi.useFakeTimers();
    const first = new FakeWorker();
    first.initialize.mockResolvedValue({ agentId: ownId });
    first.start.mockRejectedValue(new Error("Cursor plan required"));
    const second = new FakeWorker();
    second.initialize.mockResolvedValue({ agentId: ownId });
    second.start.mockResolvedValue({ runId: "run-2" });
    const third = new FakeWorker();
    third.initialize.mockResolvedValue({ agentId: ownId });
    third.start.mockResolvedValue({ runId: "run-3" });
    const { session } = await reapingCloudSession([first, second, third]);
    await session.openThread(baseConfig);

    await session.startTurn("first", baseConfig);
    await vi.advanceTimersByTimeAsync(IDLE_MS);
    expect(first.dispose).toHaveBeenCalledOnce();

    const retry = session.startTurn("retry", baseConfig);
    await vi.waitFor(() => expect(second.start).toHaveBeenCalledOnce());
    const replacement = second.initialize.mock.calls[0]?.[0];
    expect(replacement).not.toHaveProperty("resumeAgentId");
    expect(replacement?.createOptions).toMatchObject({
      agentId: ownId,
      cloud: { repos: pushed.ok ? pushed.repos : [], autoCreatePR: true },
    });
    second.emit(resultEvent("finished", "run-2"));
    await retry;

    // Once a send is accepted the agent exists: later replacements resume it.
    await vi.advanceTimersByTimeAsync(IDLE_MS);
    const later = session.startTurn("later", baseConfig);
    await vi.waitFor(() => expect(third.start).toHaveBeenCalledOnce());
    expect(third.initialize.mock.calls[0]?.[0]).toMatchObject({
      resumeAgentId: ownId,
      createOptions: { cloud: {} },
    });
    expect(third.initialize.mock.calls[0]?.[0].createOptions).not.toHaveProperty("agentId");
    third.emit(resultEvent("finished", "run-3"));
    await later;
  });

  it("recreates its own cloud agent after a restart when Cursor never received it", async () => {
    const first = new FakeWorker();
    first.initialize.mockResolvedValue({ agentId: ownId, cloudAgentMissing: true });
    const second = new FakeWorker();
    second.initialize.mockResolvedValue({ agentId: ownId });
    second.start.mockResolvedValue({ runId: "run-1" });
    const { session } = await reapingCloudSession([first, second]);
    await session.openThread(baseConfig, {
      providerSessionId: `sdk:${ownId}`,
      discoveredAt: "2026-11-20T00:00:00.000Z",
    });

    const turn = session.startTurn("first", baseConfig);
    await vi.waitFor(() => expect(second.start).toHaveBeenCalledOnce());
    expect(first.start).not.toHaveBeenCalled();
    const replacement = second.initialize.mock.calls[0]?.[0];
    expect(replacement).not.toHaveProperty("resumeAgentId");
    expect(replacement?.createOptions).toMatchObject({
      agentId: ownId,
      cloud: { repos: pushed.ok ? pushed.repos : [], autoCreatePR: true },
    });
    second.emit(resultEvent("finished", "run-1"));
    await turn;
  });

  it("leaves a missing followed agent alone instead of creating it again", async () => {
    const worker = new FakeWorker();
    worker.initialize.mockResolvedValue({ agentId: "bc-foreign", cloudAgentMissing: true });
    const { session, resolveCloudLaunch } = await cloudSession(worker);
    await session.openThread(baseConfig, {
      providerSessionId: "sdk:bc-foreign",
      discoveredAt: "2026-11-20T00:00:00.000Z",
    });
    expect(resolveCloudLaunch).not.toHaveBeenCalled();
  });
});
