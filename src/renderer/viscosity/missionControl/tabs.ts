/**
 * ViscosityCode: Mission Control tab registry (contract).
 *
 * Mission Control is one overview screen with tabs ("Agents", "Subscriptions",
 * …). Features add tabs here so the Mission Control shell never imports them.
 */
import type { MessageDescriptor } from "@lingui/core";
import type { ComponentType } from "react";
import { create } from "zustand";

export interface MissionControlTab {
  id: string;
  label: MessageDescriptor;
  /** Lower first. "agents" uses 0, "subscriptions" uses 10. */
  order: number;
  component: ComponentType;
}

interface MissionControlTabsState {
  tabs: MissionControlTab[];
}

const useMissionControlTabsStore = create<MissionControlTabsState>()(() => ({ tabs: [] }));

/** Register (or replace by id) a tab. Returns an unregister function. */
export function registerMissionControlTab(tab: MissionControlTab): () => void {
  useMissionControlTabsStore.setState((state) => ({
    tabs: [...state.tabs.filter((t) => t.id !== tab.id), tab].sort((a, b) => a.order - b.order),
  }));
  return () =>
    useMissionControlTabsStore.setState((state) => ({
      tabs: state.tabs.filter((t) => t !== tab),
    }));
}

export function useMissionControlTabs(): MissionControlTab[] {
  return useMissionControlTabsStore((state) => state.tabs);
}
