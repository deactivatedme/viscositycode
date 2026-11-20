/**
 * ViscosityCode: settings-search entries for Settings → xAI API, spread into
 * the shared `SETTINGS_SEARCH_INDEX`.
 *
 * Each `title`/`description` is byte-identical to the string the row renders
 * (one catalog entry for both) and each `anchor` matches the row's `anchorId`.
 * The section is desktop-only (the xAI key lives in the desktop main process).
 */
import { msg } from "@lingui/core/macro";
import type { SettingsSearchEntry } from "@/renderer/views/SettingsOverlay/parts/settingsSearchIndex";

export const XAI_SETTINGS_SEARCH_ENTRIES: readonly SettingsSearchEntry[] = [
  {
    section: "xai",
    anchor: "xai.apiKey",
    title: msg`xAI API key`,
    description: msg`Used by Grok seats in a Roundtable. Kept in the desktop app's main process, never in pages.`,
    keywords: "grok xai api key token secret XAI_API_KEY roundtable credentials",
    desktopOnly: true,
  },
];
