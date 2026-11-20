/**
 * ViscosityCode: "N tools running" status bar item. Reads the count
 * the agent-activity monitor publishes, so it re-renders only when the number
 * changes. Hidden at zero.
 */
import { useSyncExternalStore } from "react";
import { plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { LoaderCircle } from "lucide-react";
import { registerStatusBarItem } from "@/renderer/viscosity/layout/statusBar/statusBarRegistry";
import { getToolsRunningCount, subscribeToolsRunning } from "./toolsRunningStore";

export const TOOLS_RUNNING_STATUS_ITEM_ID = "agents.tools";

/** Sits right after "agents working" (200) and before "waiting for you" (210). */
const TOOLS_RUNNING_ORDER = 205;

// Matches the built-in status bar items' class list.
const ITEM_CLASS = "vc-statusbar__item h-full min-w-0 shrink-0 gap-1 rounded-none px-2 font-normal";

export function ToolsRunningStatusItem() {
  const { t } = useLingui();
  const count = useSyncExternalStore(
    subscribeToolsRunning,
    getToolsRunningCount,
    getToolsRunningCount,
  );
  if (count === 0) return null;
  const label = t`${plural(count, { one: "# tool running", other: "# tools running" })}`;
  return (
    <span
      title={label}
      data-vc-status-item={TOOLS_RUNNING_STATUS_ITEM_ID}
      data-tone="tool"
      className={`${ITEM_CLASS} inline-flex items-center`}
    >
      <LoaderCircle aria-hidden="true" className="vc-fx-spin size-3 shrink-0" />
      <span aria-hidden="true" className="tabular-nums">
        {count}
      </span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** Returns the unregister. */
export function registerToolsRunningStatusItem(): () => void {
  return registerStatusBarItem({
    id: TOOLS_RUNNING_STATUS_ITEM_ID,
    align: "left",
    order: TOOLS_RUNNING_ORDER,
    component: ToolsRunningStatusItem,
  });
}
