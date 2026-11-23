import { devinCredentialsPath, parseDevinCredentials } from "./credentials";
import { z } from "zod";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  CODE_SHARE_WORKSPACE_MCP,
  CODE_SHARE_REMOTE_TURN_TIMEOUT_MS,
} from "@/shared/codeShareFileTools";
import type { ProjectLocation, ThreadConfig } from "@/shared/contracts";
import type { CodeShareStructuredChatInput } from "../base";
import { readAgentCommandOutput } from "../base";
import { createAcpStructuredSession } from "../acp";
import { resolveDevinBinaryPath } from "./binary";
import { loadDevinModelsForKey } from "./modelCatalog";
import { createDevinAcpModelResolver, devinModelCapabilities } from "./models";
import { resolveDevinAcpMode } from "./acp/sessionModes";

// Qualified against Devin Desktop 3000.14.30833 (a165b2eb0a68).
// Native tools/permission syntax: docs.devin.ai/cli/reference/permissions.md
// and configuration/config-file.md; disabled_tools is also in this binary.
export const DEVIN_SHARE_VERSION = "3000.14.30833 (a165b2eb0a68)";
export function devinSharePolicy() {
  const nativeTools = ["read", "write", "edit", "grep", "glob", "exec"];
  return {
    auto_update: false,
    notify: "never",
    subagents_enabled: false,
    respect_gitignore: true,
    disabled_tools: nativeTools,
    permissions: {
      deny: [...nativeTools, "Read(/**)", "Write(/**)"],
      allow: [`mcp__${CODE_SHARE_WORKSPACE_MCP}__*`],
      ask: [],
    },
    read_config_from: Object.fromEntries(
      [
        "agents_standard",
        "cursor",
        "windsurf",
        "claude",
        "copilot",
        "codex",
        "kiro",
        "opencode",
        "zed",
      ].map((name) => [name, false]),
    ),
    hooks: {},
  };
}
const importedSchema = z.strictObject({
  format: z.literal("devin-credentials-v1"),
  toml: z.string().max(14000),
});
export async function importDevinCodeShareKey(): Promise<string> {
  const toml = await readFile(devinCredentialsPath(), "utf8");
  if (!parseDevinCredentials(toml))
    throw new Error("Sign in to Devin on the owner computer first.");
  return JSON.stringify(importedSchema.parse({ format: "devin-credentials-v1", toml }));
}
async function prepare(location: ProjectLocation, key: string, signal?: AbortSignal) {
  if (location.kind === "wsl") throw new Error("CodeShare needs a native Devin ACP runtime.");
  const binary = resolveDevinBinaryPath(location);
  if (!binary)
    throw new Error("Install Devin Desktop or the native Devin runtime on the owner computer.");
  const env = {
    RUST_LOG: "error",
    XDG_CACHE_HOME: join(location.path, "cache"),
    XDG_CONFIG_HOME: join(location.path, "config"),
    XDG_DATA_HOME: join(location.path, "data"),
    WINDSURF_API_KEY: key,
    ...(process.platform === "win32" ? { APPDATA: join(location.path, "config") } : {}),
  };
  if (key.startsWith("{")) {
    const imported = importedSchema.parse(JSON.parse(key));
    if (!parseDevinCredentials(imported.toml))
      throw new Error("Invalid native Devin account credentials.");
    env.WINDSURF_API_KEY = "";
    const dataRoot = join(process.platform === "win32" ? env.APPDATA! : env.XDG_DATA_HOME, "devin");
    await mkdir(dataRoot, { recursive: true, mode: 0o700 });
    await writeFile(join(dataRoot, "credentials.toml"), imported.toml, { mode: 0o600 });
  }
  const configRoot = join(env.XDG_CONFIG_HOME, "devin");
  await mkdir(configRoot, { recursive: true, mode: 0o700 });
  await writeFile(join(configRoot, "config.json"), JSON.stringify(devinSharePolicy()), {
    mode: 0o600,
  });
  const version = await readAgentCommandOutput(location, binary, ["--version"], {
    env,
    timeoutMs: 10_000,
    ...(signal ? { signal } : {}),
  });
  if (!version.ok || !version.stdout.includes(DEVIN_SHARE_VERSION))
    throw new Error("CodeShare requires the qualified Devin 3000.14.30833 runtime.");
  const digest = createHash("sha256").update(key).update(DEVIN_SHARE_VERSION).digest("hex");
  const families = await loadDevinModelsForKey(
    "codeshare-key-v1:" + digest,
    location,
    binary,
    signal,
    env,
    ["--process-model", "in-process"],
  );
  if (!families.length) throw new Error("This Devin account key has no available models.");
  return { binary, env, configRoot, families };
}
export async function devinCodeShareKeyCatalog(
  key: string,
  location: ProjectLocation,
  signal?: AbortSignal,
) {
  const { families } = await prepare(location, key, signal);
  return devinModelCapabilities(families).models.map(({ id, label }) => ({ id, label }));
}
export async function runDevinCodeShareKeyChat(
  input: CodeShareStructuredChatInput & { key: string },
): Promise<string> {
  const { binary, env, configRoot, families } = await prepare(
    input.location,
    input.key,
    input.signal,
  );
  const server = input.remoteTools
    ? {
        id: CODE_SHARE_WORKSPACE_MCP,
        name: CODE_SHARE_WORKSPACE_MCP,
        timeoutMs: 65_000,
        transport: {
          type: "http" as const,
          url: input.remoteTools.url,
          headers: { Authorization: `Bearer ${input.remoteTools.token}` },
        },
      }
    : undefined;
  await writeFile(
    join(configRoot, "mcp_config.json"),
    JSON.stringify({
      mcpServers: server
        ? {
            [server.name]: {
              url: server.transport.url,
              transport: "http",
              headers: server.transport.headers,
            },
          }
        : {},
    }),
    { mode: 0o600 },
  );
  const config: ThreadConfig = { model: input.model, approvalPolicy: "accept-edits" };
  const session = createAcpStructuredSession(
    { command: binary, args: ["--process-model", "in-process", "acp"], env },
    {
      threadId: randomUUID(),
      projectLocation: input.location,
      config,
      presentationMode: "gui",
      mcpServers: server ? [server] : [],
      acpFsTextCapability: false,
      acpTerminalCapability: false,
      acpLocalResourceResolution: false,
    },
    {
      resolveModelConfig: createDevinAcpModelResolver({ families }),
      resolveMode: resolveDevinAcpMode,
      behavior: { strictConfigSelection: true },
    },
  );
  if (!session) throw new Error("The Devin ACP runtime did not start.");
  let failure: Error | undefined;
  const assistant = new Set<string>();
  const texts = new Map<string, string>();
  session.setListener({
    onRuntimeEvent(event) {
      if (event.type === "request.opened") {
        failure = new Error("Devin requested an unavailable owner tool or permission.");
        void session.dispose().catch(() => undefined);
      }
      if (event.type === "item.started" && event.itemType === "assistant_message")
        assistant.add(event.itemId);
      if (event.type === "content.delta" && assistant.has(event.itemId))
        texts.set(
          event.itemId,
          event.replace ? event.delta : (texts.get(event.itemId) ?? "") + event.delta,
        );
      if (event.type === "turn.completed" && event.state !== "completed")
        failure = new Error("The owner Devin ACP turn did not complete.");
    },
    onError(error) {
      failure = new Error(error);
    },
    onClose() {},
    onUpdate() {},
  });
  const cancel = () => {
    void session.dispose();
  };
  input.signal?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(
    cancel,
    input.remoteTools ? CODE_SHARE_REMOTE_TURN_TIMEOUT_MS + 30_000 : 150_000,
  ).unref();
  try {
    input.signal?.throwIfAborted();
    await session.activate();
    await session.openThread(config);
    await session.startTurn(input.prompt, config);
    input.signal?.throwIfAborted();
    if (failure) throw failure;
    const text = [...texts.values()].join("\n\n");
    if (!text.trim()) throw new Error("Devin returned no assistant text.");
    return text;
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener("abort", cancel);
    await session.dispose();
  }
}
