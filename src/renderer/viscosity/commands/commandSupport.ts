/**
 * ViscosityCode: shared pieces of the fork's built-in palette commands — the
 * "ViscosityCode" group label, hiding a command that does not apply here, and
 * Settings deep links that respect which sections this client shows.
 */
import { msg } from "@lingui/core/macro";
import type { AppCommand } from "@/renderer/commands/registry";
import { isRemoteSession } from "@/renderer/bridge";
import { usePanelStore } from "@/renderer/state/panelStore";
import { isSettingsSectionVisible } from "@/renderer/views/SettingsOverlay/parts/settingsNavigation";
import type { SettingsSection } from "@/renderer/views/SettingsOverlay/parts/types";

/** Palette group of every built-in fork command. */
export const VISCOSITY_COMMAND_GROUP = msg`ViscosityCode`;

/**
 * Spread into a command: a command that does not apply in this window (for
 * example outside the desktop shell) stays registered, so keybindings keep
 * resolving, but is neither offered in the palette nor listed in Shortcuts.
 */
export function offeredWhen(
  available: boolean,
): Pick<AppCommand, "showInPalette" | "showInShortcuts"> {
  return available ? {} : { showInPalette: false, showInShortcuts: false };
}

function remoteSession(): boolean {
  try {
    return isRemoteSession();
  } catch {
    return false;
  }
}

/** Whether this client's Settings shows `section` (desktop-only pages hide on remote clients). */
export function isSettingsSectionOffered(section: SettingsSection): boolean {
  return isSettingsSectionVisible(section, remoteSession());
}

/** Open Settings on `section` when this client shows it; otherwise do nothing. */
export function openSettingsSectionIfOffered(section: SettingsSection): void {
  if (!isSettingsSectionOffered(section)) return;
  usePanelStore.getState().openSettingsSection(section);
}
