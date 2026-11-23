import { expect, it, vi } from "vitest";
import type { AgentAdapter, CodeShareLogin } from "./agents/base";
import { CodeShareConnections } from "./codeShareConnections";

it("reuses an existing subscription sign-in and never logs the account out", async () => {
  const start = vi.fn<NonNullable<AgentAdapter["startCodeShareLogin"]>>();
  let manager: CodeShareConnections;
  manager = new CodeShareConnections(
    new Map([["codex", { startCodeShareLogin: start } as unknown as AgentAdapter]]),
    async () => {
      manager.observe("codex", true);
    },
  );
  await manager.connect("codex");
  expect(start).not.toHaveBeenCalled();
  expect(manager.snapshot().find(({ id }) => id === "codex")).toMatchObject({
    connected: true,
    state: "connected",
  });
  await manager.close();
});

it("shows only its pending login URL, refreshes the account, and closes a late acquisition on cancel", async () => {
  const acquisition = Promise.withResolvers<CodeShareLogin>();
  const completion = Promise.withResolvers<void>();
  const cancel = vi.fn<() => Promise<void>>(async () => {
    completion.reject(new Error("cancelled"));
  });
  const start = vi.fn<NonNullable<AgentAdapter["startCodeShareLogin"]>>(() => acquisition.promise);
  const manager = new CodeShareConnections(
    new Map([["codex", { startCodeShareLogin: start } as unknown as AgentAdapter]]),
    async () => {},
  );
  await manager.connect("codex");
  const stopping = manager.close();
  acquisition.resolve({
    url: () => "https://auth.openai.com/authorize?state=fixture",
    done: completion.promise,
    cancel,
  });
  await stopping;
  expect(cancel).toHaveBeenCalled();
  expect(manager.snapshot().find(({ id }) => id === "codex")?.url).toBeUndefined();
});
