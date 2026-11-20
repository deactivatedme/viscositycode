// ViscosityCode: the live_re launch server is opt-in per chat and never breaks a launch.
import { describe, expect, it } from "vitest";
import type { ProjectLocation } from "@/shared/contracts/common";
import {
  resolveEnabledMcpServers,
  resolveMcpLaunchSnapshot,
  type McpServer,
} from "@/shared/contracts/mcpServer";
import { liveReMcpServers } from "./liveReMcp";

const MAC: ProjectLocation = { kind: "posix", path: "/Users/me/app" };
const WIN: ProjectLocation = { kind: "windows", path: "C:\\src\\app" };
const WSL: ProjectLocation = {
  kind: "wsl",
  distro: "Ubuntu",
  linuxPath: "/home/me/app",
  uncPath: "\\\\wsl$\\Ubuntu\\home\\me\\app",
};
const ON = { mcpServerOverrides: { "viscosity.live-re": true } };
const binary = () =>
  "/Apps/ViscosityCode.app/Contents/Resources/wsl-helpers/live-re/darwin-universal/viscosity-live-re";

const userServer: McpServer = {
  id: "0b6c3c1e-1111-4a4a-8888-000000000001",
  name: "ida-pro-mcp",
  description: "",
  enabled: true,
  timeoutMs: 30_000,
  transport: { type: "stdio", command: "uvx", args: ["ida-pro-mcp"], env: {} },
};

describe("liveReMcpServers", () => {
  it("is off by default, including pre-upgrade configs without the key", () => {
    expect(liveReMcpServers({}, MAC, [], binary)).toEqual([]);
    expect(liveReMcpServers({ mcpServerOverrides: { other: true } }, MAC, [], binary)).toEqual([]);
    expect(
      liveReMcpServers({ mcpServerOverrides: { "viscosity.live-re": false } }, MAC, [], binary),
    ).toEqual([]);
  });

  it("adds one stdio live_re with the protocol env and no approval shortcut", () => {
    const [server, ...rest] = liveReMcpServers(ON, WIN, [userServer], binary);
    expect(rest).toEqual([]);
    expect(server).toEqual({
      id: "viscosity.live-re",
      name: "live_re",
      description: expect.any(String),
      enabled: true,
      timeoutMs: 120_000,
      transport: {
        type: "stdio",
        command: binary(),
        args: [],
        env: { VISCOSITY_LIVE_RE_PROTOCOL: "1" },
      },
    });
    expect(server).not.toHaveProperty("approvalMode");
    expect(server).not.toHaveProperty("disabledTools");
  });

  it("stays absent for WSL projects, a missing helper, or a configured live_re", () => {
    expect(liveReMcpServers(ON, WSL, [], binary)).toEqual([]);
    expect(liveReMcpServers(ON, MAC, [], () => undefined)).toEqual([]);
    expect(liveReMcpServers(ON, MAC, [{ ...userServer, name: "live_re" }], binary)).toEqual([]);
  });

  it("leaves user servers alone when an older-style snapshot sees the reserved key", () => {
    const snapshot = resolveMcpLaunchSnapshot(
      { mcpServers: [userServer], disabledBuiltInMcpServers: {}, disabledBuiltInMcpTools: {} },
      null,
      { "viscosity.live-re": true },
    );
    expect(snapshot.mcpServers).toEqual([userServer]);
  });

  it("composes like the spawn pipeline merge: once, after user and plugin servers", () => {
    const merge = (user: McpServer[], plugin: McpServer[]) =>
      resolveEnabledMcpServers([
        ...user,
        ...plugin,
        ...liveReMcpServers(ON, MAC, [...user, ...plugin], binary),
      ]).map((server) => server.name);
    expect(merge([userServer], [])).toEqual(["ida-pro-mcp", "live_re"]);
    expect(merge([], [{ ...userServer, id: "plugin", name: "live_re" }])).toEqual(["live_re"]);
    // A disabled user server named live_re still keeps the host one out.
    expect(merge([{ ...userServer, name: "live_re", enabled: false }], [])).toEqual([]);
  });
});
