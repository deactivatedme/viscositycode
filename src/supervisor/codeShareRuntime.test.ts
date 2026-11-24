import { describe, expect, it, vi } from "vitest";
import type { AgentStatus } from "@/shared/contracts";
import type { AgentAdapter } from "./agents/base";
import { CodeShareRuntime } from "./codeShareRuntime";

function adapter() {
  const detectInstall = vi.fn<
    () => Promise<{
      installed: boolean;
      authState: string;
      providerMetadata: AgentStatus["providerMetadata"];
      capabilities: { models: { id: string; label: string }[] };
    }>
  >(async () => ({
    installed: true,
    authState: "authenticated",
    providerMetadata: { plan: "pro" } as AgentStatus["providerMetadata"],
    capabilities: { models: [{ id: "test-model", label: "Test" }] },
  }));
  const runCodeShareStructuredChat = vi.fn<NonNullable<AgentAdapter["runCodeShareStructuredChat"]>>(
    async () => "owner reply",
  );
  const value = {
    kind: "codex",
    detectInstall,
    runCodeShareStructuredChat,
  } as unknown as AgentAdapter;
  return { value, detectInstall, runCodeShareStructuredChat };
}

describe("owner subscription runtime", () => {
  it("uses the native owner's account and an isolated directory with no client-supplied config", async () => {
    const test = adapter();
    test.runCodeShareStructuredChat.mockImplementationOnce(async ({ onUsage }) => {
      onUsage?.({ inputTokens: 100, outputTokens: 15 });
      onUsage?.({ inputTokens: 140, outputTokens: 25 });
      return "owner reply";
    });
    const runtime = new CodeShareRuntime(new Map([["codex", test.value]]));
    const input = {
      action: "run",
      id: crypto.randomUUID(),
      model: "codex:test-model",
      messages: [{ role: "user", content: "question" }],
    };
    expect(await runtime.request(input)).toEqual({
      reply: "owner reply",
      usage: { inputTokens: 140, outputTokens: 25 },
    });
    const call = test.runCodeShareStructuredChat.mock.calls[0] as unknown as [
      Parameters<NonNullable<AgentAdapter["runCodeShareStructuredChat"]>>[0],
    ];
    expect(call[0].model).toBe("test-model");
    expect(call[0].location).toMatchObject({
      kind: process.platform === "win32" ? "windows" : "posix",
    });
    expect(call[0].prompt).toContain("question");
    await runtime.close();
  });

  it("rejects API billing and unknown models before launching a provider", async () => {
    const test = adapter();
    const runtime = new CodeShareRuntime(new Map([["codex", test.value]]));
    test.detectInstall.mockResolvedValueOnce({
      installed: true,
      authState: "authenticated",
      providerMetadata: { plan: "pro", authMethod: "apiKey" },
      capabilities: { models: [{ id: "test-model", label: "Test" }] },
    });
    expect(await runtime.catalog()).toEqual([]);
    await expect(
      runtime.request({
        action: "run",
        id: crypto.randomUUID(),
        model: "codex:missing",
        messages: [{ role: "user", content: "question" }],
      }),
    ).rejects.toThrow("unavailable");
    expect(test.runCodeShareStructuredChat).not.toHaveBeenCalled();
    await runtime.close();
  });

  it("cancels during account discovery without starting a generation", async () => {
    const test = adapter();
    let release!: () => void;
    test.detectInstall.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return {
        installed: true,
        authState: "authenticated",
        providerMetadata: { plan: "pro" },
        capabilities: { models: [{ id: "test-model", label: "Test" }] },
      };
    });
    const runtime = new CodeShareRuntime(new Map([["codex", test.value]]));
    const id = crypto.randomUUID();
    const run = runtime.request({
      action: "run",
      id,
      model: "codex:test-model",
      messages: [{ role: "user", content: "question" }],
    });
    const observed = run.catch((error: unknown) => error);
    await vi.waitFor(() => expect(release).toBeDefined());
    const cancelled = runtime.request({ action: "cancel", id });
    release();
    expect(await observed).toMatchObject({ name: "AbortError" });
    await cancelled;
    expect(test.runCodeShareStructuredChat).not.toHaveBeenCalled();
    await runtime.close();
  });
});

it("never falls back to a provider's terminal or print-generation lane", async () => {
  const fixture = adapter();
  const print = vi.fn<() => never>(() => {
    throw new Error("Terminal generation must remain unreachable");
  });
  const terminal = {
    ...fixture.value,
    runCodeShareStructuredChat: undefined,
    buildOneShotCommand: print,
  } as unknown as AgentAdapter;
  const runtime = new CodeShareRuntime(new Map([["codex", terminal]]));
  expect(await runtime.catalog()).toEqual([]);
  await expect(
    runtime.request({
      action: "run",
      id: crypto.randomUUID(),
      model: "codex:test-model",
      messages: [{ role: "user", content: "hello" }],
    }),
  ).rejects.toThrow("unavailable");
  expect(print).not.toHaveBeenCalled();
  await runtime.close();
});

it("keeps native owner-key runs behind the private bridge and joins cancellation", async () => {
  const release = Promise.withResolvers<string>();
  const started = Promise.withResolvers<AbortSignal>();
  const keyChat: NonNullable<AgentAdapter["codeShareKeyChat"]> = {
    remoteEditing: true,
    async importDefaultKey() {
      return "private-fixture-key";
    },
    async catalog(key) {
      expect(key).toBe("private-fixture-key");
      return [{ id: "key-model", label: "Key model" }];
    },
    async run(input) {
      expect(input.key).toBe("private-fixture-key");
      started.resolve(input.signal!);
      return release.promise;
    },
  };
  const runtime = new CodeShareRuntime(
    new Map([["fixture", { codeShareKeyChat: keyChat } as AgentAdapter]]),
  );
  try {
    expect(
      await runtime.request({ action: "key-import", id: crypto.randomUUID(), provider: "fixture" }),
    ).toBe("private-fixture-key");
    expect(
      await runtime.request({
        action: "key-catalog",
        id: crypto.randomUUID(),
        provider: "fixture",
        key: "private-fixture-key",
      }),
    ).toEqual([{ id: "key-model", label: "Key model", remoteEditing: true }]);
    const id = crypto.randomUUID();
    const running = runtime.request({
      action: "key-run",
      id,
      model: "fixture:key-model",
      key: "private-fixture-key",
      messages: [{ role: "user", content: "Edit" }],
    });
    const observed = running.catch((error: unknown) => error);
    const signal = await started.promise;
    let cancelled = false;
    const closing = runtime.request({ action: "cancel", id }).then(() => {
      cancelled = true;
    });
    expect(signal.aborted).toBe(true);
    await Promise.resolve();
    expect(cancelled).toBe(false);
    release.resolve("reply");
    await closing;
    expect(await observed).toMatchObject({ name: "AbortError" });
  } finally {
    release.resolve("reply");
    await runtime.close();
  }
});

it("excludes local aliases from the owner catalog and refuses them before generation", async () => {
  const run = vi.fn<NonNullable<AgentAdapter["runCodeShareStructuredChat"]>>(async () => "reply");
  const runtime = new CodeShareRuntime(
    new Map([
      [
        "claude",
        {
          kind: "claude",
          runCodeShareStructuredChat: run,
          async detectInstall() {
            return {
              installed: true,
              authState: "authenticated",
              providerMetadata: { authMethod: "Claude.ai", plan: "pro" },
              capabilities: {
                models: [
                  { id: "sonnet55", label: "Local shorthand" },
                  { id: "claude-sonnet-5-5", label: "Sonnet 5.5" },
                ],
              },
            };
          },
        } as unknown as AgentAdapter,
      ],
    ]),
  );
  try {
    expect((await runtime.catalog()).map(({ id }) => id)).toEqual(["claude:claude-sonnet-5-5"]);
    await expect(
      runtime.request({
        action: "run",
        id: crypto.randomUUID(),
        model: "claude:sonnet55",
        messages: [{ role: "user", content: "hello" }],
      }),
    ).rejects.toThrow("unavailable");
    expect(run).not.toHaveBeenCalled();
  } finally {
    await runtime.close();
  }
});
