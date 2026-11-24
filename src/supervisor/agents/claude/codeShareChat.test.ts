import { expect, it, vi } from "vitest";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

const mocks = vi.hoisted(() => ({
  query: vi.fn<(input: unknown) => unknown>(),
  executable: vi.fn<() => Promise<string | undefined>>(),
  primary: vi.fn<() => Promise<string | undefined>>(async () => "/fixture/claude"),
}));
vi.mock("../base", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../base")>()),
  resolveExecutablePathAsync: mocks.primary,
}));
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({ query: mocks.query }));
vi.mock("./compatibleBinary", () => ({ findCompatibleClaudeOverride: mocks.executable }));
import { claudeCodeShareOptions, runClaudeCodeShareChat } from "./codeShareChat";

it("uses the Agent SDK with tools and API-key fallback disabled", async () => {
  const close = vi.fn<() => void>();
  mocks.query.mockReturnValue({
    async *[Symbol.asyncIterator]() {
      yield {
        type: "result",
        subtype: "success",
        is_error: false,
        result: "SDK reply",
        usage: {
          input_tokens: 5,
          output_tokens: 3,
          cache_creation_input_tokens: 8,
          cache_read_input_tokens: 13,
        },
      } as SDKMessage;
    },
    close,
  });
  const input = {
    model: "claude-test-1",
    prompt: "hello",
    location: { kind: "posix" as const, path: "/fixture" },
    onUsage: vi.fn<(usage: { inputTokens: number; outputTokens: number }) => void>(),
  };
  await expect(runClaudeCodeShareChat(input)).resolves.toBe("SDK reply");
  expect(input.onUsage).toHaveBeenCalledWith({ inputTokens: 26, outputTokens: 3 });
  expect(mocks.query).toHaveBeenCalledWith(
    expect.objectContaining({
      prompt: "hello",
      options: expect.objectContaining({
        model: input.model,
        tools: [],
        settingSources: [],
        strictMcpConfig: true,
        persistSession: false,
        pathToClaudeCodeExecutable: "/fixture/claude",
      }),
    }),
  );
  expect(close).toHaveBeenCalledOnce();
  const options = claudeCodeShareOptions(input, new AbortController());
  expect(options.env).toMatchObject({ ANTHROPIC_API_KEY: "", ANTHROPIC_AUTH_TOKEN: "" });
});

it("exposes only the per-turn remote workspace MCP server", async () => {
  const bridge = {
    url: "http://127.0.0.1:8788/api/v1/runtime-tools/fixture",
    token: "x".repeat(43),
  };
  const options = claudeCodeShareOptions(
    {
      model: "fixture",
      prompt: "edit",
      location: { kind: "posix", path: "/private" },
      remoteTools: bridge,
    },
    new AbortController(),
  );
  expect(options.tools).toEqual([]);
  expect(options.mcpServers).toEqual({
    codeshare_workspace: {
      type: "http",
      url: bridge.url,
      headers: { Authorization: `Bearer ${bridge.token}` },
    },
  });
  expect(options.allowedTools).toEqual(["mcp__codeshare_workspace__*"]);
});
