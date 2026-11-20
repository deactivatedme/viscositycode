/**
 * ViscosityCode: the Cloud tab's command palette entry (fork of Poracode).
 * Offered only in the desktop shell, where Mission Control lives.
 */
import { msg } from "@lingui/core/macro";
import type { AppCommand } from "@/renderer/commands/registry";
import { isViscosityShellActive } from "@/renderer/viscosity/shellFlag";
import { openCloudAgents } from "./openCloudAgents";

/** Persisted in keybindings.json; the fork's command ids live under `viscosity.*`. */
export const OPEN_CLOUD_AGENTS_COMMAND_ID = "viscosity.cloudAgents.open";

export function cloudAgentsCommands(): AppCommand[] {
  const available = isViscosityShellActive();
  return [
    {
      id: OPEN_CLOUD_AGENTS_COMMAND_ID,
      title: msg`Open Cloud agents`,
      subtitle: msg`Agents running in a provider's cloud, with their branches and pull requests`,
      group: msg`Mission Control`,
      keywords: ["cloud", "agents", "background", "remote", "pull request", "mission control"],
      ...(available ? {} : { showInPalette: false, showInShortcuts: false }),
      run: () => {
        openCloudAgents();
      },
    },
  ];
}
