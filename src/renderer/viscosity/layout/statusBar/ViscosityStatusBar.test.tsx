import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project, Thread } from "@/shared/contracts";
import { useAppStore } from "@/renderer/state/appStore";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import {
  acquireViscosityShellFlag,
  VISCOSITY_SHELL_ATTRIBUTE,
} from "@/renderer/viscosity/shellFlag";
import { ViscosityStatusBarFrame } from "./ViscosityStatusBar";
import { registerStatusBarItem } from "./statusBarRegistry";

const threadActions = vi.hoisted(() => ({
  openThread: vi.fn<(threadId: string) => void>(),
  openNewThread: vi.fn<(projectId?: string) => void>(),
}));

vi.mock("@/renderer/actions/threadActions", () => threadActions);

vi.mock("@/renderer/bridge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/renderer/bridge")>()),
  readBridge: () => ({ appVersion: "9.8.7", platform: "darwin", channel: "stable" }),
}));

function thread(id: string, status: Thread["status"]): Thread {
  return { id, projectId: "p1", title: id, status, archived: false, done: false } as Thread;
}

function renderFrame() {
  return render(
    <ViscosityStatusBarFrame>
      <div data-testid="page" />
    </ViscosityStatusBarFrame>,
  );
}

beforeEach(() => {
  threadActions.openThread.mockReset();
  useAppStore.setState({
    threads: [],
    projects: [{ id: "p1", name: "Project" } as Project],
    view: { kind: "home" },
    focusedPaneId: null,
  });
});

afterEach(() => {
  delete document.documentElement.dataset.windowKind;
});

describe("ViscosityStatusBarFrame", () => {
  it("renders the page unchanged outside the desktop main window", () => {
    document.documentElement.dataset.windowKind = "thread";
    renderFrame();
    expect(screen.getByTestId("page")).toBeTruthy();
    expect(document.querySelector("[data-vc-statusbar]")).toBeNull();
  });

  it("holds html[data-vc-shell] itself, sharing it with the main shell", () => {
    document.documentElement.dataset.windowKind = "main";
    const root = document.documentElement;
    const { unmount } = renderFrame();
    // No AppShell here (for example the browser client's connection page
    // never mounts one): the bar still renders styled.
    expect(root).toHaveAttribute(VISCOSITY_SHELL_ATTRIBUTE);

    const releaseShell = acquireViscosityShellFlag(root);
    unmount();
    expect(root).toHaveAttribute(VISCOSITY_SHELL_ATTRIBUTE);
    releaseShell();
    expect(root).not.toHaveAttribute(VISCOSITY_SHELL_ATTRIBUTE);
  });

  it("never sets the shell flag outside the desktop main window", () => {
    document.documentElement.dataset.windowKind = "thread";
    renderFrame();
    expect(document.documentElement).not.toHaveAttribute(VISCOSITY_SHELL_ATTRIBUTE);
  });

  it("renders the status bar below the page in the desktop main window", () => {
    document.documentElement.dataset.windowKind = "main";
    renderFrame();
    expect(screen.getByTestId("page")).toBeTruthy();
    const bar = document.querySelector("[data-vc-statusbar]");
    expect(bar).not.toBeNull();
    expect(screen.getByRole("button", { name: "Version 9.8.7" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Switch to (light|dark) theme/ })).toBeTruthy();
  });

  it("shows agent counts and opens the first waiting thread", () => {
    document.documentElement.dataset.windowKind = "main";
    useAppStore.setState({
      threads: [
        thread("busy", "working"),
        thread("ask-1", "needs_approval"),
        thread("ask-2", "needs_reply"),
        thread("broken", "error"),
      ],
    });
    renderFrame();
    expect(screen.getByText("1 agent working")).toBeTruthy();
    expect(screen.getByRole("button", { name: "1 agent stopped with an error" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "2 agents waiting for you" }));
    expect(threadActions.openThread).toHaveBeenCalledWith("ask-1");
  });

  it("renders items registered later", () => {
    document.documentElement.dataset.windowKind = "main";
    renderFrame();
    act(() => {
      registerStatusBarItem({
        id: "test.extra",
        align: "left",
        order: 999,
        component: () => <span>extra item</span>,
      });
    });
    expect(screen.getByText("extra item")).toBeTruthy();
  });
});
