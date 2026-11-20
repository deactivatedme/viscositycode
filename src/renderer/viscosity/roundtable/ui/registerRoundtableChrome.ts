/**
 * ViscosityCode Roundtable UI: the activity bar item (sidebar list view) and
 * the status bar item. Both registries only render inside the desktop shell,
 * and the activity item additionally hides itself outside it. Also registers
 * the "Ask all models…" palette command (additive, AA compare).
 */
import { msg } from "@lingui/core/macro";
import { lazy } from "react";
import { UsersRound } from "lucide-react";
import { registerActivityBarItem } from "@/renderer/viscosity/layout/activityBar/activityBarRegistry";
import { registerStatusBarItem } from "@/renderer/viscosity/layout/statusBar/statusBarRegistry";
import { useViscosityShellEnabled } from "@/renderer/viscosity/layout/tabs/shellGate";
import { useRoundtableStore } from "../roundtableStore";
import { registerCompareCommands } from "./compareCommands";
import { isChatIdle } from "./patterns";
import { ROUNDTABLE_STATUS_ITEM_ID, RoundtableStatusItem } from "./RoundtableStatusItem";

export const ROUNDTABLE_ACTIVITY_ITEM_ID = "roundtable";

const loadSidebarView = () =>
  import("./RoundtableSidebarView").then((module) => ({ default: module.RoundtableSidebarView }));

const RoundtableSidebarView = lazy(loadSidebarView);

function preloadSidebarView(): void {
  void loadSidebarView();
}

/** Running sessions, as the activity bar badge; a team chat waiting for the user is not running. */
function useRunningRoundtableCount(): number | null {
  const running = useRoundtableStore(
    (state) =>
      Object.values(state.sessions).filter(
        (session) => session.status === "running" && !isChatIdle(session),
      ).length,
  );
  return running > 0 ? running : null;
}

let registered = false;

/** Idempotent: registers the Roundtable chrome once per renderer. */
export function registerRoundtableChrome(): void {
  if (registered) return;
  registered = true;
  registerActivityBarItem({
    id: ROUNDTABLE_ACTIVITY_ITEM_ID,
    label: msg`Roundtable`,
    icon: UsersRound,
    // After Agents (100) and Mission Control (110), before Explorer (200).
    order: 160,
    view: RoundtableSidebarView,
    onPreload: preloadSidebarView,
    useBadge: useRunningRoundtableCount,
    useIsAvailable: useViscosityShellEnabled,
  });
  registerStatusBarItem({
    id: ROUNDTABLE_STATUS_ITEM_ID,
    align: "left",
    // After the agent counters (200-220).
    order: 300,
    component: RoundtableStatusItem,
  });
  registerCompareCommands();
}
