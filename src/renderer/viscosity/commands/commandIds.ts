/**
 * ViscosityCode: stable ids of the fork's built-in palette commands.
 *
 * Ids are persisted in users' keybindings.json and feature-usage signals, so
 * they never change once shipped. All of them live under `viscosity.*`.
 */
export const VISCOSITY_COMMAND_IDS = {
  // Effects (Settings → Effects).
  toggleBackground: "viscosity.effects.toggleBackground",
  cycleBackgroundStyle: "viscosity.effects.cycleBackgroundStyle",
  toggleAgentEffects: "viscosity.effects.toggleAgentEffects",
  openEffectsSettings: "viscosity.effects.openSettings",
  // Themes.
  themeViscosity: "viscosity.theme.viscosity",
  themeViscosityShowcase: "viscosity.theme.viscosityShowcase",
  toggleLightDark: "viscosity.theme.toggleLightDark",
  // Bots.
  newBot: "viscosity.bots.new",
  openBots: "viscosity.bots.open",
  // Account pools ("Open Subscriptions" belongs to the Subscriptions feature).
  openAgentSettings: "viscosity.accountPools.openAgentSettings",
  // Layout: activity bar views.
  showAgents: "viscosity.view.agents",
  showExplorer: "viscosity.view.explorer",
  showSourceControl: "viscosity.view.sourceControl",
  showBrowser: "viscosity.view.browser",
} as const;

export type ViscosityCommandId = (typeof VISCOSITY_COMMAND_IDS)[keyof typeof VISCOSITY_COMMAND_IDS];
