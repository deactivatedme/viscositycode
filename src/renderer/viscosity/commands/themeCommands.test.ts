import type { MessageDescriptor } from "@lingui/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppCommand } from "@/renderer/commands/registry";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { DEFAULT_THEME_ID, VISCOSITY_SHOWCASE_THEME_ID } from "@/renderer/theme/themePresets";
import { VISCOSITY_SHELL_ATTRIBUTE } from "@/renderer/viscosity/shellFlag";
import { VISCOSITY_COMMAND_IDS } from "./commandIds";
import { themeCommands } from "./themeCommands";

const label = (value: string | MessageDescriptor | undefined): string =>
  value === undefined
    ? ""
    : typeof value === "string"
      ? value
      : (value.message ?? String(value.id));

function find(commands: AppCommand[], id: string): AppCommand {
  const command = commands.find((entry) => entry.id === id);
  if (!command) throw new Error(`missing ${id}`);
  return command;
}

function setPrefersDark(dark: boolean): void {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query === "(prefers-color-scheme: dark)" ? dark : false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })),
  );
}

beforeEach(() => {
  document.documentElement.setAttribute(VISCOSITY_SHELL_ATTRIBUTE, "");
});

afterEach(() => {
  document.documentElement.removeAttribute(VISCOSITY_SHELL_ATTRIBUTE);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Theme commands", () => {
  beforeEach(() => {
    useSharedSettings.setState({ themePreset: DEFAULT_THEME_ID, themeMode: "system" });
  });

  it("switches to each Viscosity preset and marks the current one", async () => {
    const showcase = () => find(themeCommands(), VISCOSITY_COMMAND_IDS.themeViscosityShowcase);
    const viscosity = () => find(themeCommands(), VISCOSITY_COMMAND_IDS.themeViscosity);
    expect(label(viscosity().subtitle)).toBe("Current theme");
    await showcase().run();
    expect(useSharedSettings.getState().themePreset).toBe(VISCOSITY_SHOWCASE_THEME_ID);
    expect(label(showcase().subtitle)).toBe("Current theme");
    expect(label(viscosity().subtitle)).toBe("Switch the color theme");
    await viscosity().run();
    expect(useSharedSettings.getState().themePreset).toBe(DEFAULT_THEME_ID);
  });

  it("flips the appearance on screen, resolving system mode against the OS", async () => {
    setPrefersDark(true);
    const toggle = () => find(themeCommands(), VISCOSITY_COMMAND_IDS.toggleLightDark);
    expect(label(toggle().subtitle)).toBe("Switch to light mode");
    await toggle().run();
    expect(useSharedSettings.getState().themeMode).toBe("light");
    await toggle().run();
    expect(useSharedSettings.getState().themeMode).toBe("dark");

    useSharedSettings.setState({ themeMode: "system" });
    setPrefersDark(false);
    await toggle().run();
    expect(useSharedSettings.getState().themeMode).toBe("dark");
  });

  it("is offered everywhere, including outside the desktop shell", () => {
    document.documentElement.removeAttribute(VISCOSITY_SHELL_ATTRIBUTE);
    expect(themeCommands().filter((command) => command.showInPalette === false)).toEqual([]);
  });
});
