/**
 * ViscosityCode: palette commands for the Viscosity theme presets and the
 * light/dark switch. They call the same shared-settings actions as
 * Settings → Appearance, so the theme follows the user on every client the
 * way a choice made on that page does.
 */
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import type { AppCommand } from "@/renderer/commands/registry";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { systemPrefersDark } from "@/renderer/theme/applyAppTheme";
import { DEFAULT_THEME_ID, VISCOSITY_SHOWCASE_THEME_ID } from "@/renderer/theme/themePresets";
import { resolveThemeMode } from "@/shared/themeMode";
import { VISCOSITY_COMMAND_IDS } from "./commandIds";
import { VISCOSITY_COMMAND_GROUP } from "./commandSupport";

interface ViscosityThemeCommand {
  id: string;
  presetId: string;
  title: MessageDescriptor;
}

/** The fork's own presets, in gallery order. */
const VISCOSITY_THEME_COMMANDS: readonly ViscosityThemeCommand[] = [
  {
    id: VISCOSITY_COMMAND_IDS.themeViscosity,
    presetId: DEFAULT_THEME_ID,
    title: msg`Use the Viscosity theme`,
  },
  {
    id: VISCOSITY_COMMAND_IDS.themeViscosityShowcase,
    presetId: VISCOSITY_SHOWCASE_THEME_ID,
    title: msg`Use the Viscosity Showcase theme`,
  },
];

/** The appearance on screen now ("system" resolved against the OS). */
export function resolvedAppearance(): "light" | "dark" {
  return resolveThemeMode(useSharedSettings.getState().themeMode, systemPrefersDark());
}

/** Flip what is on screen; from "system" this pins the opposite of the OS appearance. */
export function toggleLightDark(): void {
  const next = resolvedAppearance() === "dark" ? "light" : "dark";
  useSharedSettings.getState().setThemeMode(next);
}

export function themeCommands(): AppCommand[] {
  const activePreset = useSharedSettings.getState().themePreset;
  const dark = resolvedAppearance() === "dark";
  return [
    ...VISCOSITY_THEME_COMMANDS.map((theme): AppCommand => ({
      id: theme.id,
      title: theme.title,
      subtitle: activePreset === theme.presetId ? msg`Current theme` : msg`Switch the color theme`,
      group: VISCOSITY_COMMAND_GROUP,
      keywords: ["theme", "colors", "preset", "appearance", "viscosity"],
      run: () => useSharedSettings.getState().setThemePreset(theme.presetId),
    })),
    {
      id: VISCOSITY_COMMAND_IDS.toggleLightDark,
      title: msg`Toggle light/dark mode`,
      subtitle: dark ? msg`Switch to light mode` : msg`Switch to dark mode`,
      group: VISCOSITY_COMMAND_GROUP,
      keywords: ["theme", "dark", "light", "mode", "appearance", "night"],
      run: toggleLightDark,
    },
  ];
}
