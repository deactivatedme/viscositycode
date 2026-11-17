import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const layout = vi.hoisted(() => ({ compact: false, chatSidebar: false }));

vi.mock("@/renderer/adaptiveLayout", () => ({ useCompactLayout: () => layout.compact }));
vi.mock("@/renderer/clientSurface", () => ({ isChatSidebarSurface: () => layout.chatSidebar }));

import {
  acquireViscosityShellFlag,
  isViscosityShellActive,
  shouldEnableViscosityShell,
  useViscosityShellFlag,
  VISCOSITY_SHELL_ATTRIBUTE,
} from "./shellFlag";

afterEach(() => {
  layout.compact = false;
  layout.chatSidebar = false;
  delete document.documentElement.dataset.windowKind;
  document.documentElement.removeAttribute(VISCOSITY_SHELL_ATTRIBUTE);
});

describe("shouldEnableViscosityShell", () => {
  const desktopMain = { windowKind: "main", compactLayout: false, chatSidebarSurface: false };

  it("applies to the main window's desktop layout", () => {
    expect(shouldEnableViscosityShell(desktopMain)).toBe(true);
  });

  it.each(["thread", "sideChat", "quickComposer", "browserExtract", undefined])(
    "does not apply to the %s window",
    (windowKind) => {
      expect(shouldEnableViscosityShell({ ...desktopMain, windowKind })).toBe(false);
    },
  );

  it("does not apply to the compact phone/PWA layout", () => {
    expect(shouldEnableViscosityShell({ ...desktopMain, compactLayout: true })).toBe(false);
  });

  it("does not apply to the Chrome-extension side panel", () => {
    expect(shouldEnableViscosityShell({ ...desktopMain, chatSidebarSurface: true })).toBe(false);
  });
});

describe("acquireViscosityShellFlag", () => {
  it("keeps the attribute until every holder releases it", () => {
    const root = document.createElement("html");
    const releaseMain = acquireViscosityShellFlag(root);
    const releaseOverlay = acquireViscosityShellFlag(root);
    expect(root.hasAttribute(VISCOSITY_SHELL_ATTRIBUTE)).toBe(true);

    releaseOverlay();
    releaseOverlay();
    expect(root.hasAttribute(VISCOSITY_SHELL_ATTRIBUTE)).toBe(true);

    releaseMain();
    expect(root.hasAttribute(VISCOSITY_SHELL_ATTRIBUTE)).toBe(false);
  });
});

describe("useViscosityShellFlag", () => {
  it("sets html[data-vc-shell] for the main desktop window and removes it on unmount", () => {
    document.documentElement.dataset.windowKind = "main";
    const { result, unmount } = renderHook(() => useViscosityShellFlag());
    expect(result.current).toBe(true);
    expect(isViscosityShellActive()).toBe(true);

    unmount();
    expect(isViscosityShellActive()).toBe(false);
  });

  it("removes the attribute when the window drops into the compact layout", () => {
    document.documentElement.dataset.windowKind = "main";
    const { result, rerender } = renderHook(() => useViscosityShellFlag());
    expect(isViscosityShellActive()).toBe(true);

    layout.compact = true;
    rerender();
    expect(result.current).toBe(false);
    expect(isViscosityShellActive()).toBe(false);
  });

  it("never sets the attribute in a thread window", () => {
    document.documentElement.dataset.windowKind = "thread";
    const { result } = renderHook(() => useViscosityShellFlag());
    expect(result.current).toBe(false);
    expect(isViscosityShellActive()).toBe(false);
  });
});
