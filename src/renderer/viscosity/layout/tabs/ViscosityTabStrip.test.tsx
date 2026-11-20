import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project, Thread } from "@/shared/contracts";
import { useAppStore } from "@/renderer/state/appStore";
import { type FileEditorRootContext, useFileEditorStore } from "@/renderer/state/fileEditorStore";
import { useSidebarOverlayStore } from "@/renderer/state/sidebarOverlayStore";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { interfaceMotionAllowed } from "@/renderer/viscosity/motion";
import { resetNavHistory } from "../topBar/navHistory";
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

function title(): string | null {
  return document.querySelector("[data-vc-session-title]")?.textContent ?? null;
}

beforeEach(() => {
  threadActions.openThread.mockReset();
  threadActions.openNewThread.mockReset();
  resetNavHistory();
  useOpenTabsStore.setState({ ids: [] });
  useFileEditorStore.setState({ rootContext: null, overlayMode: null, tabs: [] });
  useSidebarOverlayStore.setState({ isCollapsed: false });
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

describe("ViscosityTabStrip (top bar)", () => {
  it("leaves the center unchanged outside the desktop main window", async () => {
    document.documentElement.dataset.windowKind = "thread";
    renderCenter();
    expect(screen.getByTestId("content")).toBeTruthy();
    expect(document.querySelector("[data-vc-tabstrip]")).toBeNull();
  });

  it("shows no thread tabs, only the session title of the focused thread", async () => {
    renderCenter();
    expect(screen.queryByRole("tab", { name: /Thread a/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "New thread" })).toBeNull();
    expect(title()).toBe("Thread a");

    await act(async () =>
      useAppStore.setState({ view: { kind: "thread", panes: ["a", "b"] }, focusedPaneId: "b" }),
    );
    expect(title()).toBe("Thread b");
  });

  it("reads New session on a draft or home", async () => {
    useAppStore.setState({ view: { kind: "draft", projectId: "p1" } as never });
    renderCenter();
    expect(title()).toBe("New session");
    await act(async () => useAppStore.setState({ view: { kind: "home" } as never }));
    expect(title()).toBe("New session");
  });

  it("keeps the Editor chip and the right sidebar toggle at the end", async () => {
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
    const bar = document.querySelector("[data-vc-tabstrip]")!;
    expect(bar.lastElementChild?.querySelector('[aria-label="Show right sidebar"]')).not.toBeNull();
  });

  it("always shows Back/Forward before the title, and the sidebar toggle first while collapsed", async () => {
    renderCenter();
    const labels = () =>
      [...document.querySelectorAll("[data-vc-tabstrip] .vc-nav-controls button")].map((button) =>
        button.getAttribute("aria-label"),
      );
    const groupBeforeTitle = () =>
      document.querySelector("[data-vc-session-title]")!.previousElementSibling!;
    expect(labels()).toEqual(["Back", "Forward"]);
    expect(groupBeforeTitle().contains(screen.getByRole("button", { name: "Forward" }))).toBe(true);

    await act(async () => useSidebarOverlayStore.setState({ isCollapsed: true }));
    expect(labels()).toEqual(["Show sidebar", "Back", "Forward"]);
    expect(groupBeforeTitle().contains(screen.getByRole("button", { name: "Forward" }))).toBe(true);
    // Far left: the same spot the header's toggle has while the sidebar is open.
    const bar = document.querySelector("[data-vc-tabstrip]")!;
    expect(
      bar.firstElementChild?.contains(screen.getByRole("button", { name: "Show sidebar" })),
    ).toBe(true);
  });

  it("feeds back/forward from the focused thread", async () => {
    renderCenter();
    expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
    await act(async () =>
      useAppStore.setState({ view: { kind: "thread", panes: ["b"] }, focusedPaneId: "b" }),
    );
    const back = screen.getByRole("button", { name: "Back" });
    expect(back).not.toBeDisabled();
    fireEvent.click(back);
    expect(threadActions.openThread).toHaveBeenCalledWith("a");
  });
});

describe("interfaceMotionAllowed", () => {
  afterEach(() => {
    document.documentElement.removeAttribute("data-vc-shell");
    vi.unstubAllGlobals();
  });

  it("is off in the shell only when the OS asks to reduce motion", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ media: query, matches: false }));
    expect(interfaceMotionAllowed()).toBe(true);
    document.documentElement.setAttribute("data-vc-shell", "");
    expect(interfaceMotionAllowed()).toBe(true);

    vi.stubGlobal("matchMedia", (query: string) => ({
      media: query,
      matches: query === "(prefers-reduced-motion: reduce)",
    }));
    expect(interfaceMotionAllowed()).toBe(false);
    document.documentElement.removeAttribute("data-vc-shell");
    // Outside the shell, upstream layouts keep their own behaviour.
    expect(interfaceMotionAllowed()).toBe(true);
  });
});
