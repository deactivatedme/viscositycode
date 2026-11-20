import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Project, Thread } from "@/shared/contracts";
import { buildCommandRegistry } from "@/renderer/commands/registry";
import { useAppStore } from "@/renderer/state/appStore";
import { VISCOSITY_SHELL_ATTRIBUTE } from "@/renderer/viscosity/shellFlag";
import { closeRoundtableSetup, useRoundtableViewStore } from "../ui/roundtableViewStore";
import { closeRoundtableInvite, useRoundtableInviteStore } from "./inviteStore";
import { INVITE_ROUNDTABLE_COMMAND_ID, NEW_ROUNDTABLE_COMMAND_ID } from "./paletteCommands";

const project = { id: "project-1", name: "Project" } as Project;
const thread = {
  id: "thread-1",
  projectId: "project-1",
  agentKind: "neutral-terminal",
  presentationMode: "terminal",
  title: "Terminal chat",
} as Thread;

function roundtableCommands() {
  return buildCommandRegistry().filter(
    (command) =>
      command.id === NEW_ROUNDTABLE_COMMAND_ID || command.id === INVITE_ROUNDTABLE_COMMAND_ID,
  );
}

beforeEach(() => {
  closeRoundtableInvite();
  closeRoundtableSetup();
  useAppStore.setState({
    projects: [project],
    threads: [thread],
    view: { kind: "thread", panes: [thread.id] },
    focusedPaneId: thread.id,
  } as never);
});

afterEach(() => {
  document.documentElement.removeAttribute(VISCOSITY_SHELL_ATTRIBUTE);
});

describe("Roundtable palette commands", () => {
  it("are registered in the command palette inside the desktop shell", () => {
    document.documentElement.setAttribute(VISCOSITY_SHELL_ATTRIBUTE, "");
    const commands = roundtableCommands();
    expect(commands.map((command) => command.id)).toEqual([
      NEW_ROUNDTABLE_COMMAND_ID,
      INVITE_ROUNDTABLE_COMMAND_ID,
    ]);
    expect(commands.map((command) => command.when)).toEqual(["hasProject", "hasThread"]);
    expect(commands.every((command) => command.showInPalette !== false)).toBe(true);
  });

  it("are not offered outside the desktop shell", () => {
    const commands = roundtableCommands();
    expect(commands).toHaveLength(2);
    expect(commands.every((command) => command.showInPalette === false)).toBe(true);
    expect(commands.every((command) => command.showInShortcuts === false)).toBe(true);
  });

  it("invites into the focused chat, terminal threads included, without switching views", async () => {
    document.documentElement.setAttribute(VISCOSITY_SHELL_ATTRIBUTE, "");
    const invite = roundtableCommands().find(
      (command) => command.id === INVITE_ROUNDTABLE_COMMAND_ID,
    );
    await invite?.run();
    expect(useRoundtableInviteStore.getState().request).toMatchObject({
      kind: "invite",
      projectId: "project-1",
      originThreadId: "thread-1",
    });
    expect(useAppStore.getState().view).toEqual({ kind: "thread", panes: ["thread-1"] });
  });

  it("opens the full setup dialog for the current project", async () => {
    document.documentElement.setAttribute(VISCOSITY_SHELL_ATTRIBUTE, "");
    const create = roundtableCommands().find((command) => command.id === NEW_ROUNDTABLE_COMMAND_ID);
    expect(create?.keywords).toEqual(expect.arrayContaining(["together", "team"]));
    await create?.run();
    expect(useRoundtableViewStore.getState().setup?.request).toEqual({ projectId: "project-1" });
    expect(useRoundtableInviteStore.getState().request).toBeNull();
  });
});
