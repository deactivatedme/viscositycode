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
import { EFFECTS_SETTINGS_SEARCH_ENTRIES } from "./effectsSettingsSearch";

const t = (descriptor: MessageDescriptor) => i18n._(descriptor);

describe("Settings → Effects registration", () => {
  beforeEach(() => {
    bridge.remote = false;
  });

  it("is a fixed section right after Appearance", () => {
    expect(SETTINGS_SECTIONS.indexOf("effects")).toBe(SETTINGS_SECTIONS.indexOf("appearance") + 1);
  });

  it.each([false, true])(
    "sits after Appearance in the Personal group (remote session: %s)",
    (remote) => {
      bridge.remote = remote;
      const { result } = renderHook(() => useSettingsNavigation(), { wrapper: I18nTestWrapper });
      const personal = result.current.sectionGroups.find((group) => group.id === "personal");
      const ids = personal?.sections.map((section) => section.id) ?? [];
      expect(ids.indexOf("effects")).toBe(ids.indexOf("appearance") + 1);
      expect(personal?.sections.find((section) => section.id === "effects")?.label).toBe("Effects");
      // Desktop-width browser clients get the fork shell too, so the page stays reachable.
      expect(result.current.isSectionVisible("effects")).toBe(true);
      expect(isSettingsSectionVisible("effects", remote)).toBe(true);
    },
  );

  it("maps the section to its view in the Settings overlay", () => {
    const overlay = readFileSync(
      join(import.meta.dirname, "../../views/SettingsOverlay/SettingsOverlay.tsx"),
      "utf8",
    );
    expect(overlay).toMatch(/^\s*effects: \(\) => <EffectsSettings \/>,/m);
    expect(overlay).toContain('from "@/renderer/fx/settings/EffectsSettings"');
  });

  it("indexes every row for settings search, grouped after Appearance", () => {
    const sections = SETTINGS_SEARCH_INDEX.map((entry) => entry.section);
    const effects = SETTINGS_SEARCH_INDEX.filter((entry) => entry.section === "effects");
    expect(effects).toEqual(EFFECTS_SETTINGS_SEARCH_ENTRIES);
    expect(sections.indexOf("effects")).toBe(sections.lastIndexOf("appearance") + 1);
    expect(effects.every((entry) => entry.anchor.startsWith("effects."))).toBe(true);
    expect(effects.every((entry) => !entry.desktopOnly && !entry.conditional)).toBe(true);
  });

  it("finds Effects rows from search in desktop and browser clients", () => {
    for (const remoteSession of [false, true]) {
      expect(
        searchSettings("reduce motion", t, { remoteSession }).map((hit) => hit.anchor),
      ).toContain("effects.respectReducedMotion");
    }
    expect(searchSettings("thinking glow", t).map((hit) => hit.anchor)).toContain(
      "effects.thinkingGlow",
    );
    expect(searchSettings("fps", t).map((hit) => hit.anchor)).toContain("effects.fpsCap");
    expect(searchSettings("approval background", t).map((hit) => hit.anchor)).toContain(
      "effects.approvalNotifications",
    );
  });

  it("records a feature-discovery decision for the section", () => {
    expect(NOT_PROMOTED["settings:effects"]).toBeTruthy();
  });
});
