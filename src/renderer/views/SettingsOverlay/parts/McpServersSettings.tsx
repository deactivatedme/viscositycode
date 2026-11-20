// Modified for ViscosityCode (fork of Poracode). See FORK_CHANGES.md.
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type Dispatch,
  type SetStateAction,
} from "react";
import { toast } from "@heroui/react";
import { useLingui } from "@lingui/react/macro";
import type { BuiltInMcpServerId, McpProbeResult, McpServer } from "@/shared/contracts";
import { McpProjectSettingsPicker } from "@/renderer/components/mcp/McpProjectSettingsPicker";
import { McpServersManager } from "@/renderer/components/mcp/McpServersManager";
import { sharedSettingsServerPersistence } from "@/renderer/components/mcp/mcpServersMutation";
import { useLocalizedPluginCatalog } from "@/renderer/components/plugins/pluginCopy";
import { resolveProjectIdForView } from "@/renderer/actions/currentProject";
import { openProjectSettings } from "@/renderer/actions/panelActions";
import { saveProjectMcpServers } from "@/renderer/actions/projectActions";
import { useAppStore } from "@/renderer/state/appStore";
import { useReachableProjectFilter } from "@/renderer/state/remoteServers/reachability";
import { loadAuthoritativeProjectMcpServers } from "@/renderer/state/projectSettings/projectSettingsLoader";
import { useResidentProjectMcpServers } from "@/renderer/state/projectSettings/useResidentProjectMcpServers";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { usePanelStore } from "@/renderer/state/panelStore";
import { isHomeProject } from "@/shared/homeScope";
import { Button } from "@/renderer/components/common/Button";
import { SettingRow, SettingsPage } from "./SettingsForm";
import { CrossagentRoutingSection } from "./CrossagentRoutingSection";
// ViscosityCode: the host-owned Global list in remote sessions.
import { isRemoteSession, readBridge } from "@/renderer/bridge";
import {
  getRemoteBridgeClient,
  subscribeRemoteBridgeClient,
} from "@/renderer/browser/remoteBridge";
import type { McpServerSourceOperations } from "@/renderer/components/mcp/McpServersManager";
import type { McpServerRowCommands } from "@/renderer/components/mcp/mcpServersMutation";
import type { McpServerProbeState } from "@/renderer/components/mcp/useMcpServerProbes";
import { remoteOwner } from "@/renderer/state/remoteProjection";
import { remoteConnectionKey } from "@/renderer/state/remoteServers/types";
import { useSettingsHostServer } from "@/renderer/state/settingsHostStore";
import { isBrowserClientRuntime } from "@/renderer/clientRuntime";
import { isLocalDesktopHost } from "@/renderer/viscosity/localDesktopWindow";
import type { RemoteDesktopClient } from "@/shared/remote/client";
import { RemoteClientError } from "@/shared/remote/clientErrors";
import type {
  RemoteMcpSettingsCommand,
  RemoteMcpSettingsScope,
} from "@/shared/remote/contract/routeSchemas";
import { friendlyError } from "@/shared/messages";

export function McpServersSettings() {
  const { t } = useLingui();
  const servers = useSharedSettings((state) => state.mcpServers);
  // ViscosityCode: mcpServers is not a remote settings key, so a remote session
  // edits its host's list through the MCP settings routes, never this device's copy.
  const remoteSession = isRemoteSession();
  const hostGlobal = useHostGlobalMcpServers(remoteSession);
  const userSource = remoteSession
    ? (hostGlobal.source ?? {
        // No host client yet: workspace servers and built-ins stay usable; Global writes refuse.
        servers: NO_SERVERS,
        saveServers: () =>
          Promise.reject(new Error(t`Connect to the host to change its MCP servers.`)),
      })
    : {
        servers,
        // The Global list reads and commits against the hydrated
        // shared-settings store with an awaitable bridge flush — never
        // against the render-time projection, and never before the
        // owner settings have hydrated.
        ...sharedSettingsServerPersistence(),
      };
  const disabledBuiltIns = useSharedSettings((state) => state.disabledBuiltInMcpServers);
  const disabledBuiltInTools = useSharedSettings((state) => state.disabledBuiltInMcpTools);
  const setBuiltInDisabled = useSharedSettings((state) => state.setBuiltInMcpServerDisabled);
  const setBuiltInToolEnabled = useSharedSettings((state) => state.setBuiltInMcpToolEnabled);
  const workspaceProject = useAppStore((state) => {
    const projectId = resolveProjectIdForView(state.view, state.threads, state.focusedPaneId);
    const project = state.projects.find((item) => item.id === projectId);
    return isHomeProject(project) ? undefined : project;
  });
  const projects = useAppStore((state) => state.projects);
  // Catalog rows don't carry private MCP settings; open this page's workspace
  // section with them resident instead of reading "not loaded" as empty.
  useResidentProjectMcpServers(workspaceProject);
  const isReachable = useReachableProjectFilter();
  const importProjects = projects
    .filter((project) => !isHomeProject(project) && isReachable(project))
    .map((project) => ({
      id: project.id,
      name: project.name,
      location: project.location,
      ...(project.icon ? { icon: project.icon } : {}),
      servers: project.mcpServers ?? [],
      // Import targets commit against the authoritative list, never against a
      // not-yet-loaded projection. `saveServers` gives commit paths (import,
      // move) an awaitable save so a destination refusal can stop before the
      // source copy is deleted.
      loadServers: () => loadAuthoritativeProjectMcpServers(project.id),
      saveServers: (next: McpServer[]) => saveProjectMcpServers(project.id, next),
    }));
  const plugins = useLocalizedPluginCatalog(workspaceProject?.location);
  const managedBuiltIns = plugins.reduce<Partial<Record<BuiltInMcpServerId, string>>>(
    (acc, entry) => {
      for (const id of entry.plugin.poracode.builtInMcpServerIds) {
        acc[id] = entry.name;
      }
      return acc;
    },
    {},
  );

  return (
    <SettingsPage
      title={t`MCP Servers`}
      description={t`Manage the MCP server configurations Poracode adds when starting supported agents. Workspace servers can be configured in each project's settings.`}
      bodyClassName="space-y-5"
    >
      <SettingRow
        anchorId="mcpServers.projects"
        title={t`Project MCP servers`}
        description={t`Servers in a project's settings apply only to that project and override global servers with the same name. To move a global server, edit it and change its scope.`}
      >
        <McpProjectSettingsPicker
          projects={importProjects}
          onOpen={(projectId) => {
            usePanelStore.getState().closeSettings();
            openProjectSettings(projectId, "mcp");
          }}
        />
      </SettingRow>
      <div data-settings-anchor="mcpServers.manage">
        {hostGlobal.error !== undefined ? (
          <p
            role="status"
            className="mb-3 rounded-xl border border-dashed border-[var(--hairline-strong)] px-4 py-3 text-sm text-muted"
          >
            {isOlderHost(hostGlobal.error)
              ? t`This host can't edit MCP servers from here. Update ViscosityCode on the host.`
              : friendlyError(hostGlobal.error)}
          </p>
        ) : null}
        <McpServersManager
          key={workspaceProject?.id ?? "user-only"}
          sources={{
            user: userSource,
            ...(workspaceProject
              ? {
                  workspace: {
                    servers: workspaceProject.mcpServers ?? [],
                    projectId: workspaceProject.id,
                    projectLocation: workspaceProject.location,
                    projectName: workspaceProject.name,
                    ...(workspaceProject.icon ? { projectIcon: workspaceProject.icon } : {}),
                    loadServers: () => loadAuthoritativeProjectMcpServers(workspaceProject.id),
                    saveServers: (nextServers) =>
                      saveProjectMcpServers(workspaceProject.id, nextServers),
                  },
                }
              : {}),
          }}
          importProjects={importProjects}
          defaultScope="user"
          disabledBuiltIns={disabledBuiltIns}
          // ViscosityCode: disabledBuiltInMcpTools is not on the remote settings wire.
          {...(remoteSession
            ? {}
            : { disabledBuiltInTools, onBuiltInToolEnabledChange: setBuiltInToolEnabled })}
          onBuiltInDisabledChange={setBuiltInDisabled}
          managedBuiltIns={managedBuiltIns}
          builtInSettings={{
            crossagents: {
              title: t`Crossagents`,
              actionLabel: t`Crossagent routing and ranking`,
              content: (
                <div className="space-y-3">
                  <CrossagentRoutingSection />
                  <Button
                    size="sm"
                    variant="ghost"
                    onPress={() => usePanelStore.getState().openSettingsSection("crews")}
                  >
                    {t`Crews`}
                  </Button>
                </div>
              ),
              dialogClassName: "sm:max-w-2xl",
            },
          }}
        />
      </div>
    </SettingsPage>
  );
}

const HOST_GLOBAL: RemoteMcpSettingsScope = { kind: "global" };
const NO_SERVERS: McpServer[] = [];
const NO_URLS: ReadonlySet<string> = new Set();

/** A host older than the MCP settings routes answers them as an unknown endpoint. */
function isOlderHost(error: unknown): boolean {
  return error instanceof RemoteClientError && error.status === 404 && error.code === "not_found";
}

function hostProbeState(result: McpProbeResult): McpServerProbeState {
  if (result.status === "available") {
    return { status: "connected", toolCount: result.toolCount, tools: result.tools ?? [] };
  }
  if (result.status === "auth-required") return { status: "auth-required" };
  return {
    status: "unavailable",
    errorCode: result.error.code === "auth-required" ? "connection-failed" : result.error.code,
  };
}

function probeHostServer(
  client: RemoteDesktopClient,
  server: McpServer,
  sequences: Map<string, number>,
  setStates: Dispatch<SetStateAction<Record<string, McpServerProbeState>>>,
): void {
  // Only the latest probe of a server may settle its state.
  const sequence = (sequences.get(server.id) ?? 0) + 1;
  sequences.set(server.id, sequence);
  const settle = (state: McpServerProbeState) => {
    if (sequences.get(server.id) === sequence) {
      setStates((current) => ({ ...current, [server.id]: state }));
    }
  };
  if (!server.enabled) {
    settle({ status: "disabled" });
    return;
  }
  settle({ status: "checking" });
  void client.mcpSettingsOperation({ kind: "probe", scope: HOST_GLOBAL, serverId: server.id }).then(
    ({ result }) => settle(hostProbeState(result)),
    () => settle({ status: "unavailable", errorCode: "probe-unavailable" }),
  );
}

async function readHostOauth(
  client: RemoteDesktopClient,
  setIds: (ids: ReadonlySet<string>) => void,
): Promise<void> {
  try {
    const status = await client.mcpSettingsOperation({ kind: "oauth-status", scope: HOST_GLOBAL });
    setIds(new Set(status.authenticatedServerIds));
  } catch {
    // Status is presentational only; keep the previous snapshot.
  }
}

/**
 * The session host's Global servers, read redacted and written one row at a
 * time; probe and OAuth run on the host by server id. `source` is undefined
 * without a host client and lists nothing until the first read lands; `error`
 * holds a failed read (writes still go to the host, which answers for itself).
 */
function useHostGlobalMcpServers(enabled: boolean): {
  source?: {
    servers: McpServer[];
    loadServers: () => Promise<McpServer[]>;
    saveServers: (servers: McpServer[]) => Promise<void>;
    rows: McpServerRowCommands;
    operations: McpServerSourceOperations;
  };
  error?: unknown;
} {
  const { t } = useLingui();
  const client = useSyncExternalStore(subscribeRemoteBridgeClient, getRemoteBridgeClient);
  // The host the bridge client talks to: its projects take moves, its machine finishes OAuth.
  const host = useSettingsHostServer();
  const hostKey = host ? remoteConnectionKey(host) : undefined;
  const [loaded, setLoaded] = useState<{
    client: RemoteDesktopClient;
    servers?: McpServer[];
    error?: unknown;
  }>();
  const [probeStates, setProbeStates] = useState<Record<string, McpServerProbeState>>({});
  const [authenticatedServerIds, setAuthenticatedServerIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [busyServerIds, setBusyServerIds] = useState<ReadonlySet<string>>(new Set());
  const probed = useRef(new Map<string, string>());
  const probeSequences = useRef(new Map<string, number>());
  const current = enabled && client && loaded?.client === client ? loaded : undefined;
  const servers = current?.servers;

  useEffect(() => {
    if (!enabled || !client) return;
    let live = true;
    // A write that answered before this read already holds the newer list.
    const settle = (next: {
      client: RemoteDesktopClient;
      servers?: McpServer[];
      error?: unknown;
    }) =>
      setLoaded((previous) => (previous?.client === client && previous.servers ? previous : next));
    void client.mcpSettings().then(
      (next) => {
        if (live) settle({ client, servers: next });
      },
      (error: unknown) => {
        if (live) settle({ client, error });
      },
    );
    void readHostOauth(client, setAuthenticatedServerIds);
    return () => {
      live = false;
    };
  }, [client, enabled]);

  // Probe each server again whenever the host's definition of it changes.
  useEffect(() => {
    if (!client || !servers) return;
    for (const server of servers) {
      const fingerprint = JSON.stringify(server);
      if (probed.current.get(server.id) === fingerprint) continue;
      probed.current.set(server.id, fingerprint);
      probeHostServer(client, server, probeSequences.current, setProbeStates);
    }
  }, [client, servers]);

  if (!enabled || !client) return {};

  const apply = (next: McpServer[]) => {
    setLoaded({ client, servers: next });
    return next;
  };
  const run = async (command: RemoteMcpSettingsCommand) => {
    apply(await client.mcpSettingsCommand(command));
  };
  const setBusy = (serverId: string, busy: boolean) =>
    setBusyServerIds((ids) => {
      const next = new Set(ids);
      if (busy) next.add(serverId);
      else next.delete(serverId);
      return next;
    });

  const authenticate = async (server: McpServer): Promise<boolean> => {
    const serverName = server.name;
    // The host's OAuth redirect is its own loopback, so a browser finishes it only on that machine.
    if (isBrowserClientRuntime() && !isLocalDesktopHost(hostKey)) {
      toast.danger(t`Sign in to ${serverName} from the app on the host machine.`);
      return false;
    }
    setBusy(server.id, true);
    try {
      const { result: begin } = await client.mcpSettingsOperation({
        kind: "oauth-begin",
        scope: HOST_GLOBAL,
        serverId: server.id,
      });
      if (begin.status === "error") {
        const message = begin.message;
        toast.danger(t`Could not sign in to ${serverName}: ${message}`);
        return false;
      }
      if (begin.status === "redirect") {
        await readBridge().openExternalNative(begin.authorizationUrl);
        const { result } = await client.mcpSettingsOperation({
          kind: "oauth-wait",
          scope: HOST_GLOBAL,
          flowId: begin.flowId,
        });
        if (result.status === "error") {
          const message = result.message;
          toast.danger(t`Could not sign in to ${serverName}: ${message}`);
          return false;
        }
      }
      toast.success(t`Signed in to ${serverName}.`);
      await readHostOauth(client, setAuthenticatedServerIds);
      return true;
    } catch {
      toast.danger(t`Could not sign in to ${serverName}.`);
      return false;
    } finally {
      setBusy(server.id, false);
    }
  };

  const signOut = async (server: McpServer): Promise<void> => {
    const serverName = server.name;
    setBusy(server.id, true);
    try {
      await client.mcpSettingsOperation({
        kind: "oauth-clear",
        scope: HOST_GLOBAL,
        serverId: server.id,
      });
      toast.success(t`Signed out of ${serverName}.`);
      await readHostOauth(client, setAuthenticatedServerIds);
    } catch {
      toast.danger(t`Could not sign out of ${serverName}.`);
    } finally {
      setBusy(server.id, false);
    }
  };

  return {
    ...(current?.error !== undefined ? { error: current.error } : {}),
    source: {
      servers: servers ?? NO_SERVERS,
      loadServers: async () => apply(await client.mcpSettings()),
      // Unreachable: `rows` takes every write, and the list must never go back.
      saveServers: () =>
        Promise.reject(new Error("Global MCP servers are saved one row at a time.")),
      rows: {
        upsert: (server) => run({ kind: "upsert", scope: HOST_GLOBAL, server }),
        remove: (serverId) => run({ kind: "remove", scope: HOST_GLOBAL, serverId }),
        move: async (server, projectId, toProject) => {
          // Only a project this host owns can take its original; the host knows it by its own id.
          const project = useAppStore.getState().projects.find((item) => item.id === projectId);
          const owner = remoteOwner(project);
          if (!owner || owner.desktopId !== hostKey) return false;
          const projectScope: RemoteMcpSettingsScope = {
            kind: "project",
            projectId: owner.remoteId,
          };
          // Edits land in Global (before or after the move), where the host restores masks.
          if (toProject) await run({ kind: "upsert", scope: HOST_GLOBAL, server });
          await run({
            kind: "move",
            source: toProject ? HOST_GLOBAL : projectScope,
            destination: toProject ? projectScope : HOST_GLOBAL,
            serverId: server.id,
          });
          if (!toProject) await run({ kind: "upsert", scope: HOST_GLOBAL, server });
          return true;
        },
      },
      operations: {
        probes: {
          states: probeStates,
          probe: (server) =>
            probeHostServer(client, server, probeSequences.current, setProbeStates),
        },
        oauth: {
          authenticatedUrls: NO_URLS,
          authenticatedServerIds,
          busyServerIds,
          authenticate,
          signOut,
        },
      },
    },
  };
}
