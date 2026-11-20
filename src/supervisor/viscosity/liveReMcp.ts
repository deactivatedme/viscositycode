/**
 * ViscosityCode: the host-provided `live_re` MCP server (native/live-re).
 *
 * Added next to user and plugin servers at launch, so every provider gets it
 * through the normal path (authorization, GUI routing, tool-filter proxies,
 * terminal config) with no adapter changes. No `approvalMode`: every call is
 * approved like any user server.
 */
import type { ThreadConfig } from "@/shared/contracts";
import type { ProjectLocation } from "@/shared/contracts/common";
import type { McpServer } from "@/shared/contracts/mcpServer";
import {
  LIVE_RE_MCP_OVERRIDE_ID,
  LIVE_RE_MCP_SERVER_NAME,
  LIVE_RE_PROTOCOL_ENV,
  LIVE_RE_PROTOCOL_VERSION,
} from "@/shared/viscosity/liveRe";
import { liveReBinaryPath } from "@/shared/viscosity/liveReBinary";

/** re_attach and re_wait block for up to 55-60 s. */
export const LIVE_RE_MCP_TIMEOUT_MS = 120_000;

/**
 * `[live_re]` when the chat turned it on (`mcpServerOverrides["viscosity.live-re"]`),
 * the project runs on this host (not WSL), the helper is staged and no
 * configured server already uses the name. Otherwise `[]`; never throws, so a
 * missing helper never fails a launch.
 */
export function liveReMcpServers(
  config: Pick<ThreadConfig, "mcpServerOverrides">,
  location: ProjectLocation,
  existing: readonly Pick<McpServer, "name">[],
  findBinary: () => string | undefined = () => liveReBinaryPath(),
): McpServer[] {
  if (config.mcpServerOverrides?.[LIVE_RE_MCP_OVERRIDE_ID] !== true) return [];
  if (location.kind === "wsl") return [];
  if (existing.some((server) => server.name === LIVE_RE_MCP_SERVER_NAME)) return [];
  const command = findBinary();
  if (!command) return [];
  return [
    {
      id: LIVE_RE_MCP_OVERRIDE_ID,
      name: LIVE_RE_MCP_SERVER_NAME,
      description: "Live debugging of running programs through LLDB",
      enabled: true,
      timeoutMs: LIVE_RE_MCP_TIMEOUT_MS,
      transport: {
        type: "stdio",
        command,
        args: [],
        env: { [LIVE_RE_PROTOCOL_ENV]: String(LIVE_RE_PROTOCOL_VERSION) },
      },
    },
  ];
}
