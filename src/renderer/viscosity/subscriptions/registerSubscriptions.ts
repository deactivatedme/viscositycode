/**
 * ViscosityCode: registers the Subscriptions dashboard (fork of Poracode):
 * Mission Control's "Subscriptions" tab (order 10, after "Agents") and the
 * "Open Subscriptions" palette command. Idempotent.
 */
import { msg } from "@lingui/core/macro";
import { registerViscosityCommands } from "@/renderer/viscosity/commands/viscosityCommands";
import { registerMissionControlTab } from "@/renderer/viscosity/missionControl/tabs";
import { SUBSCRIPTIONS_TAB_ID } from "./openSubscriptions";
import { subscriptionsCommands } from "./paletteCommands";
import { SubscriptionsTab } from "./ui/SubscriptionsTab";

/** Mission Control tab order: "Agents" is 0. */
export const SUBSCRIPTIONS_TAB_ORDER = 10;

export const SUBSCRIPTIONS_COMMANDS_KEY = "subscriptions";

let registered = false;

/** Registers the tab and the palette command once per renderer. */
export function registerSubscriptions(): void {
  if (registered) return;
  registered = true;
  registerMissionControlTab({
    id: SUBSCRIPTIONS_TAB_ID,
    label: msg`Subscriptions`,
    order: SUBSCRIPTIONS_TAB_ORDER,
    component: SubscriptionsTab,
  });
  registerViscosityCommands(SUBSCRIPTIONS_COMMANDS_KEY, subscriptionsCommands);
}
