import { i18n } from "@/renderer/i18n/i18n";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { AgentColorsSettings } from "@/renderer/viscosity/agentColors/AgentColorsSettings";
import { SETTINGS_SEARCH_INDEX } from "@/renderer/views/SettingsOverlay/parts/settingsSearchIndex";

const AGENT_COLOR_ANCHORS = ["appearance.agentColors", "appearance.agentColorMarkers"];

const root = document.documentElement;

beforeEach(() => {
  root.dataset.windowKind = "main";
});

afterEach(() => {
  delete root.dataset.windowKind;
});

describe("Agent colours in the settings search", () => {
  it("indexes the group and its marker switch under Appearance", () => {
    const entries = SETTINGS_SEARCH_INDEX.filter((entry) =>
      AGENT_COLOR_ANCHORS.includes(entry.anchor),
    );
    expect(entries.map((entry) => [entry.anchor, entry.section])).toEqual(
      AGENT_COLOR_ANCHORS.map((anchor) => [anchor, "appearance"]),
    );
  });

  it("points each entry at a rendered row whose text matches the entry", () => {
    const { container } = render(<AgentColorsSettings />);
    const mismatches: string[] = [];
    for (const entry of SETTINGS_SEARCH_INDEX) {
      if (!AGENT_COLOR_ANCHORS.includes(entry.anchor)) continue;
      const row = container.querySelector<HTMLElement>(`[data-settings-anchor="${entry.anchor}"]`);
      for (const descriptor of [entry.title, entry.description]) {
        if (!descriptor) continue;
        const text = i18n._(descriptor);
        if (!row?.textContent?.includes(text)) mismatches.push(`${entry.anchor}: "${text}"`);
      }
    }
    expect(mismatches).toEqual([]);
  });
});
