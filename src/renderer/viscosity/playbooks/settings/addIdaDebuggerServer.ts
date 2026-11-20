/**
 * ViscosityCode: "Add IDA debugger server". ida-pro-mcp exposes its debugger
 * tools only when started with `--unsafe`, so this appends a separate,
 * switched-off copy of the user's ida-pro-mcp server to the app's own MCP
 * servers (Live reversing switches it on per chat). The source is an app
 * server first, then a server found in an agent's own config (read only, as
 * the import dialog does). Nothing but the app's MCP settings is written.
 */
import type { McpExternalServerCandidate, McpServer } from "@/shared/contracts";

export const IDA_DEBUGGER_SERVER_NAME = "ida-pro-mcp-debug";
const UNSAFE_FLAG = "--unsafe";
const IDA_NAME = /^ida[-_]?pro[-_]?mcp$/iu;
const IDA_PACKAGE = /ida[-_]pro[-_]mcp/iu;

type Source = Pick<McpServer, "name" | "timeoutMs" | "transport"> &
  Pick<Partial<McpExternalServerCandidate>, "unsupportedReason">;

export type AddIdaDebuggerResult = "added" | "exists" | "no-source";

export function hasIdaDebuggerServer(servers: readonly Pick<McpServer, "name">[]): boolean {
  return servers.some((server) => server.name.toLowerCase() === IDA_DEBUGGER_SERVER_NAME);
}

/** The user's ida-pro-mcp server: by name first, then by the command that runs it. */
export function findIdaProSource<T extends Source>(servers: readonly T[]): T | undefined {
  const usable = servers.filter(
    (server) =>
      server.transport.type === "stdio" &&
      server.unsupportedReason === undefined &&
      server.name.toLowerCase() !== IDA_DEBUGGER_SERVER_NAME,
  );
  return (
    usable.find((server) => IDA_NAME.test(server.name)) ??
    usable.find(
      (server) =>
        server.transport.type === "stdio" &&
        [server.transport.command, ...server.transport.args].some((part) => IDA_PACKAGE.test(part)),
    )
  );
}

export function buildIdaDebuggerServer(
  source: Source,
  options: { id: string; description: string },
): McpServer {
  if (source.transport.type !== "stdio") throw new Error("ida-pro-mcp must run over stdio");
  const { args } = source.transport;
  return {
    id: options.id,
    name: IDA_DEBUGGER_SERVER_NAME,
    description: options.description,
    enabled: false,
    timeoutMs: source.timeoutMs,
    transport: {
      ...source.transport,
      args: args.includes(UNSAFE_FLAG) ? [...args] : [...args, UNSAFE_FLAG],
    },
  };
}

export async function addIdaDebuggerServer(options: {
  persistence: {
    loadServers: () => Promise<McpServer[]>;
    saveServers: (servers: McpServer[]) => Promise<void>;
  };
  /** Servers from agents' own configs; only read when the app has no ida-pro-mcp. */
  discover: () => Promise<readonly McpExternalServerCandidate[]>;
  description: string;
  newId?: () => string;
}): Promise<AddIdaDebuggerResult> {
  const current = await options.persistence.loadServers();
  if (hasIdaDebuggerServer(current)) return "exists";
  const source =
    findIdaProSource(current) ?? findIdaProSource(await options.discover().catch(() => []));
  if (!source) return "no-source";
  const server = buildIdaDebuggerServer(source, {
    id: (options.newId ?? (() => crypto.randomUUID()))(),
    description: options.description,
  });
  // Discovery awaited an IPC call; commit against a fresh read so concurrent edits survive.
  const latest = await options.persistence.loadServers();
  if (hasIdaDebuggerServer(latest)) return "exists";
  await options.persistence.saveServers([...latest, server]);
  return "added";
}
