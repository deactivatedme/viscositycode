/**
 * ViscosityCode: palette commands for Playbooks. They act on the focused
 * chat or draft through its composer picker, so the palette applies exactly
 * what picking in the composer does (MCP switches and the restart included).
 * Offered in the desktop shell only, where the picker exists; no default keys.
 */
import { msg } from "@lingui/core/macro";
import type { AppCommand } from "@/renderer/commands/registry";
import { i18n } from "@/renderer/i18n/i18n";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { PLAYBOOK_COMMAND_IDS } from "@/renderer/viscosity/commands/commandIds";
import {
  isSettingsSectionOffered,
  offeredWhen,
  openSettingsSectionIfOffered,
  VISCOSITY_COMMAND_GROUP,
} from "@/renderer/viscosity/commands/commandSupport";
import { isViscosityShellActive } from "@/renderer/viscosity/shellFlag";
import { builtInPlaybooks } from "./builtInPlaybooks";
import { activePlaybookTarget } from "./playbookTargets";
import { mergePlaybookCatalog } from "./usePlaybooks";

const KEYWORDS = ["playbook", "mode", "work mode", "instructions"];

export function playbookCommands(): AppCommand[] {
  const offered = offeredWhen(isViscosityShellActive());
  const catalog = mergePlaybookCatalog(
    builtInPlaybooks((descriptor) => i18n._(descriptor)),
    useSharedSettings.getState().playbooks ?? [],
  );
  return [
    {
      id: PLAYBOOK_COMMAND_IDS.pick,
      title: msg`Playbook: Choose…`,
      subtitle: msg`Pick how the agent approaches this chat`,
      group: VISCOSITY_COMMAND_GROUP,
      keywords: KEYWORDS,
      ...offered,
      run: () => activePlaybookTarget()?.openPicker(),
    },
    {
      id: PLAYBOOK_COMMAND_IDS.off,
      title: msg`Playbook: Off`,
      subtitle: msg`Turn off this chat's playbook`,
      group: VISCOSITY_COMMAND_GROUP,
      keywords: [...KEYWORDS, "off", "none", "clear", "stand down"],
      ...offered,
      run: () => activePlaybookTarget()?.apply(null),
    },
    {
      id: PLAYBOOK_COMMAND_IDS.manage,
      title: msg`Manage playbooks`,
      subtitle: msg`Create and edit playbooks in Settings`,
      group: VISCOSITY_COMMAND_GROUP,
      keywords: [...KEYWORDS, "settings", "edit", "new"],
      ...offeredWhen(isSettingsSectionOffered("playbooks")),
      run: () => openSettingsSectionIfOffered("playbooks"),
    },
    ...catalog.map(({ playbook }): AppCommand => ({
      id: `${PLAYBOOK_COMMAND_IDS.usePrefix}${playbook.id}`,
      title: msg`Playbook: ${playbook.label}`,
      ...(playbook.description ? { subtitle: playbook.description } : {}),
      group: VISCOSITY_COMMAND_GROUP,
      keywords: [...KEYWORDS, playbook.label.toLowerCase(), playbook.id],
      ...offered,
      run: () => activePlaybookTarget()?.apply(playbook.id),
    })),
  ];
}
