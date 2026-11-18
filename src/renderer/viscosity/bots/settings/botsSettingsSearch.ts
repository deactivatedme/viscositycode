/**
 * ViscosityCode: settings-search entries for Settings → Bots, spread into the
 * shared `SETTINGS_SEARCH_INDEX`.
 *
 * Each `title`/`description` is byte-identical to the string the row renders
 * (one catalog entry for both) and each `anchor` matches the row's `anchorId`.
 * The section is desktop-only (the xAI key lives in the desktop main process),
 * so every entry is `desktopOnly`.
 */
import { msg } from "@lingui/core/macro";
import type { SettingsSearchEntry } from "@/renderer/views/SettingsOverlay/parts/settingsSearchIndex";

export const BOTS_SETTINGS_SEARCH_ENTRIES: readonly SettingsSearchEntry[] = [
  {
    section: "bots",
    anchor: "bots.xaiKey",
    title: msg`xAI API key`,
    description: msg`Used only by Grok bots. Kept in the desktop app's main process, never in pages.`,
    keywords: "grok xai api key token secret XAI_API_KEY bots credentials",
    desktopOnly: true,
  },
  {
    section: "bots",
    anchor: "bots.defaultRegion",
    title: msg`Default region`,
    description: msg`Where new Grok bots send requests. The US endpoint serves text models only.`,
    keywords: "grok xai region us united states endpoint global bots",
    desktopOnly: true,
  },
  {
    section: "bots",
    anchor: "bots.defaultTools",
    title: msg`Default tools`,
    description: msg`Server-side search tools new Grok bots start with.`,
    keywords: "grok xai web search x search twitter tools bots",
    desktopOnly: true,
  },
];
