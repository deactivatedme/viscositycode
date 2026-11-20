// Modified for ViscosityCode (fork of Poracode). See FORK_CHANGES.md.
import { create } from "zustand";
import type { UsageSnapshot } from "@/shared/contracts";

export interface HostUsageState {
  snapshots: readonly UsageSnapshot[];
  pending: boolean;
  failed: boolean;
  initialized: boolean;
  /** Volatile request time shared by all views to coalesce background reads. */
  lastRequestedAt: number;
  /** Publication token of the last successful cache read; never persisted. */
  lastReadRequest: number;
  refreshing: boolean;
  // ViscosityCode: a card's refresh spins only that card.
  /** Providers the in-flight refresh collects; empty while it covers the whole host. */
  refreshingProviders: readonly string[];
  updateRequired: boolean;
}
interface HostUsageEntry extends HostUsageState {
  /** Monotonic publication token; never reset or persisted. */
  request: number;
}
const EMPTY_HOST_USAGE: HostUsageEntry = {
  snapshots: [],
  pending: false,
  failed: false,
  request: 0,
  initialized: false,
  lastRequestedAt: 0,
  lastReadRequest: 0,
  refreshing: false,
  refreshingProviders: [],
  updateRequired: false,
};
let nextRequest = 0;

function entryFor(hosts: Record<string, HostUsageEntry>, connectionId: string): HostUsageEntry {
  return Object.hasOwn(hosts, connectionId) ? hosts[connectionId]! : EMPTY_HOST_USAGE;
}

/** Volatile, connection-scoped data. Provider/profile IDs are meaningful only on their host. */
export const useHostUsageStore = create<{
  hosts: Record<string, HostUsageEntry>;
  /** `providerIds` scopes a refresh to those providers; omit it for the whole host. */
  begin(connectionId: string, refresh?: boolean, providerIds?: readonly string[]): number;
  complete(
    connectionId: string,
    request: number,
    snapshots: readonly UsageSnapshot[],
    partial?: boolean,
    providerIds?: readonly string[],
  ): void;
  fail(
    connectionId: string,
    request: number,
    updateRequired?: boolean,
    providerIds?: readonly string[],
  ): void;
  invalidate(connectionId: string): void;
  remove(connectionId: string): void;
}>()((set, get) => ({
  hosts: {},
  begin: (connectionId, refresh = false, providerIds = []) => {
    const { refreshingProviders, request: current } = entryFor(get().hosts, connectionId);
    // Single-provider refreshes run side by side under one token so each publishes
    // its own result; any other request takes a new token and supersedes them.
    const joins = providerIds.length > 0 && refreshingProviders.length > 0;
    const request = joins ? current : ++nextRequest;
    set((state) => ({
      hosts: {
        ...state.hosts,
        [connectionId]: {
          ...entryFor(state.hosts, connectionId),
          pending: true,
          refreshing: refresh,
          refreshingProviders: joins ? [...refreshingProviders, ...providerIds] : providerIds,
          lastRequestedAt: Date.now(),
          request,
        },
      },
    }));
    return request;
  },
  complete: (connectionId, request, snapshots, partial = false, providerIds = []) =>
    set((state) => {
      const existing = entryFor(state.hosts, connectionId);
      if (existing.request !== request) return state;
      // Single-provider refreshes that have not reported back yet keep the host busy.
      const refreshingProviders = existing.refreshingProviders.filter(
        (id) => !providerIds.includes(id),
      );
      const merged = partial
        ? [
            ...new Map([
              ...existing.snapshots.map((snapshot) => [snapshot.providerId, snapshot] as const),
              ...snapshots.map((snapshot) => [snapshot.providerId, snapshot] as const),
            ]).values(),
          ]
        : snapshots;
      return {
        hosts: {
          ...state.hosts,
          [connectionId]: {
            snapshots: merged,
            pending: refreshingProviders.length > 0,
            refreshing: refreshingProviders.length > 0,
            refreshingProviders,
            initialized: true,
            lastRequestedAt: existing.lastRequestedAt,
            lastReadRequest: existing.refreshing ? existing.lastReadRequest : request,
            failed: false,
            updateRequired: existing.refreshing ? false : existing.updateRequired,
            request,
          },
        },
      };
    }),
  fail: (connectionId, request, updateRequired = false, providerIds = []) =>
    set((state) => {
      const existing = entryFor(state.hosts, connectionId);
      if (existing.request !== request) return state;
      // Single-provider refreshes that have not reported back yet keep the host busy.
      const refreshingProviders = existing.refreshingProviders.filter(
        (id) => !providerIds.includes(id),
      );
      return {
        hosts: {
          ...state.hosts,
          [connectionId]: {
            ...existing,
            pending: refreshingProviders.length > 0,
            refreshing: refreshingProviders.length > 0,
            refreshingProviders,
            initialized: true,
            failed: true,
            updateRequired,
          },
        },
      };
    }),
  invalidate: (connectionId) =>
    set((state) =>
      Object.hasOwn(state.hosts, connectionId)
        ? {
            hosts: {
              ...state.hosts,
              [connectionId]: {
                ...entryFor(state.hosts, connectionId),
                pending: false,
                refreshing: false,
                refreshingProviders: [],
                request: ++nextRequest,
              },
            },
          }
        : state,
    ),
  remove: (connectionId) =>
    set((state) => {
      const hosts = { ...state.hosts };
      delete hosts[connectionId];
      return { hosts };
    }),
}));

export function useHostUsage(connectionId: string): HostUsageState {
  return useHostUsageStore((state) => entryFor(state.hosts, connectionId));
}

/** A refresh of the whole host is in flight, not just of single providers. */
export function isWholeHostRefreshing(usage: HostUsageState): boolean {
  return usage.refreshing && usage.refreshingProviders.length === 0;
}

/** This provider is being collected, by its own refresh or a whole-host one. */
export function isHostProviderRefreshing(usage: HostUsageState, providerId: string): boolean {
  return (
    usage.refreshing &&
    (usage.refreshingProviders.length === 0 || usage.refreshingProviders.includes(providerId))
  );
}
