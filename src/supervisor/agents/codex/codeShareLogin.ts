import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { terminateChildProcessTree } from "@/shared/processTree";
import { assertAgentLaunchAllowed } from "@/supervisor/agentLaunchGuard";
import type { CodeShareLogin } from "../base";
import { buildCodexAppServerCommand } from "./argv";
import { CodexAppServerRpc } from "./appServerRpc";
import { CodexStdioTransport } from "./stdioTransport";

export async function startCodexCodeShareLogin(): Promise<CodeShareLogin> {
  const location = {
    kind: process.platform === "win32" ? ("windows" as const) : ("posix" as const),
    path: homedir(),
  };
  const command = await buildCodexAppServerCommand(location);
  assertAgentLaunchAllowed("session-auth");
  const ownedProcessGroup = process.platform !== "win32";
  const child = spawn(command.command, command.args, {
    cwd: location.path,
    env: { ...process.env, ...command.env },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    detached: ownedProcessGroup,
  });
  const exited = new Promise<void>((resolve) => child.once("close", () => resolve()));
  const rpc = new CodexAppServerRpc(new CodexStdioTransport(child), randomUUID());
  const result = Promise.withResolvers<void>();
  void result.promise.catch(() => undefined);
  let loginId: string | undefined;
  let completed = false;
  let url: string | undefined;
  const early = new Map<string, boolean>();
  const settle = (success: boolean) => {
    completed = success;
    if (success) result.resolve();
    else result.reject(new Error("Codex sign-in was not completed."));
  };
  rpc.setListener({
    onNotification(method, params) {
      if (
        method !== "account/login/completed" ||
        typeof params?.loginId !== "string" ||
        typeof params.success !== "boolean"
      )
        return;
      if (!loginId) {
        if (early.size < 8) early.set(params.loginId, params.success);
        return;
      }
      if (params.loginId === loginId) settle(params.success);
    },
    onRuntimeEvents() {},
    onError: (error) => result.reject(error),
    onClose: () => result.reject(new Error("The Codex sign-in connection closed.")),
  });
  const stop = () => {
    rpc.dispose(new Error("CodeShare sign-in closed."));
    if (child.exitCode === null && child.signalCode === null)
      terminateChildProcessTree(child, { ownedProcessGroup });
  };
  const timer = setTimeout(
    () => result.reject(new Error("Codex sign-in timed out.")),
    5 * 60_000,
  ).unref();
  const done = (async () => {
    try {
      await rpc.request("initialize", {
        clientInfo: { name: "codeshare-login", version: "1" },
        capabilities: { experimentalApi: true, requestAttestation: false },
      });
      rpc.notify("initialized");
      const login = await rpc.request("account/login/start", { type: "chatgpt" });
      if (login.type !== "chatgpt") throw new Error("Codex did not offer ChatGPT sign-in.");
      const target = new URL(login.authUrl);
      if (
        target.protocol !== "https:" ||
        target.hostname !== "auth.openai.com" ||
        target.username ||
        target.password
      )
        throw new Error("Codex returned an unsupported sign-in address.");
      loginId = login.loginId;
      url = target.href;
      const preceding = early.get(loginId);
      early.clear();
      if (preceding !== undefined) settle(preceding);
      await result.promise;
    } finally {
      clearTimeout(timer);
      stop();
      await exited;
    }
  })();
  void done.catch(() => undefined);
  return {
    url: () => url,
    done,
    async cancel() {
      // Cancel only this pending attempt. Never log out an authenticated account.
      if (!completed && loginId)
        await rpc.request("account/login/cancel", { loginId }).catch(() => undefined);
      result.reject(new Error("Codex sign-in was cancelled."));
      stop();
      await done.catch(() => undefined);
    },
  };
}
