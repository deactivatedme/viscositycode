// ViscosityCode: the stable data attributes AppShell renders for fork styles
// (zen.css finds the shell's chrome through these, never DOM position).
import { I18nProvider } from "@lingui/react";
import { act, render } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { i18n } from "@/renderer/i18n/i18n";
import { useSidebarOverlayStore } from "@/renderer/state/sidebarOverlayStore";
import { AppShell } from "./AppShell";

const panels = vi.hoisted(() => ({ rightPanelOpen: true, gitPanelOpen: true }));

vi.mock("@/renderer/bridge", () => ({ isMac: () => false, isWindows: () => false }));
vi.mock("./parts/usePanelVisibility", () => ({
  usePanelVisibility: () => ({ ...panels, sidePanelOpen: false }),
}));
vi.mock("./parts/useSidebarOverlay", () => ({
  SIDEBAR_COLLAPSED_WIDTH: 48,
  useSidebarOverlayEffects: () => {},
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

function shell() {
  return (
    <I18nProvider i18n={i18n}>
      <AppShell
        sidebar={<div>sidebar</div>}
        contentHeader={<div>content header</div>}
        content={<div>content</div>}
        rightPanel={<div>right panel</div>}
        gitPanel={<div>git panel</div>}
      />
    </I18nProvider>
  );
}

beforeEach(() => {
  panels.rightPanelOpen = true;
  panels.gitPanelOpen = true;
  useSidebarOverlayStore.setState({
    isCollapsed: false,
    isNarrow: false,
    closingOverlay: false,
    overlayReady: false,
  });
});

it("tags the right and git panels, their resize handles, the sidebar handle and the content header", () => {
  const { container } = render(shell());
  const right = container.querySelector('aside[data-vc-panel-slot="right"]');
  const git = container.querySelector('aside[data-vc-panel-slot="git"]');
  expect(right).toHaveTextContent("right panel");
  expect(git).toHaveTextContent("git panel");
  expect(container.querySelector('[data-vc-panel-handle="right"]')).toHaveAttribute(
    "role",
    "separator",
  );
  expect(container.querySelector('[data-vc-panel-handle="git"]')).toHaveAttribute(
    "role",
    "separator",
  );
  expect(container.querySelector("[data-vc-sidebar-handle]")).toHaveClass("poracode-resize-handle");
  expect(container.querySelector("[data-vc-content-header]")).toHaveTextContent("content header");
  // The sidebar's own aside keeps its upstream class; only the right/git slots carry the hook.
  expect(container.querySelectorAll("[data-vc-panel-slot]")).toHaveLength(2);
});

it("tags the floating sidebar's backdrop", () => {
  const { container } = render(shell());
  expect(container.querySelector("[data-vc-sidebar-backdrop]")).toBeNull();
  act(() => useSidebarOverlayStore.setState({ isNarrow: true }));
  expect(container.querySelector("[data-vc-sidebar-backdrop]")).toHaveAttribute(
    "aria-hidden",
    "true",
  );
});
