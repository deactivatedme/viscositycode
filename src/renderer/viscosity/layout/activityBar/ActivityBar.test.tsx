import { msg } from "@lingui/core/macro";
import { fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSidebarOverlayStore } from "@/renderer/state/sidebarOverlayStore";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { ActivityBar } from "./ActivityBar";
import { isMainSidebarElement, markMainSidebarComponent } from "./activityBarHost";
import {
  ACTIVITY_HOST_VIEW,
  clearActivityBarRegistry,
  registerActivityBarItem,
} from "./activityBarRegistry";
import { DEFAULT_ACTIVITY_VIEW_ID, useActivityViewStore } from "./activityViewPreference";

function Icon(props: { className?: string }) {
  return <svg aria-hidden="true" className={props.className} />;
}

function ExplorerView() {
  return null;
}

const search = vi.fn<() => void>();
const sourceControl = { open: false };

beforeEach(() => {
  localStorage.clear();
  useActivityViewStore.setState({ requestedViewId: DEFAULT_ACTIVITY_VIEW_ID });
  useSidebarOverlayStore.setState({
    isCollapsed: false,
    userCollapsed: false,
    isAutoCollapsed: false,
    isNarrow: false,
    closingOverlay: false,
  });
  registerActivityBarItem({
    id: "agents",
    label: msg`Agents`,
    icon: Icon,
    order: 100,
    view: ACTIVITY_HOST_VIEW,
  });
  registerActivityBarItem({
    id: "explorer",
    label: msg`Explorer`,
    icon: Icon,
    order: 200,
    view: ExplorerView,
  });
  registerActivityBarItem({
    id: "search",
    label: msg`Search`,
    icon: Icon,
    order: 300,
    action: search,
    useBadge: () => 4,
  });
  registerActivityBarItem({
    id: "source-control",
    label: msg`Source Control`,
    icon: Icon,
    order: 400,
    action: () => {},
    toggle: true,
    useIsActive: () => sourceControl.open,
  });
  registerActivityBarItem({
    id: "browser",
    label: msg`Browser`,
    icon: Icon,
    order: 500,
    action: () => {},
    useIsAvailable: () => false,
  });
  registerActivityBarItem({
    id: "settings",
    label: msg`Settings`,
    icon: Icon,
    order: 1000,
    position: "bottom",
    action: () => {},
    useIsActive: () => true,
  });
});

afterEach(() => {
  clearActivityBarRegistry();
  search.mockReset();
  sourceControl.open = false;
});

describe("ActivityBar", () => {
  it("renders registered items in order, bottom group last, hiding unavailable ones", () => {
    render(<ActivityBar />);
    const nav = screen.getByRole("navigation", { name: "Activity bar" });
    const ids = [...nav.querySelectorAll("button")].map((button) =>
      button.getAttribute("data-vc-activity-item"),
    );
    expect(ids).toEqual(["agents", "explorer", "search", "source-control", "settings"]);
  });

  it("marks the shown view with aria-current and an active indicator", () => {
    render(<ActivityBar />);
    const agents = screen.getByRole("button", { name: "Agents" });
    expect(agents).toHaveAttribute("aria-current", "page");
    expect(agents.closest(".vc-activitybar__slot")).toHaveAttribute("data-active");
    expect(screen.getByRole("button", { name: "Explorer" })).not.toHaveAttribute("aria-current");
  });

  it("switches views, collapses on the active view and reopens from collapsed", () => {
    render(<ActivityBar />);
    fireEvent.click(screen.getByRole("button", { name: "Explorer" }));
    expect(useActivityViewStore.getState().requestedViewId).toBe("explorer");
    expect(screen.getByRole("button", { name: "Explorer" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    fireEvent.click(screen.getByRole("button", { name: "Explorer" }));
    expect(useSidebarOverlayStore.getState().isCollapsed).toBe(true);
    // No item is "current" while the sidebar is hidden.
    expect(screen.getByRole("button", { name: "Explorer" })).not.toHaveAttribute("aria-current");

    fireEvent.click(screen.getByRole("button", { name: "Agents" }));
    expect(useSidebarOverlayStore.getState().isCollapsed).toBe(false);
    expect(screen.getByRole("button", { name: "Agents" })).toHaveAttribute("aria-current", "page");
  });

  it("runs action items, shows their badge and active state", () => {
    render(<ActivityBar />);
    const searchButton = screen.getByRole("button", { name: "Search (4)" });
    expect(searchButton).toHaveTextContent("4");
    fireEvent.click(searchButton);
    expect(search).toHaveBeenCalledTimes(1);

    const settings = screen.getByRole("button", { name: "Settings" });
    expect(settings).toHaveAttribute("data-active");
    expect(settings).not.toHaveAttribute("aria-current");
  });

  it("exposes aria-pressed on toggle items only, and aria-current on view items only", () => {
    const { rerender } = render(<ActivityBar />);
    const toggle = screen.getByRole("button", { name: "Source Control" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(toggle).not.toHaveAttribute("aria-current");

    sourceControl.open = true;
    rerender(<ActivityBar />);
    expect(screen.getByRole("button", { name: "Source Control" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // Plain actions (Search, Settings) and views (Agents) are not toggle buttons.
    for (const name of ["Search (4)", "Settings", "Agents", "Explorer"]) {
      expect(screen.getByRole("button", { name })).not.toHaveAttribute("aria-pressed");
    }
    expect(screen.getByRole("button", { name: "Agents" })).toHaveAttribute("aria-current", "page");
  });
});

describe("main sidebar marker", () => {
  it("recognises only elements of a marked component", () => {
    function MainSidebar() {
      return null;
    }
    function OverlaySidebar() {
      return null;
    }
    markMainSidebarComponent(MainSidebar);
    expect(isMainSidebarElement(<MainSidebar />)).toBe(true);
    expect(isMainSidebarElement(<OverlaySidebar />)).toBe(false);
    expect(isMainSidebarElement(<div />)).toBe(false);
    expect(isMainSidebarElement("text")).toBe(false);
    expect(isMainSidebarElement(null)).toBe(false);
  });
});
