/**
 * ViscosityCode: agent-state effects (Step 4). `AgentStateEffects` is mounted
 * once by `FxRoot`; it installs a read-only store subscription outside React
 * and drives data attributes / CSS variables on panes, tabs and the composer.
 * It renders nothing and never re-renders on agent activity.
 */
import { useEffect } from "react";
import { setFxEnergy } from "@/renderer/fx/energyBus";
import { useFxSettings } from "@/renderer/fx/fxSettingsStore";
import { useAppStore } from "@/renderer/state/appStore";
import { useOpenTabsStore } from "@/renderer/viscosity/layout/tabs/openTabsStore";
import { installAgentStateDevHook } from "./devHook";
import { createAgentStateMonitor } from "./monitor";
import { registerToolsRunningStatusItem } from "./ToolsRunningStatusItem";
import { setToolsRunningCount } from "./toolsRunningStore";

export type { FxAgentState, FxFlash } from "./derive";

/** Start the monitor, the status bar item and the DEV hook; returns the teardown. */
export function startAgentStateEffects(doc: Document = document): () => void {
  const monitor = createAgentStateMonitor({
    document: doc,
    store: {
      getState: () => useAppStore.getState(),
      subscribe: (listener) => useAppStore.subscribe(listener),
    },
    tabs: {
      getIds: () => useOpenTabsStore.getState().ids,
      subscribe: (listener) =>
        useOpenTabsStore.subscribe((state, previous) => {
          if (state.ids !== previous.ids) listener();
        }),
    },
    effects: {
      get: () => useFxSettings.getState().effects,
      subscribe: (listener) =>
        useFxSettings.subscribe((state, previous) => {
          if (state.effects !== previous.effects) listener();
        }),
    },
    setEnergy: setFxEnergy,
    setToolsRunning: setToolsRunningCount,
  });
  monitor.start();
  const unregisterStatusItem = registerToolsRunningStatusItem();
  const uninstallDevHook = installAgentStateDevHook({
    snapshot: () => monitor.snapshot(),
    simulate: (threadId, state, options) => monitor.simulate(threadId, state, options),
  });
  return () => {
    uninstallDevHook();
    unregisterStatusItem();
    monitor.stop();
  };
}

export function AgentStateEffects(): null {
  useEffect(() => startAgentStateEffects(), []);
  return null;
}
