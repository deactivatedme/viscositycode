/**
 * ViscosityCode: Zen mode palette command (fork of Poracode). Offered only in
 * the desktop shell; it has no default key (assign one in Settings → Shortcuts).
 */
import { msg } from "@lingui/core/macro";
import type { AppCommand } from "@/renderer/commands/registry";
import { isViscosityShellActive } from "@/renderer/viscosity/shellFlag";
import { toggleZenMode } from "./zenModeStore";

export const TOGGLE_ZEN_MODE_COMMAND_ID = "viscosity.zen.toggle";

export function zenCommands(): AppCommand[] {
  const available = isViscosityShellActive();
  return [
    {
      id: TOGGLE_ZEN_MODE_COMMAND_ID,
      title: msg`Toggle Zen mode`,
      subtitle: msg`Hide the bars and panels and center the focused pane`,
      group: msg`View`,
      keywords: ["zen", "focus", "distraction free", "hide chrome", "center", "full screen"],
      ...(available ? {} : { showInPalette: false, showInShortcuts: false }),
      run: () => {
        toggleZenMode();
      },
    },
  ];
}
