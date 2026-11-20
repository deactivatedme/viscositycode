/**
 * ViscosityCode: settings-search entries for Settings → Playbooks, spread into
 * the shared `SETTINGS_SEARCH_INDEX`. Each title/description is byte-identical
 * to the string the row renders and each anchor matches the row's anchor
 * (`settingsSearchIndex.test.ts` checks the anchors). Keywords carry "mode"
 * so "reversing mode" finds the page.
 */
import { msg } from "@lingui/core/macro";
import type { SettingsSearchEntry } from "@/renderer/views/SettingsOverlay/parts/settingsSearchIndex";

export const PLAYBOOKS_SETTINGS_SEARCH_ENTRIES: readonly SettingsSearchEntry[] = [
  {
    section: "playbooks",
    anchor: "playbooks.list",
    title: msg`Playbooks`,
    description: msg`Playbooks are work modes for a chat: standing instructions for the agent and the tools it needs.`,
    keywords:
      "playbook playbooks mode modes work mode reversing reverse engineering live reversing lldb debugger attach dynamic analysis review security audit debug explore tests refactor performance web qa instructions",
  },
  {
    section: "playbooks",
    anchor: "playbooks.theme",
    title: msg`Let playbooks change the theme`,
    description: msg`A chat's playbook can restyle the app while that chat is on screen. Only on this device.`,
    keywords: "playbook theme colors restyle reversing hostile mode appearance",
  },
];
