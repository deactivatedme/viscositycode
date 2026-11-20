/**
 * ViscosityCode Playbooks entry (fork of Poracode).
 *
 * Importing this module registers the Playbook palette commands once. The
 * composer chip and compact label import it, so the commands exist
 * whenever a surface that can show a playbook is loaded.
 */
import { registerViscosityCommands } from "@/renderer/viscosity/commands/viscosityCommands";
import { playbookCommands } from "./playbookCommands";

export const PLAYBOOK_COMMANDS_KEY = "playbooks";

let registered = false;

export function registerPlaybooks(): void {
  if (registered) return;
  registered = true;
  registerViscosityCommands(PLAYBOOK_COMMANDS_KEY, playbookCommands);
}

registerPlaybooks();

export { PlaybookChip } from "./PlaybookChip";
export { PlaybookCompactLabel } from "./PlaybookTabBadge";
export { usePlaybookSessionRelaunch } from "./usePlaybookSessionRelaunch";
export { withCarriedPlaybook } from "./applyPlaybook";
