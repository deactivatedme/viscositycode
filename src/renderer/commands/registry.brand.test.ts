// @vitest-environment node

import type { MessageDescriptor } from "@lingui/core";
import { describe, expect, it } from "vitest";
import { BRAND_NAME } from "@/shared/brand";
import { DEFAULT_KEYBINDINGS } from "@/shared/keybindings";
import { buildCommandRegistry } from "./registry";
import { buildShortcutRows } from "./shortcutCatalog";

const resolveLabel = (value: string | MessageDescriptor): string =>
  typeof value === "string" ? value : (value.message ?? String(value.id));

describe("command registry branding (ViscosityCode)", () => {
  it("groups general commands under the fork's name in the General section", () => {
    const commands = buildCommandRegistry();
    const settings = commands.find((command) => command.id === "settings.open");
    expect(settings?.group).toBe(BRAND_NAME);
    expect(commands.some((command) => command.group === "Poracode")).toBe(false);

    const rows = buildShortcutRows(
      commands,
      DEFAULT_KEYBINDINGS.keybindings,
      "darwin",
      resolveLabel,
    );
    const row = rows.find((item) => item.id === "settings.open");
    expect(row?.section).toBe("general");
    expect(row?.description).toBe(BRAND_NAME);
    expect(rows.some((item) => /\bPoracode\b/.test(`${item.group} ${item.description}`))).toBe(
      false,
    );
  });

  it("does not offer What's New without a changelog source", () => {
    const changelog = buildCommandRegistry().find((command) => command.id === "changelog.open");
    expect(changelog).toMatchObject({ showInPalette: false, showInShortcuts: false });
    const rows = buildShortcutRows(
      buildCommandRegistry(),
      DEFAULT_KEYBINDINGS.keybindings,
      "darwin",
      resolveLabel,
    );
    expect(rows.find((item) => item.id === "changelog.open")).toBeUndefined();
  });
});
