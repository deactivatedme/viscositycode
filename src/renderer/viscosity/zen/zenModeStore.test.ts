import { i18n } from "@lingui/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { viscosityCommands } from "@/renderer/viscosity/commands/viscosityCommands";
import {
  acquireViscosityShellFlag,
  VISCOSITY_SHELL_ATTRIBUTE,
} from "@/renderer/viscosity/shellFlag";
import { registerZenMode } from "./registerZenMode";
import { TOGGLE_ZEN_MODE_COMMAND_ID } from "./zenCommands";
import {
  enterZenMode,
  exitZenMode,
  isZenModeActive,
  toggleZenMode,
  useZenModeStore,
  ZEN_ATTRIBUTE,
} from "./zenModeStore";

const root = document.documentElement;
let releaseShell: (() => void) | null = null;

function enableShell(): void {
  releaseShell = acquireViscosityShellFlag(root);
}

function zenCommand() {
  return viscosityCommands().find((command) => command.id === TOGGLE_ZEN_MODE_COMMAND_ID);
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  exitZenMode();
  releaseShell?.();
  releaseShell = null;
  root.removeAttribute(VISCOSITY_SHELL_ATTRIBUTE);
});

describe("zen mode state", () => {
  it("starts off", () => {
    expect(isZenModeActive()).toBe(false);
    expect(root.hasAttribute(ZEN_ATTRIBUTE)).toBe(false);
  });

  it("toggles html[data-vc-zen] in the desktop shell", () => {
    enableShell();
    toggleZenMode();
    expect(isZenModeActive()).toBe(true);
    expect(root.hasAttribute(ZEN_ATTRIBUTE)).toBe(true);

    toggleZenMode();
    expect(isZenModeActive()).toBe(false);
    expect(root.hasAttribute(ZEN_ATTRIBUTE)).toBe(false);
  });

  it("stays off outside the desktop shell (compact/PWA, secondary windows)", () => {
    expect(enterZenMode()).toBe(false);
    toggleZenMode();
    expect(isZenModeActive()).toBe(false);
    expect(root.hasAttribute(ZEN_ATTRIBUTE)).toBe(false);
  });

  it("is transient: nothing is written to local storage", () => {
    enableShell();
    toggleZenMode();
    toggleZenMode();
    expect(localStorage.length).toBe(0);
  });

  it("clears a stray attribute on exit even when the store is already off", () => {
    root.setAttribute(ZEN_ATTRIBUTE, "");
    exitZenMode();
    expect(root.hasAttribute(ZEN_ATTRIBUTE)).toBe(false);
  });

  it("notifies subscribers once per change", () => {
    enableShell();
    const seen: boolean[] = [];
    const unsubscribe = useZenModeStore.subscribe((state) => seen.push(state.active));
    enterZenMode();
    enterZenMode();
    exitZenMode();
    exitZenMode();
    unsubscribe();
    expect(seen).toEqual([true, false]);
  });
});

describe("Toggle Zen mode command", () => {
  it("is registered once and toggles zen mode", async () => {
    registerZenMode();
    registerZenMode();
    enableShell();
    const matches = viscosityCommands().filter(
      (command) => command.id === TOGGLE_ZEN_MODE_COMMAND_ID,
    );
    expect(matches).toHaveLength(1);
    const command = zenCommand();
    expect(typeof command?.title === "string" ? command.title : i18n._(command!.title)).toBe(
      "Toggle Zen mode",
    );
    expect(command?.showInPalette).toBeUndefined();

    await command?.run();
    expect(isZenModeActive()).toBe(true);
    await command?.run();
    expect(isZenModeActive()).toBe(false);
  });

  it("is hidden from the palette and shortcuts outside the desktop shell", () => {
    registerZenMode();
    const command = zenCommand();
    expect(command?.showInPalette).toBe(false);
    expect(command?.showInShortcuts).toBe(false);
  });
});
