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
import { isRightSidebarOpen } from "./rightSidebarActions";

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

describe("RightSidebarToggle", () => {
  it("sits at the end of the tab strip and opens and hides the right sidebar", () => {
    render(
      <ViscosityCenterFrame>
        <div />
      </ViscosityCenterFrame>,
    );
    const strip = document.querySelector("[data-vc-tabstrip]")!;
    const button = screen.getByRole("button", { name: "Toggle right sidebar" });
    expect(strip.lastElementChild?.contains(button)).toBe(true);
    expect(button).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(button);
    expect(usePanelStore.getState()).toMatchObject({
      gitReviewContext: { projectId: "p1" },
      rightPanelTab: "git",
    });
    expect(button).toHaveAttribute("aria-pressed", "true");
    // The command reads the same state the button shows.
    expect(isRightSidebarOpen()).toBe(true);

    fireEvent.click(button);
    expect(usePanelStore.getState().gitReviewContext).toBeNull();
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(isRightSidebarOpen()).toBe(false);
  });

  it("shows an open sidebar as closed while Zen hides it, and pressing leaves Zen", () => {
    render(
      <ViscosityCenterFrame>
        <div />
      </ViscosityCenterFrame>,
    );
    const button = screen.getByRole("button", { name: "Toggle right sidebar" });
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-pressed", "true");

    act(() => {
      enterZenMode();
    });
    expect(button).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(button);
    expect(isZenModeActive()).toBe(false);
    expect(usePanelStore.getState().gitReviewContext).toMatchObject({ projectId: "p1" });
    expect(button).toHaveAttribute("aria-pressed", "true");
  });
});
