/**
 * ViscosityCode Mission Control: registers its chrome once per renderer (fork
 * of Poracode) — the built-in "Agents" tab, the activity bar item (toggles
 * the panel; badge = how many need you), the "N need you" status bar item and
 * the "Open Mission Control" palette command. The activity and status bars
 * only render in the desktop shell, and the activity item also hides itself
 * outside it.
 */
import { msg } from "@lingui/core/macro";
import { Radar } from "lucide-react";
import { registerViscosityCommands } from "@/renderer/viscosity/commands/viscosityCommands";
import { registerActivityBarItem } from "@/renderer/viscosity/layout/activityBar/activityBarRegistry";
import { registerStatusBarItem } from "@/renderer/viscosity/layout/statusBar/statusBarRegistry";
import { useViscosityShellEnabled } from "@/renderer/viscosity/layout/tabs/shellGate";
import {
  MISSION_AGENTS_TAB_ID,
  selectMissionControlShown,
  toggleMissionControl,
  useMissionControlViewStore,
} from "./missionControlViewStore";
import { useNeedsYouCount } from "./missionSources";
import { missionControlCommands } from "./paletteCommands";
import { registerMissionControlTab } from "./tabs";
import { AgentsTabEntry } from "./ui/AgentsTabEntry";
import { preloadMissionControlPanel } from "./ui/MissionControlHost";
import {
  MISSION_CONTROL_STATUS_ITEM_ID,
  MissionControlStatusItem,
} from "./ui/MissionControlStatusItem";

export const MISSION_CONTROL_ACTIVITY_ITEM_ID = "mission-control";
/** Right after Agents (100), before Bots (150) and Roundtable (160). */
export const MISSION_CONTROL_ACTIVITY_ITEM_ORDER = 110;
/** After the agent counters (200-220), before the Roundtable progress (300). */
export const MISSION_CONTROL_STATUS_ITEM_ORDER = 230;
export const MISSION_CONTROL_COMMANDS_KEY = "mission-control";

function useMissionControlShown(): boolean {
  return useMissionControlViewStore(selectMissionControlShown);
}

function useNeedsYouBadge(): number | null {
  const count = useNeedsYouCount();
  return count > 0 ? count : null;
}

let registered = false;

/** Idempotent: registers the Mission Control chrome once per renderer. */
export function registerMissionControl(): void {
  if (registered) return;
  registered = true;
  registerMissionControlTab({
    id: MISSION_AGENTS_TAB_ID,
    label: msg`Agents`,
    order: 0,
    component: AgentsTabEntry,
  });
  registerActivityBarItem({
    id: MISSION_CONTROL_ACTIVITY_ITEM_ID,
    label: msg`Mission Control`,
    icon: Radar,
    order: MISSION_CONTROL_ACTIVITY_ITEM_ORDER,
    action: toggleMissionControl,
    toggle: true,
    onPreload: preloadMissionControlPanel,
    useIsActive: useMissionControlShown,
    // Threads, bots and Roundtables waiting for an approval or an answer.
    useBadge: useNeedsYouBadge,
    useIsAvailable: useViscosityShellEnabled,
  });
  registerStatusBarItem({
    id: MISSION_CONTROL_STATUS_ITEM_ID,
    align: "left",
    order: MISSION_CONTROL_STATUS_ITEM_ORDER,
    component: MissionControlStatusItem,
  });
  registerViscosityCommands(MISSION_CONTROL_COMMANDS_KEY, missionControlCommands);
}
