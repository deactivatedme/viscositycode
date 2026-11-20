import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project, Thread } from "@/shared/contracts";
import { useAppStore } from "@/renderer/state/appStore";
import { usePanelStore } from "@/renderer/state/panelStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { ViscosityCenterFrame } from "@/renderer/viscosity/layout/tabs/ViscosityCenterFrame";
import { acquireViscosityShellFlag } from "@/renderer/viscosity/shellFlag";
import { enterZenMode, exitZenMode, isZenModeActive } from "@/renderer/viscosity/zen/zenModeStore";
import { isRightSidebarOpen, toggleRightSidebar } from "./rightSidebarActions";

vi.mock("@/renderer/actions/threadActions", () => ({
  openThread: vi.fn<(threadId: string) => void>(),
  openNewThread: vi.fn<() => void>(),
}));

const thread = {
  id: "a",
  projectId: "p1",
  title: "Thread a",
  agentKind: "test-agent",
  status: "idle",
  archived: false,
  done: false,
} as Thread;

let releaseShell: (() => void) | undefined;

beforeEach(() => {
  useAppStore.setState({
    threads: [thread],
    projects: [{ id: "p1", name: "Project", location: { kind: "local" } } as unknown as Project],
    view: { kind: "thread", panes: ["a"] },
    focusedPaneId: "a",
  });
  useSharedSettings.setState({ terminalPosition: "bottom" });
  usePanelStore.getState().closeAllPanels();
  usePanelStore.setState({ rightPanelTab: "git", gitOverlayOpen: false });
  document.documentElement.dataset.windowKind = "main";
  // AppShell holds the flag in the app.
  releaseShell = acquireViscosityShellFlag(document.documentElement);
});

afterEach(() => {
  exitZenMode();
  releaseShell?.();
  delete document.documentElement.dataset.windowKind;
});

function showButton(): HTMLElement | null {
  return screen.queryByRole("button", { name: "Show right sidebar" });
}

describe("RightSidebarToggle", () => {
  it("sits at the end of the tab strip, opens the right sidebar, and hides while it is open", () => {
    render(
      <ViscosityCenterFrame>
        <div />
      </ViscosityCenterFrame>,
    );
    const strip = document.querySelector("[data-vc-tabstrip]")!;
    const end = strip.lastElementChild!;
    expect(end.contains(showButton())).toBe(true);

    fireEvent.click(showButton()!);
    expect(usePanelStore.getState()).toMatchObject({
      gitReviewContext: { projectId: "p1" },
      rightPanelTab: "git",
    });
    // The open panel's header has its own hide button, so the bar shows none.
    expect(showButton()).toBeNull();
    // The strip keeps its end inset, and the command still reads the open state.
    expect(strip.lastElementChild).toBe(end);
    expect(isRightSidebarOpen()).toBe(true);

    act(() => toggleRightSidebar());
    expect(usePanelStore.getState().gitReviewContext).toBeNull();
    expect(isRightSidebarOpen()).toBe(false);
    expect(end.contains(showButton())).toBe(true);
  });

  it("shows while Zen hides an open sidebar, and pressing leaves Zen", () => {
    render(
      <ViscosityCenterFrame>
        <div />
      </ViscosityCenterFrame>,
    );
    fireEvent.click(showButton()!);
    expect(showButton()).toBeNull();

    act(() => {
      enterZenMode();
    });
    expect(showButton()).not.toBeNull();

    fireEvent.click(showButton()!);
    expect(isZenModeActive()).toBe(false);
    expect(usePanelStore.getState().gitReviewContext).toMatchObject({ projectId: "p1" });
    expect(showButton()).toBeNull();
  });
});
