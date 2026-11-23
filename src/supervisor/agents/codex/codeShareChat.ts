import {
  CODE_SHARE_WORKSPACE_MCP,
  CODE_SHARE_REMOTE_TURN_TIMEOUT_MS,
  type ShareFileBridge,
} from "@/shared/codeShareFileTools";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { terminateChildProcessTree } from "@/shared/processTree";
import { assertAgentLaunchAllowed } from "@/supervisor/agentLaunchGuard";
import {
  buildAgentCommand,
  prepareAgentLocationEnvironment,
  readAgentCommandOutput,
  type CodeShareStructuredChatInput,
} from "../base";
import { CodexAppServerRpc } from "./appServerRpc";
import { readCodexNativeMcpNames } from "./nativeMcp";
import { buildCodexMcp } from "./mcpConfig";
import { CodexStdioTransport } from "./stdioTransport";

const catalogSchema = z.object({ models: z.array(z.object({ slug: z.string() }).passthrough()) });
/**
 * Codex 0.171.0: model-provided tool fields override feature flags. Neutralize
 * both, never just shell_tool. Origin: the installed `codex debug models` and
 * upstream codex-rs/core/src/tools/spec_plan.rs / protocol openai_models.rs.
 * Keep all other model metadata, including context/reasoning/entitlements.
 */
export function textOnlyCodexCatalog(value: unknown, model: string): object {
  const parsed = catalogSchema.parse(value);
  const selected = parsed.models.find(({ slug }) => slug === model);
  if (!selected) throw new Error("Selected model is absent from the Codex catalog.");
  return {
    models: [
      {
        ...selected,
        tool_mode: null,
        shell_type: "disabled",
        apply_patch_tool_type: null,
        experimental_supported_tools: [],
        multi_agent_version: null,
        node_repl_disabled: true,
        supports_search_tool: false,
        include_skills_usage_instructions: false,
        include_plugin_usage_instructions: false,
        include_apps_usage_instructions: false,
      },
    ],
  };
}

/** Startup-only restrictions, applied to a dedicated structured app-server. */
export function codexCodeShareArgs(
  catalogPath: string,
  instructionsPath: string,
  featureNames: string[],
  nativeMcpNames: readonly string[],
  bridge?: ShareFileBridge,
): string[] {
  return [
    "-c",
    `model_catalog_json=${JSON.stringify(catalogPath)}`,
    "-c",
    `model_instructions_file=${JSON.stringify(instructionsPath)}`,
    "-c",
    'developer_instructions=""',
    "-c",
    "project_doc_max_bytes=0",
    "-c",
    'model_provider="openai"',
    "-c",
    'web_search="disabled"',
    "-c",
    "tools.update_plan.enabled=false",
    "-c",
    "tools.experimental_request_user_input.enabled=false",
    ...featureNames.flatMap((name) => ["-c", `features.${name}=false`]),
    ...codeShareCodexMcp(nativeMcpNames, bridge).args,
    "app-server",
    "--stdio",
    "--strict-config",
  ];
}

function codeShareCodexMcp(nativeNames: readonly string[], bridge?: ShareFileBridge) {
  return buildCodexMcp(
    bridge
      ? [
          {
            id: CODE_SHARE_WORKSPACE_MCP,
            name: CODE_SHARE_WORKSPACE_MCP,
            timeoutMs: 65_000,
            approvalMode: "approve",
            transport: {
              type: "http",
              url: bridge.url,
              headers: { Authorization: `Bearer ${bridge.token}` },
            },
          },
        ]
      : [],
    nativeNames,
  );
}

/** The account check and generation share one app-server; there is no exec/print path. */
export async function runCodexCodeShareChat(input: CodeShareStructuredChatInput): Promise<string> {
  if (input.location.kind === "wsl") throw new Error("CodeShare runs on the native owner host.");
  const location = input.location;
  const options = { timeoutMs: 15_000, ...(input.signal ? { signal: input.signal } : {}) };
  const [version, features, catalog, nativeMcpNames] = await Promise.all([
    readAgentCommandOutput(location, "codex", ["--version"], options),
    readAgentCommandOutput(location, "codex", ["features", "list"], options),
    readAgentCommandOutput(location, "codex", ["debug", "models"], options),
    readCodexNativeMcpNames(location, []),
  ]);
  if (!version.ok || version.stdout.trim() !== "codex-cli 0.171.0" || !features.ok || !catalog.ok)
    throw new Error("CodeShare requires the qualified Codex 0.171.0 app-server runtime.");
  const catalogPath = join(location.path, "models.json");
  const instructionsPath = join(location.path, "instructions.txt");
  await Promise.all([
    writeFile(
      catalogPath,
      JSON.stringify(textOnlyCodexCatalog(JSON.parse(catalog.stdout), input.model)),
      { mode: 0o600 },
    ),
    writeFile(
      instructionsPath,
      input.remoteTools
        ? "You are coding in the selected participant project using only the codeshare_workspace MCP tools. These file paths are relative to their project. Read files before writing and preserve concurrent edits. Local host tools are unavailable."
        : "You are an assistant in a shared conversation. Answer the user's message. No tools are available.",
      { mode: 0o600 },
    ),
  ]);
  const names = features.stdout.split("\n").flatMap((line) => {
    const name = /^([a-z][a-z0-9_.]*)\s+.+\s+(?:true|false)\s*$/u.exec(line)?.[1];
    return name ? [name] : [];
  });
  if (!names.includes("shell_tool") || !names.includes("hooks"))
    throw new Error("Unsupported Codex feature inventory.");
  await prepareAgentLocationEnvironment(location);
  const command = buildAgentCommand(
    location,
    "codex",
    codexCodeShareArgs(catalogPath, instructionsPath, names, nativeMcpNames, input.remoteTools),
    undefined,
    {
      OPENAI_API_KEY: "",
      CODEX_API_KEY: "",
      ...codeShareCodexMcp(nativeMcpNames, input.remoteTools).env,
    },
  );
  input.signal?.throwIfAborted();
  assertAgentLaunchAllowed("thread-structured");
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
  const result = Promise.withResolvers<string>();
  // The transport can fail before turn/start; observe immediately, await below.
  void result.promise.catch(() => undefined);
  const text = new Map<string, string>();
  const cancel = () => {
    result.reject(new DOMException("CodeShare session aborted", "AbortError"));
    terminateChildProcessTree(child, { ownedProcessGroup });
  };
  input.signal?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(
    cancel,
    input.remoteTools ? CODE_SHARE_REMOTE_TURN_TIMEOUT_MS + 30_000 : 150_000,
  ).unref();
  rpc.setListener({
    onNotification(method, params) {
      if (
        method === "item/agentMessage/delta" &&
        typeof params?.delta === "string" &&
        typeof params.itemId === "string"
      )
        text.set(params.itemId, (text.get(params.itemId) ?? "") + params.delta);
      if (method === "item/completed") {
        const item = z
          .object({ id: z.string(), type: z.string(), text: z.string().optional() })
          .safeParse(params?.item);
        if (item.success && item.data.type === "agentMessage" && item.data.text !== undefined)
          text.set(item.data.id, item.data.text);
      }
      if (method === "turn/completed") {
        const turn = z.object({ status: z.string() }).safeParse(params?.turn);
        if (!turn.success || turn.data.status !== "completed")
          result.reject(new Error("The owner's Codex session did not complete the turn."));
        else result.resolve([...text.values()].join("\n\n"));
      }
    },
    onRuntimeEvents(events) {
      if (events.length)
        result.reject(new Error("Unexpected tool request in a shared text session."));
    },
    onClose() {
      result.reject(new Error("The owner's Codex app-server disconnected."));
    },
    onError(error) {
      result.reject(error);
    },
  });
  try {
    if (input.signal?.aborted) cancel();
    await rpc.request("initialize", {
      clientInfo: { name: "codeshare", version: "1" },
      capabilities: { experimentalApi: true, requestAttestation: false },
    });
    rpc.notify("initialized");
    const { account } = await rpc.request("account/read", {});
    if (account?.type !== "chatgpt") throw new Error("Sign in with ChatGPT on the owner computer.");
    const opened = await rpc.request("thread/start", {
      model: input.model,
      modelProvider: "openai",
      allowProviderModelFallback: false,
      cwd: location.path,
      approvalPolicy: "never",
      sandbox: "read-only",
      ephemeral: true,
      developerInstructions: "",
      dynamicTools: [],
    });
    rpc.claimThread(opened.thread.id);
    await rpc.request("turn/start", {
      threadId: opened.thread.id,
      model: input.model,
      input: [{ type: "text", text: input.prompt, text_elements: [] }],
    });
    return await result.promise;
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener("abort", cancel);
    rpc.dispose(new Error("CodeShare session closed."));
    terminateChildProcessTree(child, { ownedProcessGroup });
    await exited;
  }
}
