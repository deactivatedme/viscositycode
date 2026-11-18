/**
 * ViscosityCode: DEV-only inspection hook for the agent-state effects.
 *
 *   window.__viscosityFx.agentState.snapshot()
 *   window.__viscosityFx.agentState.simulate(threadId, "tool")
 *   window.__viscosityFx.agentState.simulate(threadId, "idle", { flash: "done" })
 *   window.__viscosityFx.agentState.simulate(threadId, null) // clear
 *
 * `simulate` only overrides what the DOM shows (for screenshots); it never
 * writes to the app store. The namespace object is shared with the other fx
 * hooks, so only the `agentState` key is set and removed here.
 */
import type { FxAgentState } from "./derive";
import type { AgentStateSnapshotEntry, SimulateOptions } from "./monitor";

export interface AgentStateDevHook {
  snapshot(): AgentStateSnapshotEntry[];
  simulate(threadId: string, state: FxAgentState | null, options?: SimulateOptions): void;
}

type FxDevNamespace = Record<string, unknown>;

export function installAgentStateDevHook(hook: AgentStateDevHook, target?: object): () => void {
  if (!import.meta.env.DEV) return () => {};
  const host = (target ?? (typeof window === "undefined" ? undefined : window)) as
    | { __viscosityFx?: FxDevNamespace }
    | undefined;
  if (!host) return () => {};
  const namespace: FxDevNamespace = host.__viscosityFx ?? {};
  host.__viscosityFx = namespace;
  namespace.agentState = hook;
  return () => {
    if (namespace.agentState === hook) delete namespace.agentState;
  };
}
