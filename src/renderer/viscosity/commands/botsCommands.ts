/**
 * ViscosityCode: palette commands for Bots and account pools.
 *
 * Bots dialogs render from hosts that only mount in the desktop shell, so the
 * Bots commands are offered there only. "Open Subscriptions" is registered by
 * the Subscriptions feature itself (`viscosity.subscriptions.open`), so it is not
 * repeated here.
 */
import { msg } from "@lingui/core/macro";
import type { AppCommand } from "@/renderer/commands/registry";
import { openNewBotEditor } from "@/renderer/viscosity/bots/api";
import { isViscosityShellActive } from "@/renderer/viscosity/shellFlag";
import { ACTIVITY_ITEM_IDS, isActivityViewOffered, showActivityView } from "./activityViews";
import { VISCOSITY_COMMAND_IDS } from "./commandIds";
import {
  isSettingsSectionOffered,
  offeredWhen,
  openSettingsSectionIfOffered,
  VISCOSITY_COMMAND_GROUP,
} from "./commandSupport";

export function botsCommands(): AppCommand[] {
  return [
    {
      id: VISCOSITY_COMMAND_IDS.newBot,
      title: msg`New bot…`,
      subtitle: msg`Create a named AI teammate`,
      group: VISCOSITY_COMMAND_GROUP,
      keywords: ["bot", "bots", "teammate", "assistant", "create"],
      ...offeredWhen(isViscosityShellActive()),
      run: openNewBotEditor,
    },
    {
      id: VISCOSITY_COMMAND_IDS.openBots,
      title: msg`Open Bots`,
      subtitle: msg`Your bots and group chats in the sidebar`,
      group: VISCOSITY_COMMAND_GROUP,
      keywords: ["bots", "teammates", "group chat", "sidebar", "activity bar"],
      ...offeredWhen(isActivityViewOffered(ACTIVITY_ITEM_IDS.bots)),
      run: () => showActivityView(ACTIVITY_ITEM_IDS.bots),
    },
  ];
}

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
