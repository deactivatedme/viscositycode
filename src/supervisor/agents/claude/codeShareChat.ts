import { resolveExecutablePathAsync } from "../base";
import {
  CODE_SHARE_WORKSPACE_MCP,
  CODE_SHARE_REMOTE_TURN_TIMEOUT_MS,
} from "@/shared/codeShareFileTools";
import { spawnClaudeProbeProcess } from "./sdkProbeProcess";
import { query, type Options } from "@anthropic-ai/claude-agent-sdk";
import { assertAgentLaunchAllowed } from "@/supervisor/agentLaunchGuard";
import type { CodeShareStructuredChatInput } from "../base";
import { findCompatibleClaudeOverride } from "./compatibleBinary";
import { claudeModelRouteError } from "./modelIdentity";
import { codeShareTokenUsageSchema } from "@/shared/codeShareRuntime";

/** Restricted owner-funded Agent SDK session; never uses the print/terminal lane. */
export function claudeCodeShareOptions(
  input: CodeShareStructuredChatInput,
  abort: AbortController,
): Options {
  return {
    cwd: input.location.kind === "wsl" ? input.location.linuxPath : input.location.path,
    model: input.model,
    tools: [],
    allowedTools: input.remoteTools ? [`mcp__${CODE_SHARE_WORKSPACE_MCP}__*`] : [],
    mcpServers: input.remoteTools
      ? {
          [CODE_SHARE_WORKSPACE_MCP]: {
            type: "http",
            url: input.remoteTools.url,
            headers: { Authorization: `Bearer ${input.remoteTools.token}` },
          },
        }
      : {},
    strictMcpConfig: true,
    settingSources: [],
    plugins: [],
    persistSession: false,
    permissionMode: "dontAsk",
    canUseTool: async (name, args) =>
      input.remoteTools && name.startsWith(`mcp__${CODE_SHARE_WORKSPACE_MCP}__`)
        ? { behavior: "allow", updatedInput: args }
        : { behavior: "deny", message: "Only the approved remote workspace tools are available." },
    settings: { disableAllHooks: true, enabledPlugins: {} },
    extraArgs: {
      ...(input.remoteTools ? {} : { "safe-mode": null }),
      "disable-slash-commands": null,
      "no-chrome": null,
    },
    abortController: abort,
    env: {
      ...process.env,
      ANTHROPIC_API_KEY: "",
      ANTHROPIC_AUTH_TOKEN: "",
      CLAUDE_CODE_USE_BEDROCK: "0",
      CLAUDE_CODE_USE_VERTEX: "0",
      CLAUDE_CODE_USE_FOUNDRY: "0",
    },
  };
}

export async function runClaudeCodeShareChat(input: CodeShareStructuredChatInput): Promise<string> {
  if (input.location.kind === "wsl") throw new Error("Use the native owner SDK session.");
  input.signal?.throwIfAborted();
  const abort = new AbortController();
  const cancel = () => abort.abort();
  input.signal?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(
    cancel,
    input.remoteTools ? CODE_SHARE_REMOTE_TURN_TIMEOUT_MS + 30_000 : 150_000,
  ).unref();
  let runtime: ReturnType<typeof query> | undefined;
  const children: Promise<void>[] = [];
  let closing = false;
  try {
    const primary = await resolveExecutablePathAsync("claude");
    const path =
      (await findCompatibleClaudeOverride(input.location, input.signal, primary)) ?? primary;
    if (!path) throw new Error("Install the native Claude runtime on the owner computer.");
    input.signal?.throwIfAborted();
    assertAgentLaunchAllowed("thread-structured");
    const options = claudeCodeShareOptions(input, abort);
    runtime = query({
      prompt: input.prompt,
      options: {
        ...options,
        ...(path ? { pathToClaudeCodeExecutable: path } : {}),
        spawnClaudeCodeProcess(spawnOptions) {
          if (closing) throw new Error("CodeShare SDK session is closing.");
          const child = spawnClaudeProbeProcess(spawnOptions);
          children.push(
            new Promise<void>((resolve) => {
              child.once("exit", () => resolve());
              child.once("error", () => resolve());
              if (child.exitCode !== null || child.signalCode) resolve();
            }),
          );
          return child;
        },
      },
    });
    for await (const message of runtime) {
      if (message.type === "assistant" && !message.error) {
        const mismatch = claudeModelRouteError(input.model, message.message.model);
        if (mismatch) throw new Error(mismatch);
      }
      if (message.type !== "result") continue;
      if (message.subtype !== "success" || message.is_error)
        throw new Error("The owner's Claude SDK session did not complete the turn.");
      // Each CodeShare turn is a fresh SDK session. Its result is cumulative
      // for that session, including tool rounds and cached prompt input.
      if (message.usage) {
        const usage = codeShareTokenUsageSchema.safeParse({
          inputTokens:
            message.usage.input_tokens +
            (message.usage.cache_creation_input_tokens ?? 0) +
            (message.usage.cache_read_input_tokens ?? 0),
          outputTokens: message.usage.output_tokens,
        });
        if (usage.success) input.onUsage?.(usage.data);
      }
      return message.result;
    }
    throw new Error("The owner's Claude SDK session ended without a result.");
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener("abort", cancel);
    closing = true;
    runtime?.close();
    abort.abort();
    await Promise.all(children);
  }
}
