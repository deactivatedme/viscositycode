/**
 * ViscosityCode: palette commands for account pools.
 *
 * "Open Subscriptions" is registered by the Subscriptions feature itself
 * (`viscosity.subscriptions.open`), so it is not repeated here.
 */
import { msg } from "@lingui/core/macro";
import type { AppCommand } from "@/renderer/commands/registry";
import { VISCOSITY_COMMAND_IDS } from "./commandIds";
import {
  isSettingsSectionOffered,
  offeredWhen,
  openSettingsSectionIfOffered,
  VISCOSITY_COMMAND_GROUP,
} from "./commandSupport";

export function accountPoolCommands(): AppCommand[] {
  return [
    {
      id: VISCOSITY_COMMAND_IDS.openAgentSettings,
      title: msg`Open Agents settings`,
      subtitle: msg`Profiles and account pools for each provider`,
      group: VISCOSITY_COMMAND_GROUP,
      keywords: ["account pool", "accounts", "pool", "failover", "profiles", "subscriptions"],
      ...offeredWhen(isSettingsSectionOffered("agents")),
      run: () => openSettingsSectionIfOffered("agents"),
    },
  ];
}
