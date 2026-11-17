import { fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project, Thread } from "@/shared/contracts";
import { useAppStore } from "@/renderer/state/appStore";
import { type FileEditorRootContext, useFileEditorStore } from "@/renderer/state/fileEditorStore";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { useOpenTabsStore } from "./openTabsStore";
import { ViscosityCenterFrame } from "./ViscosityCenterFrame";

const threadActions = vi.hoisted(() => ({
  openThread: vi.fn<(threadId: string) => void>(),
  openNewThread: vi.fn<(projectId?: string) => void>(),
}));

vi.mock("@/renderer/actions/threadActions", () => threadActions);

function thread(id: string, overrides: Partial<Thread> = {}): Thread {
  return {
    id,
    projectId: "p1",
    title: `Thread ${id}`,
    agentKind: "test-agent",
    status: "idle",
    archived: false,
    done: false,
    ...overrides,
  } as Thread;
}

function renderCenter() {
  return render(
    <ViscosityCenterFrame>
      <div data-testid="content" />
    </ViscosityCenterFrame>,
  );
}

beforeEach(() => {
  threadActions.openThread.mockReset();
  threadActions.openNewThread.mockReset();
  useOpenTabsStore.setState({ ids: [] });
  useFileEditorStore.setState({ rootContext: null, overlayMode: null, tabs: [] });
  useAppStore.setState({
    threads: [thread("a"), thread("b", { status: "needs_reply" })],
    projects: [{ id: "p1", name: "Project", location: { kind: "local" } } as unknown as Project],
    view: { kind: "thread", panes: ["a"] },
    focusedPaneId: "a",
  });
  document.documentElement.dataset.windowKind = "main";
});

afterEach(() => {
  delete document.documentElement.dataset.windowKind;
});

describe("ViscosityTabStrip", () => {
  it("leaves the center unchanged outside the desktop main window", () => {
    document.documentElement.dataset.windowKind = "thread";
    renderCenter();
    expect(screen.getByTestId("content")).toBeTruthy();
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("opens a tab for the visible thread and marks it selected", () => {
    renderCenter();
    expect(screen.getByTestId("content")).toBeTruthy();
    const tab = screen.getByRole("tab", { name: /Thread a/ });
    expect(tab.getAttribute("aria-selected")).toBe("true");
    expect(useOpenTabsStore.getState().ids).toEqual(["a"]);
  });

  it("shows a tab's status tone and opens it in the focused pane on press", () => {
    useOpenTabsStore.setState({ ids: ["b"] });
    renderCenter();
    const tab = screen.getByRole("tab", { name: /Thread b/ });
    expect(tab.getAttribute("aria-selected")).toBe("false");
    expect(tab.querySelector('.vc-tab__dot[data-tone="attention"]')).not.toBeNull();
    fireEvent.click(tab);
    expect(threadActions.openThread).toHaveBeenCalledWith("b");
  });

  it("closes a tab with a middle click and with its close button", () => {
    useOpenTabsStore.setState({ ids: ["b"] });
    renderCenter();
    expect(useOpenTabsStore.getState().ids).toEqual(["b", "a"]);

    const tabB = screen.getByRole("tab", { name: /Thread b/ }).closest("[data-vc-tab]")!;
    fireEvent(tabB, new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 }));
    expect(useOpenTabsStore.getState().ids).toEqual(["a"]);

    fireEvent.click(screen.getByRole("button", { name: "Close Thread a" }));
    expect(useOpenTabsStore.getState().ids).toEqual([]);
    // No other tab can take the focused pane, so the existing close action runs.
    expect(useAppStore.getState().view.kind).toBe("home");
  });

  it("starts a new thread draft from the + button", () => {
    renderCenter();
    fireEvent.click(screen.getByRole("button", { name: "New thread" }));
    expect(threadActions.openNewThread).toHaveBeenCalled();
  });

  it("adds an Editor tab that toggles the file editor panel", () => {
    useFileEditorStore.setState({
      rootContext: {
        projectId: "p1",
        projectName: "Project",
        rootLabel: "Project",
      } as FileEditorRootContext,
      tabs: ["src/index.ts"],
    });
    renderCenter();
    fireEvent.click(screen.getByRole("tab", { name: "Show editor" }));
    expect(useFileEditorStore.getState().overlayMode).toBe("modal");
    expect(screen.getByRole("tab", { name: "Hide editor" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(screen.getByRole("tab", { name: /Thread a/ }).getAttribute("aria-selected")).toBe(
      "false",
    );
  });
});
