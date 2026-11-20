/**
 * ViscosityCode: stable ids of the fork's built-in palette commands.
 *
 * Ids are persisted in users' keybindings.json and feature-usage signals, so
 * they never change once shipped. All of them live under `viscosity.*`.
 */
export const VISCOSITY_COMMAND_IDS = {
  // Retired (Effects removed): viscosity.effects.toggleBackground,
  // viscosity.effects.cycleBackgroundStyle, viscosity.effects.toggleAgentEffects,
  // viscosity.effects.openSettings. Never reuse.
  // Themes.
  themeViscosity: "viscosity.theme.viscosity",
  themeViscosityShowcase: "viscosity.theme.viscosityShowcase",
  toggleLightDark: "viscosity.theme.toggleLightDark",
  // Retired (Bots removed): viscosity.bots.new, viscosity.bots.open. Never reuse.
  // Account pools ("Open Subscriptions" belongs to the Subscriptions feature).
  openAgentSettings: "viscosity.accountPools.openAgentSettings",
  // Layout: the left sidebar's chats and the right sidebar's tools. Explorer and
  // Source Control ("Show Changes") moved to the right sidebar under their shipped ids.
  showAgents: "viscosity.view.agents",
  // Retired (Grok Bots removed): viscosity.view.grokBots. Never reuse.
  showExplorer: "viscosity.view.explorer",
  showSourceControl: "viscosity.view.sourceControl",
  showBrowser: "viscosity.view.browser",
  showNotes: "viscosity.view.notes",
  showUsage: "viscosity.view.usage",
  rightSidebarToggle: "viscosity.rightSidebar.toggle",
} as const;

/**
 * Playbooks (src/renderer/viscosity/playbooks), registered by that feature
 * rather than the built-in set. Each playbook also gets `usePrefix` + its id.
 */
export const PLAYBOOK_COMMAND_IDS = {
  pick: "viscosity.playbooks.pick",
  off: "viscosity.playbooks.off",
  manage: "viscosity.playbooks.manage",
  usePrefix: "viscosity.playbooks.use.",
} as const;

export type ViscosityCommandId = (typeof VISCOSITY_COMMAND_IDS)[keyof typeof VISCOSITY_COMMAND_IDS];
