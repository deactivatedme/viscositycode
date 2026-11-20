import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppCommand } from "@/renderer/commands/registry";
import type { Project, Thread } from "@/shared/contracts";
import { HOME_PROJECT_ID } from "@/shared/homeScope";
import { useAppStore } from "@/renderer/state/appStore";
import { usePanelStore } from "@/renderer/state/panelStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { useSidebarOverlayStore } from "@/renderer/state/sidebarOverlayStore";
import { registerBuiltinActivityItems } from "@/renderer/viscosity/layout/activityBar/builtinActivityItems";
import { useActivityViewStore } from "@/renderer/viscosity/layout/activityBar/activityViewPreference";
import { VISCOSITY_SHELL_ATTRIBUTE } from "@/renderer/viscosity/shellFlag";
import { accountPoolCommands } from "./accountPoolCommands";
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
});

afterEach(() => {
  document.documentElement.removeAttribute(VISCOSITY_SHELL_ATTRIBUTE);
  vi.restoreAllMocks();
});

describe("Layout commands", () => {
  it("shows Agents in the left sidebar and expands a collapsed sidebar", async () => {
    useActivityViewStore.getState().setRequestedViewId("roundtable");
    setCollapsed(true);
    await find(layoutCommands(), VISCOSITY_COMMAND_IDS.showAgents).run();
    expect(useActivityViewStore.getState().requestedViewId).toBe("agents");
    expect(useSidebarOverlayStore.getState().isCollapsed).toBe(false);
    // Never collapses it either.
    await find(layoutCommands(), VISCOSITY_COMMAND_IDS.showAgents).run();
    expect(useSidebarOverlayStore.getState().isCollapsed).toBe(false);
  });

  it("shows Changes in the right sidebar and keeps it open when run again", async () => {
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

  it("shows Changes in the right sidebar even when git review opens as a page", async () => {
    useSharedSettings.setState({ gitReviewMode: "page" });
    await find(layoutCommands(), VISCOSITY_COMMAND_IDS.showSourceControl).run();
    expect(usePanelStore.getState()).toMatchObject({
      gitReviewAsPanel: true,
      gitOverlayOpen: false,
      rightPanelTab: "git",
    });
  });

  it("shows Notes and Usage in the right sidebar", async () => {
    await find(layoutCommands(), VISCOSITY_COMMAND_IDS.showNotes).run();
    await find(layoutCommands(), VISCOSITY_COMMAND_IDS.showNotes).run();
    expect(usePanelStore.getState()).toMatchObject({
      notesPanelOpen: true,
      rightPanelTab: "notes",
    });
    await find(layoutCommands(), VISCOSITY_COMMAND_IDS.showUsage).run();
    expect(usePanelStore.getState()).toMatchObject({
      usagePanelOpen: true,
      rightPanelTab: "usage",
    });
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

  it("hides Changes and Explorer from the palette, not Shortcuts, and does not run them in a Home chat", async () => {
    const homeThread = { ...thread, projectId: HOME_PROJECT_ID } as Thread;
    useAppStore.setState({ threads: [homeThread] } as never);
    const commands = layoutCommands();
    for (const id of [
      VISCOSITY_COMMAND_IDS.showSourceControl,
      VISCOSITY_COMMAND_IDS.showExplorer,
    ]) {
      const command = find(commands, id);
      expect(command.showInPalette).toBe(false);
      expect(command.showInShortcuts).not.toBe(false);
      await command.run();
    }
    expect(usePanelStore.getState()).toMatchObject({
      gitReviewContext: null,
      filesPanelContext: null,
      usagePanelOpen: false,
    });
  });

  it("is not offered and does nothing outside the desktop shell", async () => {
    document.documentElement.removeAttribute(VISCOSITY_SHELL_ATTRIBUTE);
    useActivityViewStore.getState().setRequestedViewId("roundtable");
    setCollapsed(true);
    const commands = layoutCommands();
    for (const command of commands) {
      expect(command).toMatchObject({ showInPalette: false, showInShortcuts: false });
      await command.run();
    }
    expect(useActivityViewStore.getState().requestedViewId).toBe("roundtable");
    expect(useSidebarOverlayStore.getState().isCollapsed).toBe(true);
    expect(usePanelStore.getState()).toMatchObject({
      browserPanelOpen: false,
      gitReviewContext: null,
      filesPanelContext: null,
      notesPanelOpen: false,
      usagePanelOpen: false,
    });
  });
});

describe("Account pool commands", () => {
  it("opens Settings → Agents, where provider profiles and account pools live", async () => {
    const openSettingsSection = vi.spyOn(usePanelStore.getState(), "openSettingsSection");
    await find(accountPoolCommands(), VISCOSITY_COMMAND_IDS.openAgentSettings).run();
    expect(openSettingsSection).toHaveBeenCalledWith("agents");
  });
});
