// ViscosityCode: AppShell wiring of the fork sidebar chrome (the vertical rail is gone).
import { I18nProvider } from "@lingui/react";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { i18n } from "@/renderer/i18n/i18n";
import { useSidebarOverlayStore } from "@/renderer/state/sidebarOverlayStore";
import {
  markMainSidebarComponent,
  useActivityBarActive,
} from "@/renderer/viscosity/layout/activityBar/activityBarHost";
import { VISCOSITY_SHELL_ATTRIBUTE } from "@/renderer/viscosity/shellFlag";
import { AppShell } from "./AppShell";

vi.mock("@/renderer/bridge", () => ({ isMac: () => false, isWindows: () => false }));
vi.mock("./parts/usePanelVisibility", () => ({
  usePanelVisibility: () => ({ rightPanelOpen: false, gitPanelOpen: false, sidePanelOpen: false }),
}));
const overlayEffects = vi.hoisted(() => vi.fn<(options: { reservedWidth?: number }) => void>());
vi.mock("./parts/useSidebarOverlay", () => ({
  SIDEBAR_COLLAPSED_WIDTH: 48,
  useSidebarOverlayEffects: overlayEffects,
}));
vi.mock("@/renderer/hooks/useTwoRafReady", () => ({ useTwoRafReady: (active: boolean) => active }));
vi.mock("@/renderer/hooks/useGlassState", () => ({ useSidebarGlassActive: () => false }));
vi.mock("@/renderer/components/layout/windowChrome", () => ({
  hasMacWindowChrome: () => false,
  hasNativeWindowChrome: () => false,
}));
vi.mock("./parts/useResizablePanels", () => ({
  CONTENT_MIN_WIDTH: 400,
  SIDEBAR_MIN_WIDTH: 200,
  useResizablePanels: () => ({
    sidebarWidth: 250,
    panelWidth: 350,
    panelHeight: 250,
    gitPanelWidth: 350,
  }),
}));

function MainSidebar() {
  return <div>{useActivityBarActive() ? "bar active" : "rail mode"}</div>;
}
markMainSidebarComponent(MainSidebar);

function OverlaySidebar() {
  return <div>{useActivityBarActive() ? "bar active" : "rail mode"}</div>;
}

function shell(sidebar: React.ReactNode, forceSidebarExpanded = false) {
  return (
    <I18nProvider i18n={i18n}>
      <AppShell
        sidebar={sidebar}
        sidebarHeader={<div>upstream header row</div>}
        content={<div>content</div>}
        {...(forceSidebarExpanded ? { forceSidebarExpanded: true } : {})}
      />
    </I18nProvider>
  );
}

beforeEach(() => {
  document.documentElement.dataset.windowKind = "main";
  useSidebarOverlayStore.setState({
    isCollapsed: true,
    isNarrow: false,
    closingOverlay: false,
    overlayReady: false,
  });
});

afterEach(() => {
  delete document.documentElement.dataset.windowKind;
});

it("renders no rail beside the main sidebar but keeps the shell hooks", () => {
  const { container, unmount } = render(shell(<MainSidebar />));
  expect(screen.queryByRole("navigation", { name: "Activity bar" })).toBeNull();
  expect(container.querySelector(".vc-activitybar")).toBeNull();
  // No width is reserved beside the sidebar any more.
  for (const [options] of overlayEffects.mock.calls) expect(options.reservedWidth ?? 0).toBe(0);
  expect(container.querySelector(".poracode-shell")).toHaveAttribute("data-vc-activitybar");
  expect(container.querySelector(".poracode-shell")).toHaveAttribute("data-vc-sidebar-collapsed");
  expect(document.documentElement).toHaveAttribute(VISCOSITY_SHELL_ATTRIBUTE);
  expect(screen.getByText("bar active")).toBeInTheDocument();
  // The shell has no 48px rail, so a collapsed sidebar is 0 wide.
  expect(container.querySelector<HTMLElement>(".poracode-sidebar-aside")?.style.width).toBe("0px");

  unmount();
  expect(document.documentElement).not.toHaveAttribute(VISCOSITY_SHELL_ATTRIBUTE);
});

it("keeps overlay shells (Settings, Git review, …) on upstream's layout", () => {
  const { container } = render(shell(<OverlaySidebar />));
  expect(screen.queryByRole("navigation", { name: "Activity bar" })).toBeNull();
  expect(container.querySelector(".poracode-shell")).not.toHaveAttribute("data-vc-activitybar");
  expect(screen.getByText("rail mode")).toBeInTheDocument();
  expect(container.querySelector<HTMLElement>(".poracode-sidebar-aside")?.style.width).toBe("48px");
});

it("skips the fork chrome outside the main window", () => {
  document.documentElement.dataset.windowKind = "thread";
  render(shell(<MainSidebar />));
  expect(screen.queryByRole("navigation", { name: "Activity bar" })).toBeNull();
  expect(document.documentElement).not.toHaveAttribute(VISCOSITY_SHELL_ATTRIBUTE);
});

it("skips the fork chrome when the sidebar is forced expanded", () => {
  render(shell(<MainSidebar />, true));
  expect(screen.queryByRole("navigation", { name: "Activity bar" })).toBeNull();
  expect(screen.getByText("rail mode")).toBeInTheDocument();
});

it("drops upstream's titlebar header row; the main Sidebar draws one merged row", () => {
  useSidebarOverlayStore.setState({ isCollapsed: false });
  render(shell(<MainSidebar />));
  expect(screen.queryByText("upstream header row")).toBeNull();
  expect(screen.getByText("bar active")).toBeInTheDocument();
});

it("keeps upstream's header row in overlay shells", () => {
  useSidebarOverlayStore.setState({ isCollapsed: false });
  render(shell(<OverlaySidebar />));
  expect(screen.getByText("upstream header row")).toBeInTheDocument();
});

it("marks the shell while the floating sidebar is mounted, through its slide-out", () => {
  const { container } = render(shell(<MainSidebar />));
  const root = container.querySelector(".poracode-shell");
  expect(root).not.toHaveAttribute("data-vc-sidebar-overlay");

  act(() => useSidebarOverlayStore.setState({ isCollapsed: false, isNarrow: true }));
  expect(root).toHaveAttribute("data-vc-sidebar-overlay");
  expect(root).not.toHaveAttribute("data-vc-sidebar-collapsed");

  // Collapsing plays the slide-out first; the bar stays opaque until it ends.
  act(() => useSidebarOverlayStore.setState({ isCollapsed: true, closingOverlay: true }));
  expect(root).toHaveAttribute("data-vc-sidebar-overlay");

  act(() => useSidebarOverlayStore.setState({ closingOverlay: false }));
  expect(root).not.toHaveAttribute("data-vc-sidebar-overlay");
  expect(root).toHaveAttribute("data-vc-sidebar-collapsed");
});
