/**
 * ViscosityCode: how to turn on cloud agents, per provider (contract).
 *
 * The Cloud tab names no provider. A provider that can run agents in the
 * cloud registers a short hint here from its own folder, pointing at its real
 * settings; the tab shows every registered hint while no source exists.
 */
import type { ComponentType } from "react";
import { create } from "zustand";

export interface CloudAgentSetupHint {
  /** The provider's kind; registering the same id again replaces the hint. */
  id: string;
  /** Renders the hint. `openAgentSettings` opens Settings → Agents on one agent's page. */
  Hint: ComponentType<{ openAgentSettings: (agentKind: string) => void }>;
}

const useHintsStore = create<{ hints: CloudAgentSetupHint[] }>()(() => ({ hints: [] }));

export function registerCloudAgentSetupHint(hint: CloudAgentSetupHint): () => void {
  useHintsStore.setState((state) => ({
    hints: [...state.hints.filter((entry) => entry.id !== hint.id), hint],
  }));
  return () =>
    useHintsStore.setState((state) => ({ hints: state.hints.filter((entry) => entry !== hint) }));
}

export function useCloudAgentSetupHints(): CloudAgentSetupHint[] {
  return useHintsStore((state) => state.hints);
}
