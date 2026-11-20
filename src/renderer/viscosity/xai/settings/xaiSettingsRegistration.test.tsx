import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderHook } from "@testing-library/react";
import type { MessageDescriptor } from "@lingui/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/renderer/i18n/i18n";
import { I18nTestWrapper } from "@/renderer/testUtils/i18n";

const bridge = vi.hoisted(() => ({ remote: false }));

vi.mock("@/renderer/bridge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/renderer/bridge")>()),
  isDevApp: () => false,
  isRemoteSession: () => bridge.remote,
}));

import { NOT_PROMOTED } from "@/renderer/components/newsLine/featureCatalog";
import {
  isSettingsSectionVisible,
  useSettingsNavigation,
} from "@/renderer/views/SettingsOverlay/parts/settingsNavigation";
import {
  SETTINGS_SEARCH_INDEX,
  searchSettings,
} from "@/renderer/views/SettingsOverlay/parts/settingsSearchIndex";
import { SETTINGS_SECTIONS } from "@/renderer/views/SettingsOverlay/parts/types";
import { XAI_SETTINGS_SEARCH_ENTRIES } from "./xaiSettingsSearch";

const t = (descriptor: MessageDescriptor) => i18n._(descriptor);

describe("Settings → xAI API registration", () => {
  beforeEach(() => {
    bridge.remote = false;
  });

  it("is a fixed section right after Crews", () => {
    expect(SETTINGS_SECTIONS.indexOf("xai")).toBe(SETTINGS_SECTIONS.indexOf("crews") + 1);
  });

  it("replaces the removed Bots section", () => {
    expect(SETTINGS_SECTIONS).not.toContain("bots");
  });

  it("sits after Crews in the Agents group and is desktop-only", () => {
    const { result } = renderHook(() => useSettingsNavigation(), { wrapper: I18nTestWrapper });
    const agents = result.current.sectionGroups.find((group) => group.id === "agents");
    const ids = agents?.sections.map((section) => section.id) ?? [];
    expect(ids.indexOf("xai")).toBe(ids.indexOf("crews") + 1);
    expect(agents?.sections.find((section) => section.id === "xai")?.label).toBe("xAI API");
    expect(result.current.isSectionVisible("xai")).toBe(true);
    // The xAI key lives in the desktop main process; browser clients do not get the page.
    expect(isSettingsSectionVisible("xai", false)).toBe(true);
    expect(isSettingsSectionVisible("xai", true)).toBe(false);
  });

  it("maps the section to its view in the Settings overlay", () => {
    const overlay = readFileSync(
      join(import.meta.dirname, "../../../views/SettingsOverlay/SettingsOverlay.tsx"),
      "utf8",
    );
    expect(overlay).toMatch(/^\s*xai: \(\) => <XaiSettings \/>,/m);
    expect(overlay).toContain('from "@/renderer/viscosity/xai/settings/XaiSettings"');
  });

  it("indexes every row for settings search, grouped after Crews, desktop only", () => {
    const sections = SETTINGS_SEARCH_INDEX.map((entry) => entry.section);
    const xai = SETTINGS_SEARCH_INDEX.filter((entry) => entry.section === "xai");
    expect(xai).toEqual(XAI_SETTINGS_SEARCH_ENTRIES);
    expect(sections.indexOf("xai")).toBe(sections.lastIndexOf("crews") + 1);
    expect(xai.every((entry) => entry.anchor.startsWith("xai."))).toBe(true);
    expect(xai.every((entry) => entry.desktopOnly === true)).toBe(true);
  });

  it("finds the xAI key from search on the desktop only", () => {
    expect(searchSettings("xai key", t).map((hit) => hit.anchor)).toContain("xai.apiKey");
    expect(searchSettings("XAI_API_KEY", t).map((hit) => hit.anchor)).toContain("xai.apiKey");
    expect(
      searchSettings("xai key", t, { remoteSession: true }).map((hit) => hit.anchor),
    ).not.toContain("xai.apiKey");
  });

  it("records a feature-discovery decision for the section", () => {
    expect(NOT_PROMOTED["settings:xai"]).toBeTruthy();
  });
});
