import { stripAnsiPreservingLayout } from "@/shared/ansi";
import { homedir } from "node:os";
import { startManagedChildCommand } from "@/shared/managedChildCommand";
import { assertAgentLaunchAllowed } from "@/supervisor/agentLaunchGuard";
import type { CodeShareLogin } from "../base";
import { findCompatibleClaudeOverride } from "./compatibleBinary";
import { buildAgentCommand, prepareAgentLocationEnvironment } from "../base";

export function claudeCodeShareLoginUrl(output: string): string | undefined {
  for (const candidate of stripAnsiPreservingLayout(output).match(/https:\/\/[^\s<>"']+/gu) ?? []) {
    try {
      const url = new URL(candidate);
      if (
        ["claude.ai", "console.anthropic.com", "platform.claude.com"].includes(url.hostname) &&
        url.pathname === "/oauth/authorize" &&
        !url.username &&
        !url.password
      )
        return url.href;
    } catch {
      /* Wait for a complete URL. */
    }
  }
  return undefined;
}

export async function startClaudeCodeShareLogin(): Promise<CodeShareLogin> {
  const location = {
    kind: process.platform === "win32" ? ("windows" as const) : ("posix" as const),
    path: homedir(),
  };
  await prepareAgentLocationEnvironment(location);
  const executable = await findCompatibleClaudeOverride(location);
  const spec = buildAgentCommand(location, executable ?? "claude", ["auth", "login", "--claudeai"]);
  assertAgentLaunchAllowed("session-auth");
  let url: string | undefined;
  const childCommand = startManagedChildCommand(spec.command, spec.args, {
    ...(spec.cwd ? { cwd: spec.cwd } : {}),
    env: {
      ...globalThis.process.env,
      ...spec.env,
      ANTHROPIC_API_KEY: "",
      ANTHROPIC_AUTH_TOKEN: "",
    },
    timeoutMs: 5 * 60_000,
    onOutput: (output) => {
      url = claudeCodeShareLoginUrl(output) ?? url;
    },
  });
  return {
    url: () => url,
    done: childCommand.done.then(() => undefined),
    cancel: childCommand.cancel,
  };
}
