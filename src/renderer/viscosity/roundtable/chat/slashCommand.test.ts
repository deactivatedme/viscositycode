import { afterEach, describe, expect, it } from "vitest";
import {
  resolveAvailableSlashCommands,
  resolveLocalSlashCommandAction,
} from "@/renderer/components/thread/threadSlashCommands";
import { VISCOSITY_SHELL_ATTRIBUTE } from "@/renderer/viscosity/shellFlag";
import { parseRoundtableCommand, resolveRoundtableSlashAction } from "./slashCommand";

const gui = {
  agentKind: "neutral-gui",
  presentationMode: "gui" as const,
  supportsRoundtable: true,
};

afterEach(() => {
  document.documentElement.removeAttribute(VISCOSITY_SHELL_ATTRIBUTE);
});

describe("parseRoundtableCommand", () => {
  it("takes the text after the command as the task", () => {
    expect(parseRoundtableCommand("/roundtable fix the flaky test")).toEqual({
      task: "fix the flaky test",
    });
    expect(parseRoundtableCommand("  /ROUNDTABLE\n  review the PR ")).toEqual({
      task: "review the PR",
    });
    expect(parseRoundtableCommand("/roundtable")).toEqual({ task: "" });
  });

  it("only matches the exact leading command", () => {
    expect(parseRoundtableCommand("/roundtables now")).toBeNull();
    expect(parseRoundtableCommand("let's /roundtable this")).toBeNull();
    expect(parseRoundtableCommand("/btw roundtable")).toBeNull();
  });
});

describe("/roundtable as an app-owned GUI command", () => {
  it("is suggested and resolved in GUI chats that can host a Roundtable", () => {
    expect(resolveAvailableSlashCommands([], [], gui).map((command) => command.id)).toEqual([
      "roundtable",
    ]);
    expect(resolveLocalSlashCommandAction("/roundtable compare approaches", gui)).toEqual({
      kind: "open-roundtable",
      task: "compare approaches",
    });
  });

  it("never intercepts terminal input or surfaces that cannot host one", () => {
    const terminal = { ...gui, presentationMode: "terminal" as const };
    expect(resolveLocalSlashCommandAction("/roundtable go", terminal)).toBeNull();
    expect(resolveAvailableSlashCommands([], [], terminal)).toEqual([]);
    const isolated = { ...gui, supportsRoundtable: false };
    expect(resolveLocalSlashCommandAction("/roundtable go", isolated)).toBeNull();
    expect(resolveAvailableSlashCommands([], [], isolated)).toEqual([]);
  });

  it("defaults to the desktop shell flag when the composer does not say", () => {
    const unspecified = { agentKind: "neutral-gui", presentationMode: "gui" as const };
    expect(resolveRoundtableSlashAction("/roundtable go", unspecified)).toBeNull();
    document.documentElement.setAttribute(VISCOSITY_SHELL_ATTRIBUTE, "");
    expect(resolveRoundtableSlashAction("/roundtable go", unspecified)).toEqual({
      kind: "open-roundtable",
      task: "go",
    });
    expect(
      resolveAvailableSlashCommands([], [], unspecified).map((command) => command.id),
    ).toContain("roundtable");
  });

  it("reserves the name so a provider command of the same name is listed once", () => {
    const listed = resolveAvailableSlashCommands(
      [{ id: "roundtable", label: "Provider command" }],
      [],
      gui,
    ).filter((command) => command.id === "roundtable");
    expect(listed).toHaveLength(1);
    expect(listed[0]?.label).not.toBe("Provider command");
  });

  it("keeps /btw working beside it", () => {
    const both = { ...gui, supportsSideChat: true };
    expect(resolveAvailableSlashCommands([], [], both).map((command) => command.id)).toEqual([
      "btw",
      "roundtable",
    ]);
    expect(resolveLocalSlashCommandAction("/btw why?", both)).toEqual({
      kind: "open-side-chat",
      prompt: "why?",
    });
  });
});
