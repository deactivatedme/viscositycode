// ViscosityCode: the main sidebar's header row (nav controls + view switch).
import { act, fireEvent, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { VISCOSITY_SHELL_ATTRIBUTE } from "@/renderer/viscosity/shellFlag";
import { msg } from "@lingui/core/macro";
import { Files } from "lucide-react";
import { registerActivityBarItem } from "./activityBarRegistry";
import { ActivitySidebarViews } from "./ActivitySidebarViews";
import { DEFAULT_ACTIVITY_VIEW_ID, useActivityViewStore } from "./activityViewPreference";

const env = vi.hoisted(() => ({ macChrome: false }));

vi.mock("@/renderer/components/layout/windowChrome", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/renderer/components/layout/windowChrome")>()),
  hasMacWindowChrome: () => env.macChrome,
}));
vi.mock("@/renderer/clientRuntime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/renderer/clientRuntime")>()),
  isBrowserClientRuntime: () => false,
  hasAnyClientBridge: () => false,
  hasClientCapability: (name: string) => name === "localBackend" || name === "nativeAppUpdates",
}));
vi.mock("@/renderer/bridge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/renderer/bridge")>()),
  readBridge: () => ({ channel: "stable", checkForUpdate: async () => undefined }),
}));
vi.mock("@/renderer/views/MainView/parts/CreateProject/CreateProjectMenu", () => ({
  CreateProjectMenu: (props: { children: ReactNode }) => props.children,
}));
function header(): HTMLElement {
  const row = document.querySelector<HTMLElement>(".vc-sidebar-view-header");
  if (!row) throw new Error("header row not rendered");
  return row;
}

beforeEach(() => {
  env.macChrome = false;
  useActivityViewStore.setState({ requestedViewId: DEFAULT_ACTIVITY_VIEW_ID });
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      media: query,
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute(VISCOSITY_SHELL_ATTRIBUTE);
});

describe("ActivitySidebarViews header", () => {
  it("puts the sidebar toggle, back, forward and the view switch in one row, with no Home button", () => {
    const unregister = registerActivityBarItem({
      id: "test-room",
      label: msg`Roundtable`,
      icon: Files,
      order: 160,
      view: () => null,
    });
    render(<ActivitySidebarViews visible collapsed={false} />);
    const row = header();

    expect(row.querySelector("h2")).toHaveTextContent("Chats");
    expect(row.querySelector("h2")).toHaveClass("sr-only");
    for (const name of ["Hide sidebar", "Back", "Forward"]) {
      expect(row.contains(screen.getByRole("button", { name }))).toBe(true);
    }
    const viewSwitch = screen.getByRole("group", { name: "Sidebar view" });
    expect(row.lastElementChild).toBe(viewSwitch);
    expect(screen.getByRole("button", { name: "Chats" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Roundtable" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    // The home screen is gone, and upstream's header controls live in the nav list now.
    expect(screen.queryByRole("button", { name: /ViscosityCode/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Add project/ })).toBeNull();
    expect(document.querySelectorAll(".vc-sidebar-view-header")).toHaveLength(1);

    document.documentElement.setAttribute(VISCOSITY_SHELL_ATTRIBUTE, "");
    fireEvent.click(screen.getByRole("button", { name: "Roundtable" }));
    expect(useActivityViewStore.getState().requestedViewId).toBe("test-room");
    unregister();
  });

  it("hides the view switch while only one view is registered", () => {
    render(<ActivitySidebarViews visible collapsed={false} />);
    expect(screen.queryByRole("group", { name: "Sidebar view" })).toBeNull();
    expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
  });

  it("titles a registry view and keeps the actions beside it", () => {
    const unregister = registerActivityBarItem({
      id: "test-view",
      label: msg`Test view`,
      icon: Files,
      order: 200,
      view: () => null,
    });
    useActivityViewStore.setState({ requestedViewId: "test-view" });
    render(<ActivitySidebarViews visible collapsed={false} />);
    const row = header();
    expect(row.querySelector("h2")).toHaveTextContent("Test view");
    expect(row.contains(screen.getByRole("button", { name: "Back" }))).toBe(true);
    unregister();
  });

  it("marks the views shown while expanded and remounts the body on a view switch", () => {
    const unregisterA = registerActivityBarItem({
      id: "view-a",
      label: msg`View A`,
      icon: Files,
      order: 201,
      view: () => <p>A</p>,
    });
    const unregisterB = registerActivityBarItem({
      id: "view-b",
      label: msg`View B`,
      icon: Files,
      order: 202,
      view: () => <p>B</p>,
    });
    useActivityViewStore.setState({ requestedViewId: "view-a" });
    const { rerender } = render(<ActivitySidebarViews visible collapsed={false} />);
    const views = () => document.querySelector<HTMLElement>(".vc-sidebar-views")!;
    const body = () => document.querySelector<HTMLElement>(".vc-sidebar-view-body");
    expect(views()).toHaveAttribute("data-vc-sidebar-shown");
    const first = body();
    expect(first).toHaveTextContent("A");

    act(() => useActivityViewStore.setState({ requestedViewId: "view-b" }));
    expect(body()).toHaveTextContent("B");
    // A new element, so its entrance animation plays again (fx/motion).
    expect(body()).not.toBe(first);

    rerender(<ActivitySidebarViews visible={false} collapsed />);
    expect(views()).not.toHaveAttribute("data-vc-sidebar-shown");
    unregisterA();
    unregisterB();
  });

  it("reserves the macOS traffic-light gutter before the controls", () => {
    env.macChrome = true;
    render(<ActivitySidebarViews visible collapsed={false} />);
    const first = header().firstElementChild;
    expect(first).toHaveClass("vc-traffic-light-gutter");
    expect(first?.nextElementSibling?.tagName).toBe("H2");
  });
});
