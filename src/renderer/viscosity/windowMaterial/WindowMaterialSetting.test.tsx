import type { ReactElement } from "react";
import { I18nProvider } from "@lingui/react";
import { render as renderBare, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_WINDOW_MATERIAL, useWindowMaterialStore } from "./windowMaterialStore";

const env = vi.hoisted(() => ({
  windows: true,
  remote: false,
  browser: false,
  translucency: true,
  electron: true,
}));

vi.mock("@/renderer/bridge", () => ({
  isWindows: () => env.windows,
  isRemoteSession: () => env.remote,
}));

vi.mock(import("@/renderer/clientRuntime"), async (importOriginal) => ({
  ...(await importOriginal()),
  hasElectronHostBridge: () => env.electron,
  isBrowserClientRuntime: () => env.browser,
}));

vi.mock("@/renderer/state/sharedSettingsStore", () => ({
  useSharedSettings: (selector: (state: { sidebarTranslucency: boolean }) => unknown) =>
    selector({ sidebarTranslucency: env.translucency }),
}));

import { i18n } from "@/renderer/i18n/i18n";
import { WindowMaterialSetting, shouldShowWindowMaterialSetting } from "./WindowMaterialSetting";

function render(ui: ReactElement) {
  return renderBare(<I18nProvider i18n={i18n}>{ui}</I18nProvider>);
}

beforeEach(() => {
  env.windows = true;
  env.remote = false;
  env.browser = false;
  env.translucency = true;
  env.electron = true;
  useWindowMaterialStore.setState({ preference: DEFAULT_WINDOW_MATERIAL });
});

describe("shouldShowWindowMaterialSetting", () => {
  const desktopWindows = {
    hasDesktopBridge: true,
    browserRuntime: false,
    remoteSession: false,
    windows: true,
  };

  it("shows only in the Windows desktop app", () => {
    expect(shouldShowWindowMaterialSetting(desktopWindows)).toBe(true);
    expect(shouldShowWindowMaterialSetting({ ...desktopWindows, windows: false })).toBe(false);
    expect(shouldShowWindowMaterialSetting({ ...desktopWindows, browserRuntime: true })).toBe(
      false,
    );
    expect(shouldShowWindowMaterialSetting({ ...desktopWindows, remoteSession: true })).toBe(false);
    expect(shouldShowWindowMaterialSetting({ ...desktopWindows, hasDesktopBridge: false })).toBe(
      false,
    );
  });
});

describe("WindowMaterialSetting", () => {
  it("renders the material row with the stored preference on Windows", () => {
    useWindowMaterialStore.setState({ preference: "acrylic" });
    const { container } = render(<WindowMaterialSetting />);
    expect(screen.getByText("Window material")).toBeInTheDocument();
    const select = container.querySelector("select");
    expect(select).toHaveValue("acrylic");
    expect(select).not.toBeDisabled();
  });

  it.each([
    ["macOS", () => (env.windows = false)],
    ["the browser client", () => (env.browser = true)],
    ["a remote session", () => (env.remote = true)],
    ["a page without the Electron host bridge", () => (env.electron = false)],
  ])("is hidden on %s", (_label, arrange) => {
    arrange();
    const { container } = render(<WindowMaterialSetting />);
    expect(container).toBeEmptyDOMElement();
  });

  it("explains that the backdrop needs the translucent sidebar", () => {
    env.translucency = false;
    const { container } = render(<WindowMaterialSetting />);
    expect(
      screen.getByText("Turn on Translucent sidebar to use a Windows 11 backdrop."),
    ).toBeInTheDocument();
    expect(container.querySelector("select")).toBeDisabled();
  });
});
