import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, expect, it, vi } from "vitest";
import type { CodexAppServerRpcListener } from "./appServerRpc";

const mocks = vi.hoisted(() => ({
  request: vi.fn<(method: string, params: unknown) => Promise<unknown>>(),
  listener: undefined as CodexAppServerRpcListener | undefined,
  stop: vi.fn<() => void>(),
  spawn: vi.fn<(...args: unknown[]) => unknown>(),
}));
vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));
vi.mock("./argv", () => ({
  buildCodexAppServerCommand: async () => ({ command: "codex", args: ["app-server"] }),
}));
vi.mock("@/shared/processTree", () => ({ terminateChildProcessTree: mocks.stop }));
vi.mock("./appServerRpc", () => ({
  CodexAppServerRpc: class {
    setListener(value: CodexAppServerRpcListener) {
      mocks.listener = value;
    }
    request(method: string, params: unknown) {
      return mocks.request(method, params);
    }
    notify() {}
    dispose() {}
  },
}));
import { startCodexCodeShareLogin } from "./codeShareLogin";

afterEach(() => {
  vi.clearAllMocks();
  mocks.listener = undefined;
});
function fixture() {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    stdin: new PassThrough(),
    exitCode: null as number | null,
    signalCode: null,
  });
  mocks.spawn.mockReturnValue(child);
  mocks.stop.mockImplementation(() => {
    child.exitCode = 0;
    child.emit("close", 0);
  });
  mocks.request.mockImplementation(async (method) =>
    method === "account/login/start"
      ? {
          type: "chatgpt",
          loginId: "owned-login",
          authUrl: "https://auth.openai.com/authorize?state=fixture",
        }
      : {},
  );
}

it("uses the structured login API and waits for the exact attempt's completion", async () => {
  fixture();
  const login = await startCodexCodeShareLogin();
  await vi.waitFor(() =>
    expect(login.url()).toBe("https://auth.openai.com/authorize?state=fixture"),
  );
  mocks.listener!.onNotification("account/login/completed", {
    loginId: "owned-login",
    success: true,
  });
  await login.done;
  expect(mocks.request).toHaveBeenCalledWith("account/login/start", { type: "chatgpt" });
  expect(mocks.request.mock.calls.some(([method]) => method === "account/logout")).toBe(false);
});

it("cancels only its own pending attempt without a logout or forced login setting", async () => {
  fixture();
  const login = await startCodexCodeShareLogin();
  await vi.waitFor(() => expect(login.url()).toContain("auth.openai.com"));
  await login.cancel();
  await expect(login.done).rejects.toThrow("cancelled");
  expect(mocks.request).toHaveBeenCalledWith("account/login/cancel", { loginId: "owned-login" });
  expect(mocks.request.mock.calls.some(([method]) => method === "account/logout")).toBe(false);
});

it("retains completion delivered in the same transport batch as the start reply", async () => {
  fixture();
  mocks.request.mockImplementation(async (method) => {
    if (method === "account/login/start") {
      mocks.listener!.onNotification("account/login/completed", {
        loginId: "owned-login",
        success: true,
      });
      return {
        type: "chatgpt",
        loginId: "owned-login",
        authUrl: "https://auth.openai.com/authorize?state=fixture",
      };
    }
    return {};
  });
  const login = await startCodexCodeShareLogin();
  await login.done;
  expect(mocks.stop).toHaveBeenCalled();
});
