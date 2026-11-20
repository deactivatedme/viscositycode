import { describe, expect, it, vi } from "vitest";
import { CloudAgentSourceError } from "../base";
import {
  createCursorCloudAgentSource,
  cursorCloudSourceError,
  normalizeCursorCloudStatus,
  type CursorCloudWorker,
} from "./cloudAgentSource";
import { CursorSdkWorkerRpcError } from "./sdkWorkerClient";

// Catalog keys land with the shared message handoff; assert the key chosen.
vi.mock("@/shared/messages", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/messages")>()),
  msg: (key: string) => key,
}));
vi.mock("./sdkInstallPin", () => ({ readCursorSdkInstallPin: () => undefined }));

function fakeWorker(overrides: Partial<CursorCloudWorker> = {}) {
  const worker: CursorCloudWorker = {
    cloudList: vi.fn<CursorCloudWorker["cloudList"]>(async () => ({
      items: [
        {
          agentId: "bc-1",
          name: "Fix login",
          summary: "Fix login",
          lastModified: Date.UTC(2026, 10, 20),
          createdAt: Date.UTC(2026, 10, 19),
          repos: ["github.com/acme/widgets"],
          archived: true,
        },
      ],
      nextCursor: "page-2",
    })),
    cloudGet: vi.fn<CursorCloudWorker["cloudGet"]>(async () => ({
      agent: { agentId: "bc-1", name: "Fix login", lastModified: Date.UTC(2026, 10, 20) },
      latestRun: {
        id: "run-1",
        status: "finished",
        result: "Done",
        durationMs: 1200,
        git: {
          branches: [
            { repoUrl: "github.com/acme/widgets", branch: "cursor/fix", prUrl: "https://pr/1" },
          ],
        },
      },
    })),
    cloudTranscript: vi.fn<CursorCloudWorker["cloudTranscript"]>(async () => ({
      messages: [{ role: "user" as const, text: "hi" }],
      truncated: true,
    })),
    dispose: vi.fn<CursorCloudWorker["dispose"]>(async () => {}),
    ...overrides,
  };
  return worker;
}

describe("normalizeCursorCloudStatus", () => {
  it.each([
    ["running", "running"],
    ["CREATING", "running"],
    ["RUNNING", "running"],
    ["WAITING_FOR_BACKGROUND_WORK", "running"],
    ["finished", "finished"],
    ["FINISHED", "finished"],
    ["error", "error"],
    ["ERROR", "error"],
    ["cancelled", "cancelled"],
    ["CANCELLED", "cancelled"],
    ["EXPIRED", "expired"],
    ["IDLE", "idle"],
    ["something-new", "unknown"],
    [undefined, "unknown"],
  ] as const)("maps %s to %s", (status, expected) => {
    expect(normalizeCursorCloudStatus(status)).toBe(expected);
  });
});

describe("cursorCloudSourceError", () => {
  const rpc = (name: string, code?: string) =>
    new CursorSdkWorkerRpcError({
      name,
      message: "server said secret-key",
      ...(code ? { code } : {}),
    });

  it.each([
    [rpc("CursorSdkError", "auth_invalid"), "auth", "cursor.cloud.authFailed"],
    [rpc("AuthenticationError"), "auth", "cursor.cloud.authFailed"],
    [rpc("ConfigurationError", "plan_required"), "plan", "cursor.cloud.planRequired"],
    [rpc("CursorSdkError", "feature_unavailable"), "plan", "cursor.cloud.planRequired"],
    [rpc("CursorSdkError", "403"), "plan", "cursor.cloud.planRequired"],
    [rpc("RateLimitError"), "rate_limited", "cursor.cloud.rateLimited"],
    [rpc("CursorSdkError", "429"), "rate_limited", "cursor.cloud.rateLimited"],
    [rpc("NetworkError"), "unavailable", "cursor.cloud.unavailable"],
    [new Error("socket hang up"), "unavailable", "cursor.cloud.unavailable"],
  ])("maps %s", (error, code, message) => {
    const mapped = cursorCloudSourceError(error);
    expect(mapped).toBeInstanceOf(CloudAgentSourceError);
    expect(mapped).toMatchObject({ code, message });
    // The provider's raw message (which may echo request data) never surfaces.
    expect(mapped.message).not.toContain("secret-key");
  });
});

describe("createCursorCloudAgentSource", () => {
  it("lists with the profile key and normalizes to the shared shape", async () => {
    const worker = fakeWorker();
    const source = createCursorCloudAgentSource("profile-key", { spawnWorker: async () => worker });

    await expect(source.listAgents("page-1")).resolves.toEqual({
      items: [
        {
          id: "bc-1",
          providerSessionId: "sdk:bc-1",
          name: "Fix login",
          status: "unknown",
          archived: true,
          createdAt: "2026-11-19T00:00:00.000Z",
          updatedAt: "2026-11-20T00:00:00.000Z",
          webUrl: "https://cursor.com/agents/bc-1",
          repos: [{ url: "github.com/acme/widgets" }],
        },
      ],
      nextCursor: "page-2",
    });
    expect(worker.cloudList).toHaveBeenCalledWith({
      apiKey: "profile-key",
      limit: 50,
      cursor: "page-1",
    });
    expect(worker.dispose).toHaveBeenCalledOnce();
  });

  it("reports the latest run as the agent status with its branches", async () => {
    const source = createCursorCloudAgentSource("k", { spawnWorker: async () => fakeWorker() });
    await expect(source.getAgent("bc-1")).resolves.toMatchObject({
      id: "bc-1",
      status: "finished",
      latestRun: { status: "finished", result: "Done", durationMs: 1200 },
      branches: [
        { repoUrl: "github.com/acme/widgets", branch: "cursor/fix", prUrl: "https://pr/1" },
      ],
    });
  });

  it("reads a bounded transcript under the resume identity", async () => {
    const worker = fakeWorker();
    const source = createCursorCloudAgentSource("k", { spawnWorker: async () => worker });
    await expect(source.readTranscript("bc-1")).resolves.toEqual({
      providerSessionId: "sdk:bc-1",
      messages: [{ role: "user", text: "hi" }],
      truncated: true,
    });
    expect(source.providerSessionId("bc-1")).toBe("sdk:bc-1");
  });

  it("throws typed errors and still disposes the worker", async () => {
    const worker = fakeWorker({
      cloudGet: vi.fn<CursorCloudWorker["cloudGet"]>(async () => {
        throw new CursorSdkWorkerRpcError({ name: "RateLimitError", message: "slow down" });
      }),
    });
    const source = createCursorCloudAgentSource("k", { spawnWorker: async () => worker });
    await expect(source.getAgent("bc-1")).rejects.toMatchObject({ code: "rate_limited" });
    expect(worker.dispose).toHaveBeenCalledOnce();

    const failingSpawn = createCursorCloudAgentSource("k", {
      spawnWorker: async () => {
        throw new Error("no sdk");
      },
    });
    await expect(failingSpawn.listAgents()).rejects.toMatchObject({ code: "unavailable" });
  });
});
