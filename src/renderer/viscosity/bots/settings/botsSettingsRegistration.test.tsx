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
import { BOTS_SETTINGS_SEARCH_ENTRIES } from "./botsSettingsSearch";

const t = (descriptor: MessageDescriptor) => i18n._(descriptor);

describe("Settings → Bots registration", () => {
  beforeEach(() => {
    bridge.remote = false;
  });

  it("is a fixed section right after Crews", () => {
    expect(SETTINGS_SECTIONS.indexOf("bots")).toBe(SETTINGS_SECTIONS.indexOf("crews") + 1);
  });

  it("sits after Crews in the Agents group and is desktop-only", () => {
    const { result } = renderHook(() => useSettingsNavigation(), { wrapper: I18nTestWrapper });
    const agents = result.current.sectionGroups.find((group) => group.id === "agents");
    const ids = agents?.sections.map((section) => section.id) ?? [];
    expect(ids.indexOf("bots")).toBe(ids.indexOf("crews") + 1);
    expect(agents?.sections.find((section) => section.id === "bots")?.label).toBe("Bots");
    expect(result.current.isSectionVisible("bots")).toBe(true);
    // The xAI key lives in the desktop main process; browser clients do not get the page.
    expect(isSettingsSectionVisible("bots", false)).toBe(true);
    expect(isSettingsSectionVisible("bots", true)).toBe(false);
  });

  it("maps the section to its view in the Settings overlay", () => {
    const overlay = readFileSync(
      join(import.meta.dirname, "../../../views/SettingsOverlay/SettingsOverlay.tsx"),
      "utf8",
    );
    expect(overlay).toMatch(/^\s*bots: \(\) => <BotsSettings \/>,/m);
    expect(overlay).toContain('from "@/renderer/viscosity/bots/settings/BotsSettings"');
  });

  it("indexes every row for settings search, grouped after Crews, desktop only", () => {
    const sections = SETTINGS_SEARCH_INDEX.map((entry) => entry.section);
    const bots = SETTINGS_SEARCH_INDEX.filter((entry) => entry.section === "bots");
    expect(bots).toEqual(BOTS_SETTINGS_SEARCH_ENTRIES);
    expect(sections.indexOf("bots")).toBe(sections.lastIndexOf("crews") + 1);
    expect(bots.every((entry) => entry.anchor.startsWith("bots."))).toBe(true);
    expect(bots.every((entry) => entry.desktopOnly === true)).toBe(true);
  });

  it("finds the xAI key from search on the desktop only", () => {
    expect(searchSettings("xai key", t).map((hit) => hit.anchor)).toContain("bots.xaiKey");
    expect(searchSettings("XAI_API_KEY", t).map((hit) => hit.anchor)).toContain("bots.xaiKey");
    expect(searchSettings("x search", t).map((hit) => hit.anchor)).toContain("bots.defaultTools");
    expect(
      searchSettings("xai key", t, { remoteSession: true }).map((hit) => hit.anchor),
    ).not.toContain("bots.xaiKey");
  });

  it("records a feature-discovery decision for the section", () => {
    expect(NOT_PROMOTED["settings:bots"]).toBeTruthy();
  });
});

describe("Bots activity bar item", () => {
  it("registers one Bots view between Agents and Explorer", async () => {
    const registry = await import("@/renderer/viscosity/layout/activityBar/activityBarRegistry");
    registry.clearActivityBarRegistry();
    const { registerBotsChrome, BOTS_ACTIVITY_ITEM_ID } = await import("../registerBotsChrome");
    registerBotsChrome();
    registerBotsChrome();
    const items = registry
      .getActivityBarItems()
      .filter((item) => item.id === BOTS_ACTIVITY_ITEM_ID);
    expect(items).toHaveLength(1);
    const item = items[0]!;
    expect(item.view).not.toBeNull();
    expect(item.position).toBe("top");
    expect(item.order).toBeGreaterThan(100);
    expect(item.order).toBeLessThan(200);
    expect(i18n._(item.label)).toBe("Bots");
  });
});
