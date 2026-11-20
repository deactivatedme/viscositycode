import { describe, expect, it, vi } from "vitest";
import type { McpExternalServerCandidate, McpServer } from "@/shared/contracts";
import {
  addIdaDebuggerServer,
  buildIdaDebuggerServer,
  findIdaProSource,
  IDA_DEBUGGER_SERVER_NAME,
} from "./addIdaDebuggerServer";

const ida: McpServer = {
  id: "srv-ida",
  name: "ida-pro-mcp",
  description: "",
  enabled: true,
  timeoutMs: 60_000,
  transport: { type: "stdio", command: "uvx", args: ["ida-pro-mcp"], env: { A: "1" } },
};
const other: McpServer = {
  ...ida,
  id: "srv-x",
  name: "memory",
  transport: { type: "stdio", command: "npx", args: ["server-memory"], env: {} },
};

function setup(servers: McpServer[], discovered: McpExternalServerCandidate[] = []) {
  const saveServers = vi.fn<(servers: McpServer[]) => Promise<void>>(async () => undefined);
  const discover = vi.fn<() => Promise<McpExternalServerCandidate[]>>(async () => discovered);
  const run = () =>
    addIdaDebuggerServer({
      persistence: { loadServers: async () => servers, saveServers },
      discover,
      description: "IDA debugger",
      newId: () => "new-id",
    });
  return { saveServers, discover, run };
}

describe("addIdaDebuggerServer", () => {
  it("appends a switched-off copy with --unsafe added exactly once", async () => {
    const { saveServers, discover, run } = setup([other, ida]);
    await expect(run()).resolves.toBe("added");
    expect(discover).not.toHaveBeenCalled();
    expect(saveServers).toHaveBeenCalledExactlyOnceWith([
      other,
      ida,
      {
        id: "new-id",
        name: IDA_DEBUGGER_SERVER_NAME,
        description: "IDA debugger",
        enabled: false,
        timeoutMs: 60_000,
        transport: {
          type: "stdio",
          command: "uvx",
          args: ["ida-pro-mcp", "--unsafe"],
          env: { A: "1" },
        },
      },
    ]);
    // The source row is left as it was.
    expect(ida.transport).toMatchObject({ args: ["ida-pro-mcp"] });
    const already = buildIdaDebuggerServer(
      { ...ida, transport: { ...ida.transport, args: ["--unsafe"] } as McpServer["transport"] },
      { id: "x", description: "" },
    );
    expect(already.transport).toMatchObject({ args: ["--unsafe"] });
  });

  it("is idempotent once the debugger server exists", async () => {
    const existing = { ...ida, id: "srv-dbg", name: "IDA-PRO-MCP-DEBUG", enabled: false };
    const { saveServers, run } = setup([ida, existing]);
    await expect(run()).resolves.toBe("exists");
    expect(saveServers).not.toHaveBeenCalled();
  });

  it("finds the server by its command when it has another name", () => {
    const renamed = { ...ida, name: "disassembler" };
    expect(findIdaProSource([other, renamed])).toBe(renamed);
    expect(findIdaProSource([{ ...ida, name: "ida_pro_mcp" }])?.name).toBe("ida_pro_mcp");
  });

  it("falls back to an agent's config, refusing non-stdio or unsupported candidates", async () => {
    const http: McpExternalServerCandidate = {
      id: "c1",
      name: "ida-pro-mcp",
      enabled: true,
      timeoutMs: 30_000,
      transport: { type: "http", url: "http://127.0.0.1:13337/mcp", headers: {} },
    };
    const sensitive: McpExternalServerCandidate = {
      ...http,
      id: "c2",
      transport: ida.transport,
      unsupportedReason: "sensitive-values",
    };
    const refused = setup([other], [http, sensitive]);
    await expect(refused.run()).resolves.toBe("no-source");
    expect(refused.saveServers).not.toHaveBeenCalled();

    const usable: McpExternalServerCandidate = { ...http, id: "c3", transport: ida.transport };
    const found = setup([other], [http, usable]);
    await expect(found.run()).resolves.toBe("added");
    // Saved through the app's own MCP settings only, appended to its list.
    expect(found.saveServers.mock.calls[0]?.[0]).toEqual([
      other,
      expect.objectContaining({ name: IDA_DEBUGGER_SERVER_NAME, enabled: false }),
    ]);
  });

  it("commits against a fresh read taken after discovery", async () => {
    const usable: McpExternalServerCandidate = {
      ...other,
      id: "c1",
      name: "ida-pro-mcp",
      transport: ida.transport,
    };
    const { saveServers, discover } = setup([other], [usable]);
    const changed = { ...other, id: "srv-new", name: "added-elsewhere" };
    const loadServers = vi
      .fn<() => Promise<McpServer[]>>()
      .mockResolvedValueOnce([other])
      .mockResolvedValueOnce([other, changed]);
    await expect(
      addIdaDebuggerServer({
        persistence: { loadServers, saveServers },
        discover,
        description: "d",
        newId: () => "n",
      }),
    ).resolves.toBe("added");
    expect(saveServers.mock.calls[0]?.[0]).toEqual([
      other,
      changed,
      expect.objectContaining({ name: IDA_DEBUGGER_SERVER_NAME }),
    ]);

    // Another window added the debugger server meanwhile: no second copy.
    saveServers.mockClear();
    const raced = vi
      .fn<() => Promise<McpServer[]>>()
      .mockResolvedValueOnce([other])
      .mockResolvedValueOnce([other, { ...ida, id: "dbg", name: IDA_DEBUGGER_SERVER_NAME }]);
    await expect(
      addIdaDebuggerServer({
        persistence: { loadServers: raced, saveServers },
        discover,
        description: "d",
      }),
    ).resolves.toBe("exists");
    expect(saveServers).not.toHaveBeenCalled();
  });

  it("reports no source when discovery fails", async () => {
    const { run, discover, saveServers } = setup([other]);
    discover.mockRejectedValueOnce(new Error("no bridge"));
    await expect(run()).resolves.toBe("no-source");
    expect(saveServers).not.toHaveBeenCalled();
  });
});
