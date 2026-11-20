// Modified for ViscosityCode (fork of Poracode). See FORK_CHANGES.md.
import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import {
  setConfirmThreadDelete,
  shouldConfirmThreadDelete,
} from "@/renderer/state/threadDeletePreference";

const bridgeMock = vi.hoisted(() => ({
  isMac: vi.fn<() => boolean>(() => false),
  isRemoteSession: vi.fn<() => boolean>(() => false),
}));

vi.mock("@/renderer/bridge", () => ({
  isMac: bridgeMock.isMac,
  isRemoteSession: bridgeMock.isRemoteSession,
}));

// ViscosityCode: which additive keys the paired host's settings-read carried, and the Tauri window.
const viscosityMock = vi.hoisted(() => ({
  hostKeys: new Set<string>(),
  isLocalDesktopWindow: vi.fn<() => boolean>(() => false),
}));

vi.mock("@/renderer/browser/remoteSettingsSync", () => ({
  useHostReturnsRemoteSetting: (key: string) => viscosityMock.hostKeys.has(key),
}));

vi.mock("@/renderer/viscosity/localDesktopWindow", () => ({
  isLocalDesktopWindow: viscosityMock.isLocalDesktopWindow,
}));

import { ThreadSettings } from "./ThreadSettings";

describe("ThreadSettings", () => {
  beforeEach(() => {
    bridgeMock.isMac.mockReturnValue(false);
    bridgeMock.isRemoteSession.mockReturnValue(false);
    viscosityMock.hostKeys.clear();
    viscosityMock.isLocalDesktopWindow.mockReturnValue(false);
    localStorage.clear();
    useSharedSettings.setState({ followUpBehavior: "steer" });
  });

  it("shows desktop thread lifecycle controls in local sessions", () => {
    render(<ThreadSettings />);

    expect(screen.getByText("Unload idle threads after")).toBeInTheDocument();
    expect(screen.getByText("Auto-archive done threads after")).toBeInTheDocument();
    expect(screen.getByText("Default thread removal")).toBeInTheDocument();
    expect(screen.getByText("Confirm before deleting threads")).toBeInTheDocument();
    expect(screen.getByText("Max active agent sessions")).toBeInTheDocument();
    expect(screen.getByText("Max active terminal shells")).toBeInTheDocument();
    expect(screen.getByText("Max active generation helpers")).toBeInTheDocument();
    expect(screen.getByText("Follow-up behavior")).toBeInTheDocument();
    expect(screen.getByText(/Ctrl\+Enter uses the opposite action/u)).toBeInTheDocument();
  });

  it("hides desktop thread lifecycle controls in remote sessions", () => {
    bridgeMock.isRemoteSession.mockReturnValue(true);

    render(<ThreadSettings />);

    expect(screen.queryByText("Unload idle threads after")).not.toBeInTheDocument();
    // ViscosityCode: hidden while the host's settings-read omits the keys (older host).
    expect(screen.queryByText("Auto-archive done threads after")).not.toBeInTheDocument();
    expect(screen.queryByText("Mark done when the pull request merges")).not.toBeInTheDocument();
    expect(screen.queryByText("Max active agent sessions")).not.toBeInTheDocument();
    expect(screen.queryByText("Max active terminal shells")).not.toBeInTheDocument();
    expect(screen.queryByText("Max active generation helpers")).not.toBeInTheDocument();
    expect(screen.getByText("Follow-up behavior")).toBeInTheDocument();
    // ViscosityCode: device-local rows show in remote sessions; the note is window-only.
    expect(screen.getByText("Default thread removal")).toBeInTheDocument();
    expect(screen.getByText("Confirm before deleting threads")).toBeInTheDocument();
    expect(screen.queryByText(/can't be changed in this window yet/u)).not.toBeInTheDocument();
  });

  // ViscosityCode
  it("shows host-acting housekeeping rows when the host's settings-read carries them", () => {
    bridgeMock.isRemoteSession.mockReturnValue(true);
    viscosityMock.hostKeys.add("autoArchiveDoneAfterDays").add("autoMarkDoneOnPrMerge");

    render(<ThreadSettings />);

    expect(screen.getByText("Auto-archive done threads after")).toBeInTheDocument();
    expect(screen.getByText("Mark done when the pull request merges")).toBeInTheDocument();
    expect(screen.queryByText("Unload idle threads after")).not.toBeInTheDocument();
  });

  // ViscosityCode
  it("says in the desktop window why idle unloading and execution limits are missing", () => {
    bridgeMock.isRemoteSession.mockReturnValue(true);
    viscosityMock.isLocalDesktopWindow.mockReturnValue(true);

    render(<ThreadSettings />);

    expect(
      screen.getByText(
        "Idle thread unloading and execution limits can't be changed in this window yet.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Max active agent sessions")).not.toBeInTheDocument();
  });

  it("lets users choose the queued follow-up action", async () => {
    render(<ThreadSettings />);

    fireEvent.click(screen.getByLabelText("Follow-up behavior"));
    fireEvent.click(await screen.findByRole("option", { name: "Queue" }));

    expect(useSharedSettings.getState().followUpBehavior).toBe("queue");
  });

  it("uses the Mac shortcut label on macOS", () => {
    bridgeMock.isMac.mockReturnValue(true);

    render(<ThreadSettings />);

    expect(screen.getByText(/Cmd\+Enter uses the opposite action/u)).toBeInTheDocument();
  });

  it("lets users restore the delete confirmation", () => {
    setConfirmThreadDelete(false);
    render(<ThreadSettings />);

    const confirmation = screen.getByRole("switch", {
      name: "Confirm before deleting threads",
    });
    expect(confirmation).not.toBeChecked();

    fireEvent.click(confirmation);

    expect(confirmation).toBeChecked();
    expect(shouldConfirmThreadDelete()).toBe(true);
  });
});
