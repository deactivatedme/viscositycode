/**
 * ViscosityCode: Subscriptions commands for the command palette (fork of
 * Poracode). Offered only in the desktop shell, where Mission Control lives.
 */
import { msg } from "@lingui/core/macro";
import type { AppCommand } from "@/renderer/commands/registry";
import { isViscosityShellActive } from "@/renderer/viscosity/shellFlag";
import { openSubscriptions } from "./openSubscriptions";

/** Persisted in keybindings.json; the fork's command ids live under `viscosity.*`. */
export const OPEN_SUBSCRIPTIONS_COMMAND_ID = "viscosity.subscriptions.open";

export function subscriptionsCommands(): AppCommand[] {
  const available = isViscosityShellActive();
  return [
    {
      id: OPEN_SUBSCRIPTIONS_COMMAND_ID,
      title: msg`Open Subscriptions`,
      subtitle: msg`Plans, usage left and account pools for every provider`,
      group: msg`Mission Control`,
      keywords: [
        "subscriptions",
        "usage",
        "quota",
        "limits",
        "accounts",
        "pool",
        "plan",
        "credits",
        "mission control",
      ],
      ...(available ? {} : { showInPalette: false, showInShortcuts: false }),
      run: () => {
        openSubscriptions();
      },
    },
  ];
}
