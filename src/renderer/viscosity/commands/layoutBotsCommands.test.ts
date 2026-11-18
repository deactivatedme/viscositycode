import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppCommand } from "@/renderer/commands/registry";
import type { Project, Thread } from "@/shared/contracts";
import { useAppStore } from "@/renderer/state/appStore";
import { usePanelStore } from "@/renderer/state/panelStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { useSidebarOverlayStore } from "@/renderer/state/sidebarOverlayStore";
import { registerBotsChrome } from "@/renderer/viscosity/bots/registerBotsChrome";
import { closeBotsDialog, useBotsDialogStore } from "@/renderer/viscosity/bots/ui/botsDialogStore";
import { registerBuiltinActivityItems } from "@/renderer/viscosity/layout/activityBar/builtinActivityItems";
import { useActivityViewStore } from "@/renderer/viscosity/layout/activityBar/activityViewPreference";
import { VISCOSITY_SHELL_ATTRIBUTE } from "@/renderer/viscosity/shellFlag";
import { accountPoolCommands, botsCommands } from "./botsCommands";
import { VISCOSITY_COMMAND_IDS } from "./commandIds";
import { layoutCommands } from "./layoutCommands";

const project = { id: "project-1", name: "Project" } as Project;
const thread = {
  id: "thread-1",
  projectId: "project-1",
  agentKind: "neutral-terminal",
  presentationMode: "gui",
  title: "Chat",
} as Thread;

function find(commands: AppCommand[], id: string): AppCommand {
  const command = commands.find((entry) => entry.id === id);
  if (!command) throw new Error(`missing ${id}`);
  return command;
}

function setCollapsed(collapsed: boolean): void {
  useSidebarOverlayStore.getState().setCollapsed(collapsed);
}

beforeAll(() => {
  registerBuiltinActivityItems();
  registerBotsChrome();
});

beforeEach(() => {
  document.documentElement.setAttribute(VISCOSITY_SHELL_ATTRIBUTE, "");
  useAppStore.setState({
    projects: [project],
    threads: [thread],
    view: { kind: "thread", panes: [thread.id] },
    focusedPaneId: thread.id,
  } as never);
  useActivityViewStore.getState().setRequestedViewId("agents");
  setCollapsed(false);
  usePanelStore.getState().closeAllPanels();
  usePanelStore.setState({ gitOverlayOpen: false });
  closeBotsDialog();
});

afterEach(() => {
  document.documentElement.removeAttribute(VISCOSITY_SHELL_ATTRIBUTE);
  vi.restoreAllMocks();
});

describe("Layout commands", () => {
  it("shows a sidebar view and expands a collapsed sidebar", async () => {
    setCollapsed(true);
    await find(layoutCommands(), VISCOSITY_COMMAND_IDS.showExplorer).run();
    expect(useActivityViewStore.getState().requestedViewId).toBe("explorer");
    expect(useSidebarOverlayStore.getState().isCollapsed).toBe(false);
  });

  it("never collapses the sidebar when the view is already showing", async () => {
    await find(layoutCommands(), VISCOSITY_COMMAND_IDS.showExplorer).run();
    await find(layoutCommands(), VISCOSITY_COMMAND_IDS.showExplorer).run();
    expect(useActivityViewStore.getState().requestedViewId).toBe("explorer");
    expect(useSidebarOverlayStore.getState().isCollapsed).toBe(false);
    await find(layoutCommands(), VISCOSITY_COMMAND_IDS.showAgents).run();
    expect(useActivityViewStore.getState().requestedViewId).toBe("agents");
  });

  it("shows git review for the focused project and keeps it open when run again", async () => {
    useSharedSettings.setState({ gitReviewMode: "panel" });
    const show = () => find(layoutCommands(), VISCOSITY_COMMAND_IDS.showSourceControl).run();
    await show();
    expect(usePanelStore.getState()).toMatchObject({
      gitReviewContext: { projectId: "project-1" },
      gitReviewAsPanel: true,
      rightPanelTab: "git",
    });
    await show();
    expect(usePanelStore.getState().gitReviewContext).toMatchObject({ projectId: "project-1" });
    expect(usePanelStore.getState().rightPanelTab).toBe("git");
  });

  it("opens git review as a page when that is the user's git setting", async () => {
    useSharedSettings.setState({ gitReviewMode: "page" });
    await find(layoutCommands(), VISCOSITY_COMMAND_IDS.showSourceControl).run();
    expect(usePanelStore.getState().gitOverlayOpen).toBe(true);
  });

  it("shows the browser panel and keeps it open when run again", async () => {
    const show = () => find(layoutCommands(), VISCOSITY_COMMAND_IDS.showBrowser).run();
    await show();
    expect(usePanelStore.getState()).toMatchObject({
      browserPanelOpen: true,
      rightPanelTab: "browser",
    });
    await show();
    expect(usePanelStore.getState().browserPanelOpen).toBe(true);
  });

  it("is not offered and does nothing outside the desktop shell", async () => {
    document.documentElement.removeAttribute(VISCOSITY_SHELL_ATTRIBUTE);
    setCollapsed(true);
    const commands = layoutCommands();
    for (const command of commands) {
      expect(command).toMatchObject({ showInPalette: false, showInShortcuts: false });
      await command.run();
    }
    expect(useActivityViewStore.getState().requestedViewId).toBe("agents");
    expect(useSidebarOverlayStore.getState().isCollapsed).toBe(true);
    expect(usePanelStore.getState().browserPanelOpen).toBe(false);
    expect(usePanelStore.getState().gitReviewContext).toBeNull();
  });
});

describe("Bots and account pool commands", () => {
  it("opens the new-bot editor in place", async () => {
    await find(botsCommands(), VISCOSITY_COMMAND_IDS.newBot).run();
    expect(useBotsDialogStore.getState().dialog).toMatchObject({ kind: "editor" });
    expect(useBotsDialogStore.getState().dialog).not.toHaveProperty("botId");
    expect(useAppStore.getState().view).toEqual({ kind: "thread", panes: ["thread-1"] });
  });

  it("opens the Bots sidebar view", async () => {
    setCollapsed(true);
    await find(botsCommands(), VISCOSITY_COMMAND_IDS.openBots).run();
    expect(useActivityViewStore.getState().requestedViewId).toBe("bots");
    expect(useSidebarOverlayStore.getState().isCollapsed).toBe(false);
  });

  it("hides the Bots commands outside the desktop shell", async () => {
    document.documentElement.removeAttribute(VISCOSITY_SHELL_ATTRIBUTE);
    for (const command of botsCommands()) {
      expect(command).toMatchObject({ showInPalette: false, showInShortcuts: false });
    }
    await find(botsCommands(), VISCOSITY_COMMAND_IDS.newBot).run();
    expect(useBotsDialogStore.getState().dialog).toBeNull();
  });

  it("opens Settings → Agents, where provider profiles and account pools live", async () => {
    const openSettingsSection = vi.spyOn(usePanelStore.getState(), "openSettingsSection");
    await find(accountPoolCommands(), VISCOSITY_COMMAND_IDS.openAgentSettings).run();
    expect(openSettingsSection).toHaveBeenCalledWith("agents");
  });
});
