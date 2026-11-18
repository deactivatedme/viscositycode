import type { MessageDescriptor } from "@lingui/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppCommand } from "@/renderer/commands/registry";
import type { Project, Thread } from "@/shared/contracts";
import { BACKGROUND_PRESETS, useFxSettings } from "@/renderer/fx/fxSettingsStore";
import { useAppStore } from "@/renderer/state/appStore";
import { usePanelStore } from "@/renderer/state/panelStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { DEFAULT_THEME_ID, VISCOSITY_SHOWCASE_THEME_ID } from "@/renderer/theme/themePresets";
import { VISCOSITY_SHELL_ATTRIBUTE } from "@/renderer/viscosity/shellFlag";
import { VISCOSITY_COMMAND_IDS } from "./commandIds";
import { effectsCommands, nextBackgroundPreset } from "./effectsCommands";
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
  useFxSettings.getState().reset();
  document.documentElement.setAttribute(VISCOSITY_SHELL_ATTRIBUTE, "");
});

afterEach(() => {
  document.documentElement.removeAttribute(VISCOSITY_SHELL_ATTRIBUTE);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Effects commands", () => {
  it("toggles the animated background on and off", async () => {
    const toggle = () => find(effectsCommands(), VISCOSITY_COMMAND_IDS.toggleBackground);
    expect(label(toggle().subtitle)).toBe("Turn the animated background off");
    await toggle().run();
    expect(useFxSettings.getState().background.enabled).toBe(false);
    expect(label(toggle().subtitle)).toBe("Turn the animated background on");
    await toggle().run();
    expect(useFxSettings.getState().background.enabled).toBe(true);
  });

  it("cycles the background style through every preset and wraps around", async () => {
    const seen: string[] = [useFxSettings.getState().background.preset];
    for (let index = 0; index < BACKGROUND_PRESETS.length; index += 1) {
      await find(effectsCommands(), VISCOSITY_COMMAND_IDS.cycleBackgroundStyle).run();
      seen.push(useFxSettings.getState().background.preset);
    }
    expect(seen).toEqual(["mesh", "particles", "aurora", "mesh"]);
    expect(nextBackgroundPreset("aurora")).toBe("mesh");
  });

  it("names the next style and turns a disabled background on when cycling", async () => {
    useFxSettings.getState().setBackground({ enabled: false, preset: "mesh" });
    const cycle = find(effectsCommands(), VISCOSITY_COMMAND_IDS.cycleBackgroundStyle);
    expect(cycle.subtitle).toMatchObject({ values: { nextStyle: "Particle field" } });
    await cycle.run();
    expect(useFxSettings.getState().background).toMatchObject({
      enabled: true,
      preset: "particles",
    });
  });

  describe("with a per-project background", () => {
    const initialAppState = useAppStore.getState();

    function focusProject(projectId: string): void {
      useAppStore.setState({
        projects: [{ id: projectId, name: "Project" } as Project],
        threads: [{ id: "thread-1", projectId } as Thread],
        view: { kind: "thread", panes: ["thread-1"] },
        focusedPaneId: "thread-1",
      });
    }

    beforeEach(() => {
      useFxSettings.getState().setBackground({ preset: "particles" });
      focusProject("project-1");
    });

    afterEach(() => {
      useAppStore.setState(initialAppState, true);
    });

    it("cycles the focused project's own style and leaves the global style alone", async () => {
      useFxSettings.getState().setProjectBackground("project-1", { preset: "aurora" });
      const cycle = () => find(effectsCommands(), VISCOSITY_COMMAND_IDS.cycleBackgroundStyle);
      expect(cycle().subtitle).toMatchObject({
        message: "Switch this project to {nextStyle}",
        values: { nextStyle: "Gradient mesh" },
      });
      await cycle().run();
      expect(useFxSettings.getState().projectBackgrounds["project-1"]).toEqual({ preset: "mesh" });
      expect(useFxSettings.getState().background.preset).toBe("particles");
      await cycle().run();
      expect(useFxSettings.getState().projectBackgrounds["project-1"]).toEqual({
        preset: "particles",
      });
      expect(useFxSettings.getState().background.preset).toBe("particles");
    });

    it("keeps the project's intensity and turns a disabled background on", async () => {
      useFxSettings.getState().setBackground({ enabled: false });
      useFxSettings
        .getState()
        .setProjectBackground("project-1", { preset: "mesh", intensity: 0.3 });
      await find(effectsCommands(), VISCOSITY_COMMAND_IDS.cycleBackgroundStyle).run();
      expect(useFxSettings.getState().projectBackgrounds["project-1"]).toEqual({
        preset: "particles",
        intensity: 0.3,
      });
      expect(useFxSettings.getState().background).toMatchObject({
        enabled: true,
        preset: "particles",
      });
    });

    it("cycles the global style when the project only overrides the intensity", async () => {
      useFxSettings.getState().setProjectBackground("project-1", { intensity: 0.3 });
      const cycle = find(effectsCommands(), VISCOSITY_COMMAND_IDS.cycleBackgroundStyle);
      expect(cycle.subtitle).toMatchObject({
        message: "Switch to {nextStyle}",
        values: { nextStyle: "Aurora grid" },
      });
      await cycle.run();
      expect(useFxSettings.getState().background.preset).toBe("aurora");
      expect(useFxSettings.getState().projectBackgrounds["project-1"]).toEqual({ intensity: 0.3 });
    });

    it("cycles the global style when another project has the override", async () => {
      useFxSettings.getState().setProjectBackground("project-2", { preset: "mesh" });
      await find(effectsCommands(), VISCOSITY_COMMAND_IDS.cycleBackgroundStyle).run();
      expect(useFxSettings.getState().background.preset).toBe("aurora");
      expect(useFxSettings.getState().projectBackgrounds["project-2"]).toEqual({ preset: "mesh" });
    });
  });

  it("toggles agent effects without touching the background", async () => {
    await find(effectsCommands(), VISCOSITY_COMMAND_IDS.toggleAgentEffects).run();
    expect(useFxSettings.getState().effects.enabled).toBe(false);
    expect(useFxSettings.getState().background.enabled).toBe(true);
    await find(effectsCommands(), VISCOSITY_COMMAND_IDS.toggleAgentEffects).run();
    expect(useFxSettings.getState().effects.enabled).toBe(true);
  });

  it("opens Settings → Effects", async () => {
    const openSettingsSection = vi.spyOn(usePanelStore.getState(), "openSettingsSection");
    await find(effectsCommands(), VISCOSITY_COMMAND_IDS.openEffectsSettings).run();
    expect(openSettingsSection).toHaveBeenCalledWith("effects");
  });

  it("hides the effect toggles outside the desktop shell but still offers Effects settings", async () => {
    document.documentElement.removeAttribute(VISCOSITY_SHELL_ATTRIBUTE);
    const before = useFxSettings.getState();
    const commands = effectsCommands();
    for (const id of [
      VISCOSITY_COMMAND_IDS.toggleBackground,
      VISCOSITY_COMMAND_IDS.cycleBackgroundStyle,
      VISCOSITY_COMMAND_IDS.toggleAgentEffects,
    ]) {
      expect(find(commands, id)).toMatchObject({ showInPalette: false, showInShortcuts: false });
      // A keybinding still resolves there; it must not write a preference this window never shows.
      await find(commands, id).run();
    }
    expect(useFxSettings.getState().background).toBe(before.background);
    expect(useFxSettings.getState().effects).toBe(before.effects);
    expect(find(commands, VISCOSITY_COMMAND_IDS.openEffectsSettings).showInPalette).not.toBe(false);
  });
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
