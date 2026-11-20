import { describe, expect, it, vi } from "vitest";
import type { McpServer } from "@/shared/contracts";
import { RemoteDesktopClient } from "./client";
import type { RemoteFetch } from "./clientTypes";

const server: McpServer = {
  id: "memory-id",
  name: "memory",
  description: "",
  enabled: true,
  timeoutMs: 30_000,
  transport: { type: "stdio", command: "npx", args: [], env: { API_KEY: "«redacted»" } },
};

describe("MCP settings routes", () => {
  it("reads, commands one row, and runs operations on the host's MCP settings routes", async () => {
    const fetchImpl = vi.fn<RemoteFetch>(async (url) => {
      if (String(url).endsWith("/operation")) {
        return Response.json({
          kind: "probe",
          result: {
            status: "available",
            toolCount: 1,
            tools: ["read"],
            latencyMs: 4,
            environment: { runtime: "host", projectScoped: false },
          },
        });
      }
      return Response.json({ servers: [server] });
    });
    const client = new RemoteDesktopClient("https://host.test/", "token", fetchImpl);

    await expect(client.mcpSettings()).resolves.toEqual([server]);
    await expect(
      client.mcpSettingsCommand({ kind: "remove", scope: { kind: "global" }, serverId: server.id }),
    ).resolves.toEqual([server]);
    await expect(
      client.mcpSettingsOperation({
        kind: "probe",
        scope: { kind: "global" },
        serverId: server.id,
      }),
    ).resolves.toMatchObject({ kind: "probe", result: { status: "available", toolCount: 1 } });

    const calls = fetchImpl.mock.calls.map(([url, init]) => [
      String(url),
      init?.method,
      init?.body,
    ]);
    expect(calls).toEqual([
      ["https://host.test/api/settings/mcp-servers", "GET", undefined],
      [
        "https://host.test/api/settings/mcp-servers/command",
        "POST",
        JSON.stringify({ kind: "remove", scope: { kind: "global" }, serverId: server.id }),
      ],
      [
        "https://host.test/api/settings/mcp-servers/operation",
        "POST",
        JSON.stringify({ kind: "probe", scope: { kind: "global" }, serverId: server.id }),
      ],
    ]);
  });

  it("rejects an operation answer for a different operation", async () => {
    const fetchImpl = vi.fn<RemoteFetch>(async () => Response.json({ kind: "oauth-clear" }));
    const client = new RemoteDesktopClient("https://host.test/", "token", fetchImpl);
    await expect(
      client.mcpSettingsOperation({ kind: "probe", scope: { kind: "global" }, serverId: "x" }),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });
});
