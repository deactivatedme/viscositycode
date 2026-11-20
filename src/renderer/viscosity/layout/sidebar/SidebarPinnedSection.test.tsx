// ViscosityCode: the Pinned section of the desktop shell sidebar.
import { fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Thread } from "@/shared/contracts";
import { useAppStore } from "@/renderer/state/appStore";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import {
  PINNED_COLLAPSED_STORAGE_KEY,
  readPinnedCollapsed,
  SidebarPinnedSection,
} from "./SidebarPinnedSection";

const tabActions = vi.hoisted(() => ({ activateThreadTab: vi.fn<(threadId: string) => void>() }));
vi.mock("../tabs/tabActions", () => tabActions);

function thread(id: string, overrides: Partial<Thread> = {}): Thread {
  return {
    id,
    projectId: "p",
    title: `Thread ${id}`,
    starred: false,
    archived: false,
    ...overrides,
  } as Thread;
}

beforeEach(() => {
  localStorage.clear();
  useAppStore.setState({
    threads: [
      thread("a", { starred: true }),
      thread("b"),
      thread("c", { starred: true, archived: true }),
      thread("d", { starred: true, projectId: "q" }),
    ],
    view: { kind: "home" } as never,
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("SidebarPinnedSection", () => {
  it("lists only starred, unarchived threads from every project and opens them", () => {
    render(<SidebarPinnedSection />);
    const rows = screen
      .getAllByRole("button")
      .filter((button) => button.className.includes("__row"));
    expect(rows.map((row) => row.textContent)).toEqual(["Thread a", "Thread d"]);
    fireEvent.click(rows[1]!);
    expect(tabActions.activateThreadTab).toHaveBeenCalledWith("d");
  });

  it("is hidden when nothing is pinned", () => {
    useAppStore.setState({ threads: [thread("b")] });
    const view = render(<SidebarPinnedSection />);
    expect(view.container).toBeEmptyDOMElement();
  });

  it("keeps the collapsed state across a remount", () => {
    const first = render(<SidebarPinnedSection />);
    fireEvent.click(screen.getByRole("button", { name: "Pinned" }));
    expect(screen.queryByText("Thread a")).toBeNull();
    first.unmount();

    render(<SidebarPinnedSection />);
    expect(screen.getByRole("button", { name: "Pinned" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.queryByText("Thread a")).toBeNull();
  });

  it("treats a missing or malformed stored value as expanded", () => {
    expect(readPinnedCollapsed()).toBe(false);
    localStorage.setItem(PINNED_COLLAPSED_STORAGE_KEY, "{oops");
    expect(readPinnedCollapsed()).toBe(false);
    render(<SidebarPinnedSection />);
    expect(screen.getByRole("button", { name: "Pinned" })).toHaveAttribute("aria-expanded", "true");
  });
});
