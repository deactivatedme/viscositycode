import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project, Thread } from "@/shared/contracts";
import { HOME_PROJECT_ID } from "@/shared/homeScope";
import { useAppStore } from "@/renderer/state/appStore";
import { useDevTerminalStore } from "@/renderer/state/devTerminalStore";
import { usePanelStore } from "@/renderer/state/panelStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { registerBuiltinActivityItems } from "@/renderer/viscosity/layout/activityBar/builtinActivityItems";
import { VISCOSITY_SHELL_ATTRIBUTE } from "@/renderer/viscosity/shellFlag";
import { enterZenMode, exitZenMode, isZenModeActive } from "@/renderer/viscosity/zen/zenModeStore";
import {
  resolveReopenTab,
  setRightSidebarOpenSnapshot,
  showRightSidebarTab,
  toggleRightSidebar,
} from "./rightSidebarActions";

const terminal = vi.hoisted(() => ({ showTerminalPanel: vi.fn<(projectId: string) => void>() }));
vi.mock("@/renderer/actions/terminalActions", () => terminal);

const project = { id: "project-1", name: "Project" } as Project;
const thread = {
  id: "thread-1",
  projectId: "project-1",
  agentKind: "neutral-terminal",
  presentationMode: "gui",
  title: "Chat",
} as Thread;

function focus(target: Thread = thread, projects: Project[] = [project]): void {
  useAppStore.setState({
    projects,
    threads: [target],
    view: { kind: "thread", panes: [target.id] },
    focusedPaneId: target.id,
  } as never);
}

beforeAll(() => {
  registerBuiltinActivityItems();
});

beforeEach(() => {
  document.documentElement.setAttribute(VISCOSITY_SHELL_ATTRIBUTE, "");
  focus();
  useSharedSettings.setState({ terminalPosition: "bottom", gitReviewMode: "panel" });
  usePanelStore.getState().closeAllPanels();
  usePanelStore.setState({ gitOverlayOpen: false, rightPanelTab: "git" });
  setRightSidebarOpenSnapshot(false);
  terminal.showTerminalPanel.mockReset();
});

afterEach(() => {
  exitZenMode();
  document.documentElement.removeAttribute(VISCOSITY_SHELL_ATTRIBUTE);
  vi.restoreAllMocks();
});

describe("resolveReopenTab", () => {
  const env = { terminalOnRight: false, hasRepoScope: true, browserAvailable: true };

  it("reopens the last tool tab", () => {
    for (const tab of ["git", "files", "notes", "usage", "browser"] as const) {
      expect(resolveReopenTab(tab, env)).toBe(tab);
    }
  });

  it("reopens the terminal only when it lives in the right sidebar", () => {
    expect(resolveReopenTab("terminal", env)).toBe("git");
    expect(resolveReopenTab("terminal", { ...env, terminalOnRight: true })).toBe("terminal");
  });

  it("reopens temporary tabs on Changes, and on Usage without a project", () => {
    for (const tab of ["docks", "subagent", "sideChat", "devices", "ports"] as const) {
      expect(resolveReopenTab(tab, env)).toBe("git");
    }
    const noRepo = { ...env, hasRepoScope: false };
    expect(resolveReopenTab("git", noRepo)).toBe("usage");
    expect(resolveReopenTab("files", noRepo)).toBe("usage");
    expect(resolveReopenTab("docks", noRepo)).toBe("usage");
    expect(resolveReopenTab("notes", noRepo)).toBe("notes");
    expect(resolveReopenTab("browser", { ...env, browserAvailable: false })).toBe("git");
  });
});

describe("toggleRightSidebar", () => {
  it("opens the last tab when closed and hides the sidebar when open", () => {
    toggleRightSidebar();
    expect(usePanelStore.getState()).toMatchObject({
      gitReviewContext: { projectId: "project-1" },
      gitReviewAsPanel: true,
      rightPanelTab: "git",
    });

    setRightSidebarOpenSnapshot(true);
    toggleRightSidebar();
    expect(usePanelStore.getState().gitReviewContext).toBeNull();
  });

  it("keeps a bottom terminal open, and closes a right-docked one with the sidebar", () => {
    const closePanel = vi.spyOn(useDevTerminalStore.getState(), "closePanel");
    setRightSidebarOpenSnapshot(true);
    toggleRightSidebar();
    expect(closePanel).not.toHaveBeenCalled();

    useSharedSettings.setState({ terminalPosition: "right" });
    toggleRightSidebar();
    expect(closePanel).toHaveBeenCalledTimes(1);
  });

  it("reopens a right-docked terminal on itself", () => {
    useSharedSettings.setState({ terminalPosition: "right" });
    usePanelStore.setState({ rightPanelTab: "terminal" });
    toggleRightSidebar();
    expect(terminal.showTerminalPanel).toHaveBeenCalledWith("project-1", undefined);
  });

  it("reopens on Usage in the Home scope, which has no repository", () => {
    focus({ ...thread, projectId: HOME_PROJECT_ID }, [
      { id: HOME_PROJECT_ID, name: "Home" } as Project,
    ]);
    toggleRightSidebar();
    expect(usePanelStore.getState()).toMatchObject({
      usagePanelOpen: true,
      rightPanelTab: "usage",
    });
    expect(usePanelStore.getState().gitReviewContext).toBeNull();
  });

  it("leaves Zen to reveal an open sidebar instead of closing it unseen", () => {
    toggleRightSidebar();
    setRightSidebarOpenSnapshot(true);
    enterZenMode();
    toggleRightSidebar();
    expect(isZenModeActive()).toBe(false);
    expect(usePanelStore.getState().gitReviewContext).toMatchObject({ projectId: "project-1" });
  });

  it("leaves Zen and opens a closed sidebar", () => {
    enterZenMode();
    toggleRightSidebar();
    expect(isZenModeActive()).toBe(false);
    expect(usePanelStore.getState().rightPanelTab).toBe("git");
    expect(usePanelStore.getState().gitReviewContext).toMatchObject({ projectId: "project-1" });
  });

  it("does nothing outside the desktop shell", () => {
    document.documentElement.removeAttribute(VISCOSITY_SHELL_ATTRIBUTE);
    toggleRightSidebar();
    showRightSidebarTab("notes");
    expect(usePanelStore.getState()).toMatchObject({
      gitReviewContext: null,
      notesPanelOpen: false,
    });
  });
});

describe("showRightSidebarTab", () => {
  it("never closes a tab that is already showing", () => {
    showRightSidebarTab("usage");
    showRightSidebarTab("usage");
    expect(usePanelStore.getState()).toMatchObject({
      usagePanelOpen: true,
      rightPanelTab: "usage",
    });
    showRightSidebarTab("notes");
    showRightSidebarTab("notes");
    expect(usePanelStore.getState()).toMatchObject({
      notesPanelOpen: true,
      rightPanelTab: "notes",
    });
  });

  it("shows Explorer as the Files tab of the focused project, and keeps it open", () => {
    showRightSidebarTab("files");
    showRightSidebarTab("files");
    expect(usePanelStore.getState()).toMatchObject({
      filesPanelContext: { projectId: "project-1" },
      rightPanelTab: "files",
    });
  });

  it("leaves Zen so the tab it shows is visible", () => {
    enterZenMode();
    showRightSidebarTab("notes");
    expect(isZenModeActive()).toBe(false);
    expect(usePanelStore.getState().notesPanelOpen).toBe(true);
  });

  it("pulls a bottom-docked tab back into the right sidebar", () => {
    usePanelStore.getState().setBottomPanelDock("left", "usage");
    showRightSidebarTab("usage");
    expect(usePanelStore.getState().bottomPanelDocks.left).toBeNull();
    expect(usePanelStore.getState().rightPanelTab).toBe("usage");
  });
});
