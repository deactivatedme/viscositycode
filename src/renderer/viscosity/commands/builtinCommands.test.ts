import type { MessageDescriptor } from "@lingui/core";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Project } from "@/shared/contracts";
import { buildCommandRegistry } from "@/renderer/commands/registry";
import { useAppStore } from "@/renderer/state/appStore";
import {
  BOTS_ACTIVITY_ITEM_ID,
  registerBotsChrome,
} from "@/renderer/viscosity/bots/registerBotsChrome";
import {
  BUILTIN_ACTIVITY_ITEM_IDS,
  registerBuiltinActivityItems,
} from "@/renderer/viscosity/layout/activityBar/builtinActivityItems";
import { VISCOSITY_SHELL_ATTRIBUTE } from "@/renderer/viscosity/shellFlag";
import { ACTIVITY_ITEM_IDS } from "./activityViews";
import { VISCOSITY_COMMAND_IDS } from "./commandIds";
import { registerBuiltinViscosityCommands } from "./registerBuiltinCommands";

const BUILTIN_IDS: string[] = Object.values(VISCOSITY_COMMAND_IDS);

/** Commands available everywhere (they do not depend on the desktop shell). */
const EVERYWHERE_IDS = new Set<string>([
  VISCOSITY_COMMAND_IDS.openEffectsSettings,
  VISCOSITY_COMMAND_IDS.themeViscosity,
  VISCOSITY_COMMAND_IDS.themeViscosityShowcase,
  VISCOSITY_COMMAND_IDS.toggleLightDark,
  VISCOSITY_COMMAND_IDS.openAgentSettings,
]);

const label = (value: string | MessageDescriptor): string =>
  typeof value === "string" ? value : (value.message ?? String(value.id));

function builtins() {
  return buildCommandRegistry().filter((command) => BUILTIN_IDS.includes(command.id));
}

beforeAll(() => {
  registerBuiltinActivityItems();
  registerBotsChrome();
  useAppStore.setState({
    projects: [{ id: "project-1", name: "Project" } as Project],
    threads: [],
  } as never);
});

afterEach(() => {
  document.documentElement.removeAttribute(VISCOSITY_SHELL_ATTRIBUTE);
});

describe("built-in ViscosityCode palette commands", () => {
  it("registers every command exactly once in the app command registry", () => {
    const registryIds = buildCommandRegistry().map((command) => command.id);
    const counts = BUILTIN_IDS.map((id) => [
      id,
      registryIds.filter((entry) => entry === id).length,
    ]);
    expect(counts).toEqual(BUILTIN_IDS.map((id) => [id, 1]));
  });

  it("does not duplicate commands when registration runs again", () => {
    registerBuiltinViscosityCommands();
    registerBuiltinViscosityCommands();
    expect(builtins()).toHaveLength(BUILTIN_IDS.length);
  });

  it("uses unique, namespaced ids that do not collide with any other command", () => {
    expect(new Set(BUILTIN_IDS).size).toBe(BUILTIN_IDS.length);
    for (const id of BUILTIN_IDS) expect(id).toMatch(/^viscosity\.[a-zA-Z]+\.[a-zA-Z]+$/);
    const registryIds = buildCommandRegistry().map((command) => command.id);
    expect(new Set(registryIds).size).toBe(registryIds.length);
  });

  it("groups every command under ViscosityCode", () => {
    for (const command of builtins()) expect(label(command.group)).toBe("ViscosityCode");
  });

  it("offers every command inside the desktop shell, with titles no other command uses", () => {
    document.documentElement.setAttribute(VISCOSITY_SHELL_ATTRIBUTE, "");
    const commands = builtins();
    expect(commands).toHaveLength(BUILTIN_IDS.length);
    expect(
      commands.filter(
        (command) => command.showInPalette === false || command.showInShortcuts === false,
      ),
    ).toEqual([]);
    const otherTitles = new Set(
      buildCommandRegistry()
        .filter((command) => !BUILTIN_IDS.includes(command.id))
        .map((command) => label(command.title).trim().toLowerCase()),
    );
    const titles = commands.map((command) => label(command.title).trim().toLowerCase());
    expect(new Set(titles).size).toBe(titles.length);
    expect(titles.filter((title) => otherTitles.has(title))).toEqual([]);
  });

  it("hides shell-only commands outside the desktop shell but keeps them registered", () => {
    const commands = builtins();
    expect(commands).toHaveLength(BUILTIN_IDS.length);
    const hiddenIds = commands
      .filter((command) => command.showInPalette === false && command.showInShortcuts === false)
      .map((command) => command.id);
    expect(hiddenIds.toSorted()).toEqual(
      BUILTIN_IDS.filter((id) => !EVERYWHERE_IDS.has(id)).toSorted(),
    );
  });

  it("targets the activity bar ids the shell registers", () => {
    expect(ACTIVITY_ITEM_IDS.agents).toBe(BUILTIN_ACTIVITY_ITEM_IDS.agents);
    expect(ACTIVITY_ITEM_IDS.explorer).toBe(BUILTIN_ACTIVITY_ITEM_IDS.explorer);
    expect(ACTIVITY_ITEM_IDS.bots).toBe(BOTS_ACTIVITY_ITEM_ID);
  });
});
