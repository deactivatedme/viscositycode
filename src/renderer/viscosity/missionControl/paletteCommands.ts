/**
 * ViscosityCode Mission Control: command palette entries (fork of Poracode).
 * Offered only in the desktop shell, where the panel lives.
 */
import { msg } from "@lingui/core/macro";
import type { AppCommand } from "@/renderer/commands/registry";
import { isViscosityShellActive } from "@/renderer/viscosity/shellFlag";
import { MISSION_AGENTS_TAB_ID, openMissionControl } from "./missionControlViewStore";

/** Persisted in keybindings.json; the fork's command ids live under `viscosity.*`. */
export const OPEN_MISSION_CONTROL_COMMAND_ID = "viscosity.missionControl.open";

export function missionControlCommands(): AppCommand[] {
  const hidden = isViscosityShellActive() ? {} : { showInPalette: false, showInShortcuts: false };
  return [
    {
      id: OPEN_MISSION_CONTROL_COMMAND_ID,
      title: msg`Open Mission Control`,
      subtitle: msg`Every agent and Roundtable at a glance`,
      group: msg`Mission Control`,
      keywords: [
        "mission control",
        "agents",
        "overview",
        "dashboard",
        "running",
        "needs you",
        "approvals",
        "status",
      ],
      ...hidden,
      run: () => {
        openMissionControl({ tabId: MISSION_AGENTS_TAB_ID });
      },
    },
  ];
}
