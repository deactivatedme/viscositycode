// ViscosityCode: the fork's default shortcuts reach keybindings.json, new and pre-upgrade.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readKeybindingsFile } from "@/main/keybindingsFile";
import {
  bindingForPlatform,
  canonicalizeKeybinding,
  formatCommandShortcut,
} from "@/renderer/commands/keybindingMatcher";
import { BACKFILL_COMMAND_IDS, DEFAULT_KEYBINDINGS } from "../keybindings";
import { VISCOSITY_BACKFILL_COMMAND_IDS, VISCOSITY_DEFAULT_KEYBINDINGS } from "./keybindings";

let tempDir: string | null = null;

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
});

function readFileWith(keybindings: unknown[]) {
  tempDir = mkdtempSync(join(tmpdir(), "viscosity-keybindings-"));
  const path = join(tempDir, "keybindings.json");
  writeFileSync(path, `${JSON.stringify({ version: 1, keybindings })}\n`, "utf8");
  return readKeybindingsFile(path).file.keybindings;
}

describe("ViscosityCode default keybindings", () => {
  it("are upstream defaults and backfilled ids", () => {
    for (const binding of VISCOSITY_DEFAULT_KEYBINDINGS) {
      expect(DEFAULT_KEYBINDINGS.keybindings).toContainEqual(binding);
      expect(BACKFILL_COMMAND_IDS).toContain(binding.command);
    }
    expect(VISCOSITY_BACKFILL_COMMAND_IDS).toContain("viscosity.rightSidebar.toggle");
  });

  it("backfills a pre-upgrade file and never overrides a user's own binding", () => {
    const result = readFileWith([
      { command: "settings.open", key: "Ctrl+," },
      { command: "viscosity.view.explorer", key: "Ctrl+Alt+E" },
    ]);
    expect(result.find((b) => b.command === "viscosity.rightSidebar.toggle")).toMatchObject({
      key: "Ctrl+Shift+Y",
      mac: "Meta+Alt+B",
      when: "!terminalFocus",
    });
    expect(result.filter((b) => b.command === "viscosity.view.explorer")).toEqual([
      { command: "viscosity.view.explorer", key: "Ctrl+Alt+E" },
    ]);
  });

  it("stay off AltGr and every other default on Windows and Linux; macOS keeps Cmd+Option", () => {
    const others = DEFAULT_KEYBINDINGS.keybindings.filter(
      (binding) => !VISCOSITY_BACKFILL_COMMAND_IDS.includes(binding.command),
    );
    for (const platform of ["win32", "linux"] as const) {
      const taken = new Set(
        others.map((b) => canonicalizeKeybinding(bindingForPlatform(b, platform) ?? "", platform)),
      );
      for (const binding of VISCOSITY_DEFAULT_KEYBINDINGS) {
        const chord = canonicalizeKeybinding(bindingForPlatform(binding, platform)!, platform)!;
        expect(chord).not.toMatch(/ctrl\+alt/);
        expect(taken.has(chord)).toBe(false);
      }
    }
    expect(VISCOSITY_DEFAULT_KEYBINDINGS.map((b) => bindingForPlatform(b, "darwin"))).toEqual([
      "Meta+Alt+B",
      "Meta+Alt+1",
      "Meta+Alt+2",
      "Meta+Alt+3",
      "Meta+Alt+4",
      "Meta+Alt+5",
    ]);
  });

  it("label the toggle with each platform's modifier names", () => {
    const id = "viscosity.rightSidebar.toggle";
    expect(formatCommandShortcut(id, VISCOSITY_DEFAULT_KEYBINDINGS, "darwin")).toBe("⌘⌥B");
    expect(formatCommandShortcut(id, VISCOSITY_DEFAULT_KEYBINDINGS, "win32")).toBe("Ctrl+Shift+Y");
    expect(formatCommandShortcut(id, VISCOSITY_DEFAULT_KEYBINDINGS, "linux")).toBe("Ctrl+Shift+Y");
  });
});
