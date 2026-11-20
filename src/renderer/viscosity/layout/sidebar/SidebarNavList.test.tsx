// ViscosityCode: the desktop shell sidebar's nav list (New, registry rows, More, Projects).
import { msg } from "@lingui/core/macro";
import { fireEvent, screen, within } from "@testing-library/react";
import { Files, Radar, Search } from "lucide-react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import {
  ACTIVITY_HOST_VIEW,
  clearActivityBarRegistry,
  registerActivityBarItem,
} from "../activityBar/activityBarRegistry";
import { SidebarNavList } from "./SidebarNavList";

const tabActions = vi.hoisted(() => ({ openNewThreadTab: vi.fn<() => void>() }));
vi.mock("../tabs/tabActions", () => tabActions);
vi.mock("@/renderer/clientRuntime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/renderer/clientRuntime")>()),
  isBrowserClientRuntime: () => false,
  hasAnyClientBridge: () => false,
  hasClientCapability: (name: string) => name === "localBackend",
}));
vi.mock("@/renderer/bridge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/renderer/bridge")>()),
  readBridge: () => ({ channel: "stable", checkForUpdate: async () => undefined }),
  isDevApp: () => false,
  isRemoteSession: () => false,
}));
vi.mock("@/renderer/views/MainView/parts/CreateProject/CreateProjectMenu", () => ({
  CreateProjectMenu: (props: { children: ReactNode }) => props.children,
}));

const search = vi.fn<() => void>();
const missionControl = vi.fn<() => void>();
const subscriptions = vi.fn<() => void>();

beforeEach(() => {
  useSharedSettings.setState({
    sidebarShortcutOrder: ["pullRequests"],
    sidebarHiddenShortcuts: [],
  });
  registerActivityBarItem({
    id: "agents",
    label: msg`Chats`,
    icon: Files,
    order: 100,
    view: ACTIVITY_HOST_VIEW,
  });
  registerActivityBarItem({
    id: "search",
    label: msg`Search`,
    icon: Search,
    order: 90,
    action: search,
  });
  registerActivityBarItem({
    id: "mission-control",
    label: msg`Mission Control`,
    icon: Radar,
    order: 110,
    action: missionControl,
    toggle: true,
    useIsActive: () => true,
    useBadge: () => 3,
  });
  registerActivityBarItem({
    id: "subscriptions",
    label: msg`Subscriptions`,
    icon: Files,
    order: 100,
    position: "bottom",
    action: subscriptions,
  });
});

afterEach(() => {
  clearActivityBarRegistry();
  vi.clearAllMocks();
});

describe("SidebarNavList", () => {
  it("lists New, then the top actions in order, then More; views and Settings are not rows", () => {
    render(<SidebarNavList />);
    const nav = screen.getByRole("navigation", { name: "Sidebar" });
    const rows = [...nav.querySelectorAll("button")].map(
      (button) => button.getAttribute("aria-label") ?? button.textContent,
    );
    expect(rows).toEqual(["New", "Search", "Mission Control (3)", "More"]);
    expect(screen.queryByRole("button", { name: "Settings" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Chats" })).toBeNull();
  });

  it("runs New and the actions, with the toggle's state and badge", () => {
    render(<SidebarNavList />);
    const nav = within(screen.getByRole("navigation", { name: "Sidebar" }));
    const fresh = nav.getByRole("button", { name: "New" });
    fireEvent.click(fresh);
    expect(tabActions.openNewThreadTab).toHaveBeenCalledTimes(1);
    // New never looks selected: the same plain row as Search, with no state of its own.
    expect(fresh.className).toBe(nav.getByRole("button", { name: "Search" }).className);
    expect(fresh).not.toHaveAttribute("data-active");
    expect(fresh).not.toHaveAttribute("aria-pressed");
    fireEvent.click(nav.getByRole("button", { name: "Search" }));
    expect(search).toHaveBeenCalledTimes(1);
    const mission = nav.getByRole("button", { name: "Mission Control (3)" });
    expect(mission).toHaveAttribute("aria-pressed", "true");
    expect(mission).toHaveTextContent("3");
    expect(nav.getByRole("button", { name: "Search" })).not.toHaveAttribute("aria-pressed");
  });

  it("lists the bottom items and the sidebar shortcuts under More", () => {
    render(<SidebarNavList />);
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(screen.getByRole("menuitem", { name: "Pull requests" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "Subscriptions" }));
    expect(subscriptions).toHaveBeenCalledTimes(1);
  });

  it("puts upstream's header controls in the Projects row", () => {
    render(<SidebarNavList />);
    const row = document.querySelector(".vc-sidebar-projects")!;
    expect(row).toHaveTextContent("Projects");
    expect(row.contains(screen.getByRole("button", { name: /Add project/ }))).toBe(true);
  });
});
