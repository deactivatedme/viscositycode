// Modified for ViscosityCode (fork of Poracode). See FORK_CHANGES.md.
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  areAgentSlashCommandsEqual,
  areAgentPresentationRuntimeFieldsEqual,
  areAgentProviderMetadataEqual,
  type AgentStatus,
  type AgentStatusesResponse,
  type ProjectLocation,
} from "@/shared/contracts";
import type { AgentStatusSupervisorEvent } from "@/shared/ipc";
import { decodeAgentStatusCache } from "@/shared/agentStatusCache";

export type AgentDiscoveryScope =
  | { kind: "native" }
  | { kind: "wsl"; distro: string }
  | { kind: "all"; wslDistros: string[] };

interface AgentStatusesStore {
  agentStatuses: AgentStatus[];
  wslAgentStatuses: AgentStatus[];
  /**
   * True once a windows-agent-statuses event (or cache) has been applied.
   * Used by UI to distinguish "detecting…" from "detected nothing".
   */
  windowsLoaded: boolean;
  /** True once a wsl-agent-statuses event (or cache) has been applied. */
  wslLoaded: boolean;
  /** Session-only authority counters fence delayed partial RPC replies. */
  nativeRevision: number;
  wslRevision: number;
  /** Survives capability-cache invalidation so upgrades do not repeat onboarding. */
  hasCompletedDiscovery: boolean;
  setAgentStatuses: (statuses: AgentStatus[]) => void;
  setWslAgentStatuses: (statuses: AgentStatus[]) => void;
  /**
   * Hydrate both scopes at once from an RPC cache read.  Called before the
   * main UI mounts so ThreadDraft renders with the cached agents instead of
   * the empty initial state.
   */
  hydrateFromCache: (cached: { windows: AgentStatus[]; wsl: AgentStatus[] }) => void;
  /** Marks a newly requested WSL distro as loading until its bulk event arrives. */
  beginStartupDiscovery: (scope?: AgentDiscoveryScope) => void;
  /**
   * Upserts a single status into the store, matched by (kind, envKind,
   * envDistro). Used by scoped refreshes after install/login so we don't
   * overwrite the rest of the list. WSL statuses land in `wslAgentStatuses`;
   * everything else lands in `agentStatuses`.
   * Progressive observations pass markLoaded=false; only terminal events can
   * declare that the whole environment has finished loading.
   */
  mergeAgentStatus: (status: AgentStatus, markLoaded?: boolean) => void;
  removeAgentStatus: (kind: string) => void;
}

function hasCompletedDiscovery(state: Partial<AgentStatusesStore>): boolean {
  return (
    state.hasCompletedDiscovery === true ||
    state.windowsLoaded === true ||
    (state.agentStatuses?.length ?? 0) > 0
  );
}

function sameAgentStatusTarget(a: AgentStatus, b: AgentStatus): boolean {
  if (a.kind !== b.kind) return false;
  // Older native rows omit envKind; WSL keeps exact distro identity, including
  // legacy rows without a distro, rather than falling back to native identity.
  return a.envKind === "wsl" || b.envKind === "wsl"
    ? a.envKind === b.envKind && a.envDistro === b.envDistro
    : true;
}

function upsertAgentStatus(statuses: AgentStatus[], status: AgentStatus): AgentStatus[] {
  const index = statuses.findIndex((entry) => sameAgentStatusTarget(entry, status));
  if (index === -1) return [...statuses, status];
  return statuses[index] === status
    ? statuses
    : statuses.map((entry, i) => (i === index ? status : entry));
}

function capabilitiesEqual(
  a: AgentStatus["capabilities"],
  b: AgentStatus["capabilities"],
): boolean {
  if (
    JSON.stringify(a.presentationCapabilities ?? {}) !==
    JSON.stringify(b.presentationCapabilities ?? {})
  ) {
    return false;
  }
  if (a.models.length !== b.models.length) return false;
  if (a.efforts.length !== b.efforts.length) return false;
  for (let i = 0; i < a.models.length; i++) {
    const previous = a.models[i]!;
    const next = b.models[i]!;
    if (
      previous.id !== next.id ||
      previous.label !== next.label ||
      previous.description !== next.description ||
      previous.tooltipDescription !== next.tooltipDescription
    )
      return false;
  }
  for (let i = 0; i < a.efforts.length; i++) {
    if (a.efforts[i] !== b.efforts[i]) return false;
  }
  if ((a.defaultEffort ?? "") !== (b.defaultEffort ?? "")) return false;
  if (JSON.stringify(a.modelEfforts) !== JSON.stringify(b.modelEfforts)) return false;
  if (JSON.stringify(a.modelDefaultEfforts ?? {}) !== JSON.stringify(b.modelDefaultEfforts ?? {})) {
    return false;
  }
  if (JSON.stringify(a.thinkingModels ?? []) !== JSON.stringify(b.thinkingModels ?? [])) {
    return false;
  }
  if (
    JSON.stringify(a.workflowModels ?? []) !== JSON.stringify(b.workflowModels ?? []) ||
    a.workflowLabel !== b.workflowLabel
  ) {
    return false;
  }
  if (!areAgentSlashCommandsEqual(a.slashCommands, b.slashCommands)) return false;
  // Compared so a status persisted before `supportsOneShot` existed (flag
  // absent) is treated as different from a freshly-detected one (flag set) and
  // gets replaced — otherwise the one-shot AI selectors would keep hiding
  // one-shot-capable providers for the whole first post-upgrade session.
  if ((a.supportsOneShot ?? false) !== (b.supportsOneShot ?? false)) return false;
  if (
    (a.supportsReadOnlyOneShotWorkspace ?? false) !== (b.supportsReadOnlyOneShotWorkspace ?? false)
  )
    return false;
  if (
    (a.contextSizeChangeReloadsSession ?? false) !== (b.contextSizeChangeReloadsSession ?? false) ||
    (a.contextSizeReloadStopsSubagents ?? false) !== (b.contextSizeReloadStopsSubagents ?? false)
  ) {
    return false;
  }
  // Codex context-window lists are user-editable. A detection that only
  // changes those fields must replace the cached status or the composer keeps
  // the previous picker after settings save / next launch.
  if (JSON.stringify(a.contextSizes ?? []) !== JSON.stringify(b.contextSizes ?? [])) return false;
  if (JSON.stringify(a.modelContextSizes ?? {}) !== JSON.stringify(b.modelContextSizes ?? {})) {
    return false;
  }
  if ((a.defaultContextSize ?? "") !== (b.defaultContextSize ?? "")) return false;
  return true;
}

function statusesEqual(a: AgentStatus[], b: AgentStatus[]): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (x, i) =>
      x.kind === b[i]!.kind &&
      x.label === b[i]!.label &&
      x.installed === b[i]!.installed &&
      x.icon === b[i]!.icon &&
      x.version === b[i]!.version &&
      x.authState === b[i]!.authState &&
      x.acpSessionEstablished === b[i]!.acpSessionEstablished &&
      areAgentPresentationRuntimeFieldsEqual(x, b[i]!) &&
      x.loginCommand === b[i]!.loginCommand &&
      x.loginCommandDisplay === b[i]!.loginCommandDisplay &&
      x.envKind === b[i]!.envKind &&
      x.envDistro === b[i]!.envDistro &&
      JSON.stringify(x.authMethods ?? []) === JSON.stringify(b[i]!.authMethods ?? []) &&
      areAgentProviderMetadataEqual(x.providerMetadata, b[i]!.providerMetadata) &&
      capabilitiesEqual(x.capabilities, b[i]!.capabilities),
  );
}

function buildStatusUpdatePatch(
  prev: AgentStatusesStore,
  incoming: AgentStatus[],
  scope: "native" | "wsl",
): Partial<AgentStatusesStore> {
  const isWsl = scope === "wsl";
  const currentList = isWsl ? prev.wslAgentStatuses : prev.agentStatuses;
  const currentLoaded = isWsl ? prev.wslLoaded : prev.windowsLoaded;
  const equal = statusesEqual(currentList, incoming);
  const discoveryPatch: Partial<AgentStatusesStore> = {
    ...(isWsl
      ? { wslRevision: prev.wslRevision + 1 }
      : { nativeRevision: prev.nativeRevision + 1 }),
    ...(!isWsl && !prev.hasCompletedDiscovery ? { hasCompletedDiscovery: true } : {}),
  };
  if (equal && currentLoaded) {
    return discoveryPatch;
  }
  const listPatch: Partial<AgentStatusesStore> = equal
    ? {}
    : isWsl
      ? { wslAgentStatuses: incoming }
      : { agentStatuses: incoming };
  const loadedPatch: Partial<AgentStatusesStore> = isWsl
    ? { wslLoaded: true }
    : { windowsLoaded: true };
  return { ...listPatch, ...loadedPatch, ...discoveryPatch };
}

export const useAgentStatusesStore = create<AgentStatusesStore>()(
  persist(
    (set) => ({
      agentStatuses: [],
      wslAgentStatuses: [],
      windowsLoaded: false,
      wslLoaded: false,
      nativeRevision: 0,
      wslRevision: 0,
      hasCompletedDiscovery: false,
      setAgentStatuses: (incoming) =>
        set((prev) => buildStatusUpdatePatch(prev, incoming, "native")),
      setWslAgentStatuses: (incoming) =>
        set((prev) => buildStatusUpdatePatch(prev, incoming, "wsl")),
      hydrateFromCache: ({ windows, wsl }) =>
        set((prev) => ({
          agentStatuses: windows,
          wslAgentStatuses: wsl,
          windowsLoaded: true,
          wslLoaded: true,
          nativeRevision: prev.nativeRevision + 1,
          wslRevision: prev.wslRevision + 1,
          hasCompletedDiscovery: true,
        })),
      beginStartupDiscovery: (scope) => {
        // ViscosityCode: detection runs silently; a newly requested distro
        // still reads as loading until its wsl-agent-statuses event arrives.
        if (scope?.kind === "wsl") set((prev) => (prev.wslLoaded ? { wslLoaded: false } : prev));
      },
      mergeAgentStatus: (status, markLoaded = true) =>
        set((prev) => {
          const isWsl = status.envKind === "wsl";
          const next = upsertAgentStatus(
            isWsl ? prev.wslAgentStatuses : prev.agentStatuses,
            status,
          );
          return isWsl
            ? { wslAgentStatuses: next, wslLoaded: prev.wslLoaded || markLoaded }
            : { agentStatuses: next, windowsLoaded: prev.windowsLoaded || markLoaded };
        }),
      removeAgentStatus: (kind) =>
        set((prev) => {
          const agentStatuses = prev.agentStatuses.filter((status) => status.kind !== kind);
          const wslAgentStatuses = prev.wslAgentStatuses.filter((status) => status.kind !== kind);
          if (
            agentStatuses.length === prev.agentStatuses.length &&
            wslAgentStatuses.length === prev.wslAgentStatuses.length
          ) {
            return prev;
          }
          return { agentStatuses, wslAgentStatuses };
        }),
    }),
    {
      name: "poracode-agent-statuses-v1",
      version: 78, // ViscosityCode: v78 mirrors host v82 (Claude re-probe).
      // hasCompletedDiscovery is additive: old readers ignore it. Keep v67
      // inventories valid; infer the flag from older snapshots before clearing
      // outdated capabilities, independently of supervisor STATUS_CACHE_VERSION.
      // ViscosityCode: the session-only discovery-screen fields were removed;
      // partialize never persisted them, so the persisted format is unchanged.
      // v63-v78 mirror host generations v67-v82. Reuse their unchanged rows
      // through the host codec; only affected providers need new observations.
      migrate: (persisted, version) => {
        const prev = (persisted ?? {}) as Partial<AgentStatusesStore>;
        const hostVersions: Record<number, number> = {
          63: 67,
          64: 68,
          65: 69,
          66: 70,
          67: 71,
          68: 72,
          69: 73,
          70: 74,
          71: 75,
          72: 76,
          73: 77,
          74: 78,
          75: 79,
          76: 80,
          77: 81,
          78: 82, // ViscosityCode
        };
        const cached = decodeAgentStatusCache({
          version: hostVersions[version] ?? 1,
          windows: prev.agentStatuses ?? [],
          wsl: prev.wslAgentStatuses ?? [],
        }).statuses;
        return {
          ...prev,
          hasCompletedDiscovery: hasCompletedDiscovery(prev),
          agentStatuses: cached.windows,
          wslAgentStatuses: cached.wsl,
          windowsLoaded: false,
          wslLoaded: false,
        } as AgentStatusesStore;
      },
      // Synchronous localStorage hydration (unlike the IndexedDB-backed app
      // store) so the last-known statuses — and their already-cached provider
      // icons — are in the store on the very first paint, before the async
      // getAgentStatuses RPC resolves. The RPC still runs on launch and
      // overwrites this with fresh results via hydrateFromCache.
      storage: createJSONStorage(() => localStorage),
      merge: (persisted, current) => {
        const previous = (persisted ?? {}) as Partial<AgentStatusesStore>;
        return {
          ...current,
          ...previous,
          hasCompletedDiscovery: hasCompletedDiscovery(previous),
        };
      },
      // Persist resolved statuses, their loaded flags, and discovery history.
      partialize: (state) => ({
        agentStatuses: state.agentStatuses,
        wslAgentStatuses: state.wslAgentStatuses,
        windowsLoaded: state.windowsLoaded,
        wslLoaded: state.wslLoaded,
        hasCompletedDiscovery: state.hasCompletedDiscovery,
      }),
    },
  ),
);

/** Fill a partial RPC view without rolling back events received during its read. */
export function applyPartialAgentStatuses(
  response: AgentStatusesResponse,
  before: Pick<
    AgentStatusesStore,
    "agentStatuses" | "wslAgentStatuses" | "nativeRevision" | "wslRevision"
  >,
): void {
  for (const status of [...response.windows, ...response.wsl]) {
    const current = useAgentStatusesStore.getState();
    const isWsl = status.envKind === "wsl";
    if (
      isWsl
        ? current.wslRevision !== before.wslRevision
        : current.nativeRevision !== before.nativeRevision
    )
      continue;
    const matches = (entry: AgentStatus) => sameAgentStatusTarget(entry, status);
    const previous = (isWsl ? before.wslAgentStatuses : before.agentStatuses).find(matches);
    const existing = (isWsl ? current.wslAgentStatuses : current.agentStatuses).find(matches);
    if (existing === previous) current.mergeAgentStatus(status, false);
  }
}

/**
 * Fan a supervisor agent-status event into the store. Shared by every surface
 * that consumes the supervisor stream (main window, quick composer overlay) so
 * the event→action mapping lives in one place.
 */
export function applyAgentStatusSupervisorEvent(event: AgentStatusSupervisorEvent): void {
  const store = useAgentStatusesStore.getState();
  switch (event.type) {
    case "agent-detected":
      // Cold/invalidated caches also refresh in the background for returning
      // users. Publish each accepted row without waiting for the slowest probe
      // or falsely completing discovery before its terminal bulk event.
      store.mergeAgentStatus(event.status, false);
      break;
    case "agent-status-updated":
      store.mergeAgentStatus(event.status);
      break;
    case "windows-agent-statuses": {
      if (import.meta.env.DEV) performance.mark("poracode:native providers discovered");
      console.log(`[renderer] event: windows-agent-statuses (${event.statuses.length} agents)`);
      store.setAgentStatuses(event.statuses);
      break;
    }
    case "wsl-agent-statuses": {
      console.log(`[renderer] event: wsl-agent-statuses (${event.statuses.length} agents)`);
      store.setWslAgentStatuses(event.statuses);
      break;
    }
  }
}

/**
 * Returns true when we haven't received agent statuses yet for the given
 * project's environment.  Callers use this to distinguish "detecting…" from
 * "detected, but nothing installed" — the former shows a spinner, the latter
 * shows the install-agents prompt.
 */
export function isDetectingAgentsForLocation(
  state: { windowsLoaded: boolean; wslLoaded: boolean },
  location: ProjectLocation,
): boolean {
  return location.kind === "wsl" ? !state.wslLoaded : !state.windowsLoaded;
}
