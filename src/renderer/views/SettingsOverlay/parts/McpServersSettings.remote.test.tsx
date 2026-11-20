import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { McpServer } from "@/shared/contracts";
import type { PoracodeBridge } from "@/shared/ipc";
import { RemoteDesktopClient } from "@/shared/remote/client";
import type { RemoteFetch } from "@/shared/remote/clientTypes";
import { renderWithI18n } from "@/renderer/testUtils/i18n";
import { useAppStore } from "@/renderer/state/appStore";
import { useRemoteServersStore } from "@/renderer/state/remoteServersStore";

const { bridge, host } = vi.hoisted(() => ({
  bridge: {
    probeMcpServer: vi.fn<PoracodeBridge["probeMcpServer"]>(),
    getMcpOauthStatus: vi.fn<PoracodeBridge["getMcpOauthStatus"]>(async () => ({
      authenticatedUrls: [],
    })),
  },
  host: { client: null as unknown, browser: false },
}));

vi.mock("@/renderer/bridge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/renderer/bridge")>()),
  isRemoteSession: () => true,
  readBridge: () => bridge,
}));
vi.mock("@/renderer/browser/remoteBridge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/renderer/browser/remoteBridge")>()),
  getRemoteBridgeClient: () => host.client,
  subscribeRemoteBridgeClient: () => () => undefined,
}));
// The bridge client's paired record: its projects take moves, and its key names OAuth's machine.
vi.mock("@/renderer/state/settingsHostStore", () => ({
  useSettingsHostServer: () => ({
    desktopId: "host-key",
    label: "Host",
    endpoint: "https://host.test/",
    accessToken: "token",
    scopes: [],
  }),
}));
vi.mock("@/renderer/clientRuntime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/renderer/clientRuntime")>()),
  isBrowserClientRuntime: () => host.browser,
}));
vi.mock("@/renderer/components/plugins/pluginCopy", () => ({
  useLocalizedPluginCatalog: () => [],
}));
vi.mock("./CrossagentRoutingSection", () => ({ CrossagentRoutingSection: () => null }));
vi.mock("@/renderer/state/projectSettings/projectSettingsLoader", () => ({
  ensureProjectMcpServersLoaded: () => Promise.resolve(),
  loadAuthoritativeProjectMcpServers: () => Promise.resolve([]),
}));

import { McpServersSettings } from "./McpServersSettings";

// The host's redacted read: every credential-bearing value is a mask marker.
const memory: McpServer = {
  id: "memory-id",
  name: "memory",
  description: "",
  enabled: true,
  timeoutMs: 30_000,
  transport: {
    type: "stdio",
    command: "npx",
    args: ["--token=«redacted»"],
    env: { API_KEY: "«redacted»" },
  },
};
const docs: McpServer = {
  ...memory,
  id: "docs-id",
  name: "docs",
  transport: {
    type: "http",
    url: "https://docs.test/mcp",
    headers: { Authorization: "«redacted»" },
  },
};

interface HostRequest {
  path: string;
  method: string;
  body?: Record<string, unknown>;
}

function pairHost(options: { readStatus?: number; docsNeedsSignIn?: boolean } = {}) {
  const requests: HostRequest[] = [];
  let servers = [memory, docs];
  const fetchImpl = vi.fn<RemoteFetch>(async (url, init) => {
    const path = new URL(String(url)).pathname;
    const body =
      typeof init?.body === "string"
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : undefined;
    requests.push({ path, method: init?.method ?? "GET", ...(body ? { body } : {}) });
    if (path === "/api/settings/mcp-servers") {
      if (options.readStatus) {
        return Response.json(
          { error: { code: "not_found", message: "Remote endpoint not found." } },
          { status: options.readStatus },
        );
      }
      return Response.json({ servers });
    }
    if (path === "/api/settings/mcp-servers/command") {
      if (body?.kind === "remove") servers = servers.filter((item) => item.id !== body.serverId);
      if (body?.kind === "upsert") {
        const next = body.server as McpServer;
        servers = servers.map((item) => (item.id === next.id ? next : item));
      }
      if (body?.kind === "move") servers = servers.filter((item) => item.id !== body.serverId);
      return Response.json({ servers });
    }
    if (path === "/api/settings/mcp-servers/operation") {
      if (body?.kind === "probe" && options.docsNeedsSignIn && body.serverId === "docs-id") {
        return Response.json({
          kind: "probe",
          result: {
            status: "auth-required",
            toolCount: 0,
            latencyMs: 3,
            environment: { runtime: "host", projectScoped: false },
            error: { code: "auth-required", message: "Sign in required." },
          },
        });
      }
      if (body?.kind === "probe") {
        return Response.json({
          kind: "probe",
          result: {
            status: "available",
            toolCount: 2,
            tools: ["read", "write"],
            latencyMs: 3,
            environment: { runtime: "host", projectScoped: false },
          },
        });
      }
      return Response.json({ kind: "oauth-status", authenticatedServerIds: [] });
    }
    return Response.json({ error: { code: "not_found", message: "Missing." } }, { status: 404 });
  });
  host.client = new RemoteDesktopClient("https://host.test/", "token", fetchImpl);
  const commands = () =>
    requests.filter((request) => request.path === "/api/settings/mcp-servers/command");
  return { requests, commands };
}

describe("McpServersSettings in a remote session", () => {
  beforeEach(() => {
    bridge.probeMcpServer.mockReset();
    host.browser = false;
    useAppStore.setState({ projects: [] });
  });

  it("writes one row per edit and never sends the host's list or its masked secrets back", async () => {
    const { requests, commands } = pairHost();
    renderWithI18n(<McpServersSettings />);

    fireEvent.click(await screen.findByRole("switch", { name: "Disable memory" }));
    await waitFor(() => expect(commands()).toHaveLength(1));
    expect(commands()[0]?.body).toEqual({
      kind: "upsert",
      scope: { kind: "global" },
      server: { ...memory, enabled: false },
    });

    fireEvent.click(screen.getByRole("button", { name: "Delete docs" }));
    await waitFor(() => expect(commands()).toHaveLength(2));
    expect(commands()[1]?.body).toEqual({
      kind: "remove",
      scope: { kind: "global" },
      serverId: "docs-id",
    });

    // Only the edited row travels; docs' masked header never leaves as a value,
    // no request carries a server list, and nothing goes to this device's settings.
    const bodies = requests.map((request) => JSON.stringify(request.body ?? {}));
    expect(bodies.filter((body) => body.includes('"Authorization"'))).toEqual([]);
    expect(bodies.some((body) => body.includes('"servers"'))).toBe(false);
    expect(requests.some((request) => request.path === "/api/settings")).toBe(false);
  });

  it("probes through the host's operation route, never with the redacted definition", async () => {
    const { requests } = pairHost();
    renderWithI18n(<McpServersSettings />);

    expect(await screen.findAllByRole("button", { name: "2 tools" })).toHaveLength(2);
    const probes = requests
      .filter((request) => request.body?.kind === "probe")
      .map((request) => [request.path, request.body?.serverId]);
    expect(probes).toEqual([
      ["/api/settings/mcp-servers/operation", "memory-id"],
      ["/api/settings/mcp-servers/operation", "docs-id"],
    ]);
    expect(bridge.probeMcpServer).not.toHaveBeenCalled();
  });

  it("moves a Global server to a project on the same host with the host's move command", async () => {
    // Browser clients see every project projected, the bridge host's own included.
    useAppStore.setState({
      projects: [
        {
          id: "remote:host-key:project:p1",
          name: "Demo project",
          remoteServerId: "host-key",
          remoteId: "p1",
          location: { kind: "posix", path: "/work/demo", remoteServerId: "host-key" },
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    useRemoteServersStore.setState({
      runtime: { "host-key": { status: "online", projects: [], threads: [] } },
    });
    const { commands } = pairHost();
    renderWithI18n(<McpServersSettings />);

    fireEvent.click(await screen.findByRole("button", { name: "Edit memory" }));
    fireEvent.click(screen.getByRole("button", { name: "Scope" }));
    fireEvent.click(await screen.findByRole("menuitemradio", { name: /Demo project/u }));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Edit MCP server" })).getByRole("button", {
        name: "Save",
      }),
    );

    await waitFor(() => expect(commands()).toHaveLength(2));
    expect(commands().map((command) => command.body)).toEqual([
      { kind: "upsert", scope: { kind: "global" }, server: memory },
      {
        kind: "move",
        source: { kind: "global" },
        destination: { kind: "project", projectId: "p1" },
        serverId: "memory-id",
      },
    ]);
  });

  it("lists built-in tools without toggles, since their disabled set is not on the wire", async () => {
    pairHost();
    const { container } = renderWithI18n(<McpServersSettings />);
    await screen.findByRole("switch", { name: "Disable memory" });

    const browserRow = container.querySelector<HTMLElement>('[data-built-in-mcp-server="browser"]');
    fireEvent.click(within(browserRow!).getByRole("button", { name: /tools?$/u }));
    expect(
      within(screen.getByRole("dialog", { name: "Browser" })).queryAllByRole("switch"),
    ).toEqual([]);
  });

  it("tells the user to update an older host that has no MCP settings routes", async () => {
    pairHost({ readStatus: 404 });
    renderWithI18n(<McpServersSettings />);

    expect(
      await screen.findByText(
        "This host can't edit MCP servers from here. Update ViscosityCode on the host.",
      ),
    ).toBeTruthy();
    // Built-in servers stay listed and switchable below the note.
    expect(screen.getByRole("switch", { name: "Disable Browser" })).toBeTruthy();
  });

  it("does not start host OAuth from a browser that is not on the host machine", async () => {
    host.browser = true;
    const { requests } = pairHost({ docsNeedsSignIn: true });
    renderWithI18n(<McpServersSettings />);

    fireEvent.click(await screen.findByRole("button", { name: "Authenticate" }));
    await waitFor(() => expect(requests.some((r) => r.body?.kind === "probe")).toBe(true));
    expect(requests.some((request) => request.body?.kind === "oauth-begin")).toBe(false);
  });
});
