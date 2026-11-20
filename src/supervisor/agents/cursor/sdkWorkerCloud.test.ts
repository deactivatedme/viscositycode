import { describe, expect, it, vi } from "vitest";
import {
  getCursorCloudAgent,
  isCursorCloudAgentId,
  isCursorCloudAgentIdConflict,
  listCursorCloudAgentMessages,
  listCursorCloudAgents,
  readCursorCloudTranscript,
} from "./sdkWorkerCloud";
import { CURSOR_SDK_WORKER_PROTOCOL_VERSION } from "./sdkWorkerProtocol";
import type { RuntimeCloudRun, RuntimeSdkModule } from "./sdkWorkerRuntime";

type Loose = (...args: unknown[]) => unknown;

function turn(user: string, assistant: string) {
  return {
    type: "agentConversationTurn",
    turn: {
      userMessage: { text: user },
      steps: [
        { type: "thinkingMessage", message: { text: "hidden" } },
        { type: "assistantMessage", message: { text: assistant } },
      ],
    },
  };
}

function run(id: string, createdAt: number, status: string, turns: unknown[]): RuntimeCloudRun {
  return {
    id,
    createdAt,
    status,
    conversation: vi.fn<Loose>(async () => turns),
  } as unknown as RuntimeCloudRun;
}

function sdk(agent: Partial<Record<"list" | "get" | "listRuns" | "getRun", unknown>>) {
  return { Agent: { getRun: vi.fn<Loose>(), ...agent } } as unknown as RuntimeSdkModule;
}

describe("Cursor SDK worker cloud reads", () => {
  it("speaks worker protocol 7, so a staged v6 helper fails the handshake", () => {
    expect(CURSOR_SDK_WORKER_PROTOCOL_VERSION).toBe(7);
  });

  it("recognizes cloud ids and the create conflict on a deterministic id", () => {
    expect(isCursorCloudAgentId("bc-1")).toBe(true);
    expect(isCursorCloudAgentId("agent-1")).toBe(false);
    expect(isCursorCloudAgentId(undefined)).toBe(false);
    expect(
      isCursorCloudAgentIdConflict(
        Object.assign(new Error("x"), { status: 409, code: "agent_id_conflict" }),
      ),
    ).toBe(true);
    expect(
      isCursorCloudAgentIdConflict(
        Object.assign(new Error("x"), { status: 409, code: "agent_busy" }),
      ),
    ).toBe(false);
  });

  it("lists one page with the key and keeps only well-formed agents", async () => {
    const list = vi.fn<Loose>(async () => ({
      items: [
        {
          agentId: "bc-1",
          name: "Fix",
          summary: "Fix",
          lastModified: 2,
          repos: ["github.com/a/b"],
        },
        { name: "no id" },
      ],
      nextCursor: "next",
    }));
    const result = await listCursorCloudAgents(
      sdk({ list, get: vi.fn<Loose>(), listRuns: vi.fn<Loose>() }),
      {
        apiKey: "key",
        limit: 50,
        cursor: "c1",
      },
    );
    expect(list).toHaveBeenCalledWith({ runtime: "cloud", limit: 50, cursor: "c1", apiKey: "key" });
    expect(result).toEqual({
      items: [
        {
          agentId: "bc-1",
          name: "Fix",
          summary: "Fix",
          lastModified: 2,
          repos: ["github.com/a/b"],
        },
      ],
      nextCursor: "next",
    });
  });

  it("gets an agent with its latest run, result cut to the protocol bound", async () => {
    const latest = {
      id: "run-1",
      status: "finished",
      result: "x".repeat(5000),
      durationMs: 9,
      git: { branches: [{ repoUrl: "github.com/a/b", branch: "cursor/fix", prUrl: "https://pr" }] },
    };
    const listRuns = vi.fn<Loose>(async () => ({ items: [latest] }));
    const result = await getCursorCloudAgent(
      sdk({
        list: vi.fn<Loose>(),
        get: vi.fn<Loose>(async () => ({ agentId: "bc-1", name: "Fix" })),
        listRuns,
      }),
      { agentId: "bc-1", apiKey: "key" },
    );
    expect(listRuns).toHaveBeenCalledWith("bc-1", { runtime: "cloud", limit: 1, apiKey: "key" });
    expect(result.latestRun?.result).toHaveLength(4096);
    expect(result.latestRun?.git).toEqual(latest.git);
  });

  it("fails clearly on an SDK without cloud reads", async () => {
    await expect(
      listCursorCloudAgents({ Agent: {} } as unknown as RuntimeSdkModule, { limit: 1 }),
    ).rejects.toMatchObject({ code: "cloud_unsupported" });
  });

  it("reads finished runs newest first within bounds and skips a running run", async () => {
    const running = run("run-3", 3, "running", [turn("live", "pending")]);
    const listRuns = vi.fn<Loose>(async () => ({
      items: [
        run("run-1", 1, "finished", [turn("first", "one")]),
        running,
        run("run-2", 2, "finished", [turn("second", "two")]),
      ],
    }));
    const module = sdk({ list: vi.fn<Loose>(), get: vi.fn<Loose>(), listRuns });

    const all = await readCursorCloudTranscript(module, {
      agentId: "bc-1",
      maxRuns: 5,
      maxBytes: 1000,
    });
    expect(all).toEqual({
      messages: [
        { role: "user", text: "first" },
        { role: "assistant", text: "one" },
        { role: "user", text: "second" },
        { role: "assistant", text: "two" },
      ],
      truncated: false,
    });
    expect(running.conversation).not.toHaveBeenCalled();

    // Only the newest finished run fits: older runs are dropped, not newer ones.
    const bounded = await readCursorCloudTranscript(module, {
      agentId: "bc-1",
      maxRuns: 5,
      maxBytes: 9,
    });
    expect(bounded).toEqual({
      messages: [
        { role: "user", text: "second" },
        { role: "assistant", text: "two" },
      ],
      truncated: true,
    });
  });

  it("serves messages.list for a cloud agent in the local message shape", async () => {
    const listRuns = vi.fn<Loose>(async () => ({
      items: [run("run-1", 1, "finished", [turn("hi", "yo")])],
    }));
    const messages = await listCursorCloudAgentMessages(
      sdk({ list: vi.fn<Loose>(), get: vi.fn<Loose>(), listRuns }),
      { agentId: "bc-1", offset: 1, limit: 1 },
    );
    expect(messages).toEqual([
      {
        type: "assistant",
        uuid: "bc-1:1",
        agent_id: "bc-1",
        message: { role: "assistant", content: [{ type: "text", text: "yo" }] },
      },
    ]);
  });
});
