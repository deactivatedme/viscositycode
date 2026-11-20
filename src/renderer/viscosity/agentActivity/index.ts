/**
 * ViscosityCode: agent activity in the desktop shell. Started once by
 * ViscosityShellRuntime: the "N tools running" status bar item and the
 * read-only monitor that feeds it. Renders nothing and never re-renders on
 * agent activity.
 */
import { useAppStore } from "@/renderer/state/appStore";
import { startToolsRunningMonitor } from "./monitor";
import { registerToolsRunningStatusItem } from "./ToolsRunningStatusItem";
import { setToolsRunningCount } from "./toolsRunningStore";

/** Start the monitor and the status bar item; returns the teardown. */
export function startAgentActivity(): () => void {
  const stopMonitor = startToolsRunningMonitor(
    {
      getState: () => useAppStore.getState(),
      subscribe: (listener) => useAppStore.subscribe(listener),
    },
    setToolsRunningCount,
  );
  const unregisterStatusItem = registerToolsRunningStatusItem();
  return () => {
    unregisterStatusItem();
    stopMonitor();
  };
}
