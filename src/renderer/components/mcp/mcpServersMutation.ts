// Modified for ViscosityCode (fork of Poracode). See FORK_CHANGES.md.
import type { McpServer } from "@/shared/contracts";
import {
  flushSharedSettings,
  useSharedSettings,
  whenSharedSettingsHydrated,
} from "@/renderer/state/sharedSettingsStore";

/**
 * The persist surface the MCP mutation helpers need; `McpServerSource` and
 * `McpImportProjectTarget` both extend it.
 *
 * - `loadServers` is the authoritative re-read for sources whose catalog row
 *   does not carry private MCP settings: an absolute-list commit (import, add,
 *   move) against such a source must merge into the freshly loaded list, never
 *   into a not-yet-loaded projection that would erase the host's real
 *   configuration. Without it the captured `servers` list stands in.
 * - `saveServers` is the only persist channel. It resolves when the write is
 *   as confirmed as that source can be and rejects on refusal — commit paths
 *   that sequence another write after it (a move must not delete the source
 *   copy before the destination save is confirmed) rely on both.
 */
export interface McpServersSink {
  servers: McpServer[];
  loadServers?: () => Promise<McpServer[]>;
  saveServers: (servers: McpServer[]) => Promise<void>;
  // ViscosityCode: single-row writes for a host-owned, redacted list.
  rows?: McpServerRowCommands;
}

/**
 * Single-row writes for a list its host owns and serves redacted (Global in a
 * remote session). When present, every write goes through these instead of
 * `saveServers`: sending the list back would return each masked secret as a
 * value. The host restores the masks of the one row it receives.
 */
export interface McpServerRowCommands {
  upsert: (server: McpServer) => Promise<void>;
  remove: (serverId: string) => Promise<void>;
  /**
   * Move `server` (with its edits) between this list and project `projectId`
   * on the host, which holds the only unredacted copy. Resolves `false`,
   * having written nothing, when that project is not on this list's host.
   */
  move: (server: McpServer, projectId: string, toProject: boolean) => Promise<boolean>;
}

/** The source's current list — authoritative when it exposes a fresh read. */
export async function readCurrentServers(sink: McpServersSink): Promise<McpServer[]> {
  return sink.loadServers ? sink.loadServers() : sink.servers;
}

/**
 * Apply one row-level edit (enable/disable, tool toggles) to the source's
 * CURRENT list, never the render-time projection: another client's servers and
 * the row's latest fields are preserved. A row that has vanished from the
 * fresh read is not resurrected and nothing is written.
 */
export async function updateServerRow(
  sink: McpServersSink,
  serverId: string,
  update: (server: McpServer) => McpServer,
): Promise<void> {
  const current = await readCurrentServers(sink);
  const row = current.find((item) => item.id === serverId);
  if (!row) return;
  const next = update(row);
  if (sink.rows) await sink.rows.upsert(next); // ViscosityCode
  else await sink.saveServers(current.map((item) => (item.id === serverId ? next : item)));
}

/**
 * Remove one row from the source's CURRENT list, preserving everything else.
 * A row that is already gone on the fresh read stays gone — nothing is
 * written back.
 */
export async function removeServerRow(sink: McpServersSink, serverId: string): Promise<void> {
  const current = await readCurrentServers(sink);
  if (!current.some((item) => item.id === serverId)) return;
  if (sink.rows) await sink.rows.remove(serverId); // ViscosityCode
  else await sink.saveServers(current.filter((item) => item.id !== serverId));
}

/**
 * Fresh read + confirmed save for the shared-settings Global source, wired by
 * the settings surfaces. Both operations wait for the owner settings to
 * hydrate first: an unhydrated read is empty-by-default (committing against it
 * would clobber the real configuration), and `flushSharedSettings` skips the
 * bridge write until hydration, so a commit before hydration could not be
 * confirmed. Reads always hit the live store — never a captured projection.
 */
export function sharedSettingsServerPersistence(): {
  loadServers: () => Promise<McpServer[]>;
  saveServers: (servers: McpServer[]) => Promise<void>;
} {
  return {
    loadServers: async () => {
      await whenSharedSettingsHydrated();
      return useSharedSettings.getState().mcpServers;
    },
    saveServers: async (servers) => {
      await whenSharedSettingsHydrated();
      useSharedSettings.getState().setMcpServers(servers);
      await flushSharedSettings();
    },
  };
}
