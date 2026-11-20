// Modified for ViscosityCode (fork of Poracode). See FORK_CHANGES.md.
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";

const bridgeMock = vi.hoisted(() => ({
  isRemoteSession: vi.fn<() => boolean>(() => false),
}));

vi.mock("@/renderer/bridge", () => ({
  isMac: () => false,
  isRemoteSession: bridgeMock.isRemoteSession,
}));

import { AppearanceSettings } from "./AppearanceSettings";
import { useViscosityAppearance } from "@/renderer/theme/viscosity/viscosityAppearanceStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { setAppThemeOverride } from "@/renderer/theme/applyAppTheme";
import { setPlaybookViewPrefs } from "@/renderer/viscosity/playbooks/viewPrefs";

describe("AppearanceSettings", () => {
  beforeEach(() => {
    bridgeMock.isRemoteSession.mockReturnValue(false);
    localStorage.clear();
    useViscosityAppearance.getState().setUiFont("geist");
  });

  it("shows desktop sidebar glass controls in local sessions", () => {
    render(<AppearanceSettings />);

    expect(screen.getByText("Translucent sidebar")).toBeInTheDocument();
    expect(screen.queryByLabelText("Thread docks placement")).not.toBeInTheDocument();
  });

  it("hides desktop sidebar glass controls in remote sessions", () => {
    bridgeMock.isRemoteSession.mockReturnValue(true);

    render(<AppearanceSettings />);

    expect(screen.queryByText("Translucent sidebar")).not.toBeInTheDocument();
    expect(screen.getByText("GUI chat font size")).toBeInTheDocument();
  });

  it("switches the UI font as a device-local preference", async () => {
    render(<AppearanceSettings />);

    expect(screen.getByText("UI font")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /UI font/ }));
    fireEvent.click(await screen.findByRole("option", { name: "System" }));

    await waitFor(() => expect(useViscosityAppearance.getState().uiFont).toBe("system"));
    expect(JSON.parse(localStorage.getItem("viscosity:appearance:v1")!)).toEqual({
      uiFont: "system",
    });
    expect(document.documentElement.dataset.vcUiFont).toBe("system");
  });

  it("explains a playbook theme shown instead of the saved one", () => {
    useSharedSettings.setState({ themePreset: "github", customThemes: [] });
    setPlaybookViewPrefs({ themeOverride: true });
    render(<AppearanceSettings />);
    expect(screen.queryByRole("button", { name: "Turn off playbook themes" })).toBeNull();

    act(() => setAppThemeOverride("hostile-binary"));
    expect(screen.getByRole("button", { name: "Turn off playbook themes" })).toBeInTheDocument();
    act(() => setAppThemeOverride(null));
  });
});
