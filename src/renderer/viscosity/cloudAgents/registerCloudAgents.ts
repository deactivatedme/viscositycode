/**
 * ViscosityCode: registers the Cloud tab (fork of Poracode): Mission
 * Control's "Cloud" tab (order 5, between "Agents" and "Subscriptions") and
 * the "Open Cloud agents" palette command. Idempotent.
 */
import { msg } from "@lingui/core/macro";
import { registerViscosityCommands } from "@/renderer/viscosity/commands/viscosityCommands";
import { registerMissionControlTab } from "@/renderer/viscosity/missionControl/tabs";
import { CLOUD_AGENTS_TAB_ID } from "./openCloudAgents";
import { cloudAgentsCommands } from "./paletteCommands";
import { CloudAgentsTab } from "./ui/CloudAgentsTab";

/** Mission Control tab order: "Agents" is 0, "Subscriptions" is 10. */
export const CLOUD_AGENTS_TAB_ORDER = 5;

export const CLOUD_AGENTS_COMMANDS_KEY = "cloudAgents";

let registered = false;

/** Registers the tab and the palette command once per renderer. */
export function registerCloudAgents(): void {
  if (registered) return;
  registered = true;
  registerMissionControlTab({
    id: CLOUD_AGENTS_TAB_ID,
    label: msg`Cloud`,
    order: CLOUD_AGENTS_TAB_ORDER,
    component: CloudAgentsTab,
  });
  registerViscosityCommands(CLOUD_AGENTS_COMMANDS_KEY, cloudAgentsCommands);
}
