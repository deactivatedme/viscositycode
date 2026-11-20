// Modified for ViscosityCode (fork of Poracode). See FORK_CHANGES.md.
import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";

const bridgeMock = vi.hoisted(() => ({
  openExternal: vi.fn<(url: string) => Promise<void>>(),
  checkForUpdate: vi.fn<() => Promise<void>>(),
  installUpdate: vi.fn<() => Promise<void>>(),
}));
// ViscosityCode: remote-session About reads the paired record of the host serving the page.
const session = vi.hoisted(() => ({ remote: false }));

vi.mock("@/renderer/bridge", () => ({
  isRemoteSession: () => session.remote,
  readBridge: () => ({
    appVersion: "1.0.0",
    channel: "stable",
    electronVersion: "43.1.0",
    openExternal: bridgeMock.openExternal,
    checkForUpdate: bridgeMock.checkForUpdate,
    installUpdate: bridgeMock.installUpdate,
  }),
}));

import { useUpdateStore } from "@/renderer/state/updateStore";
import { BRAND_NAME } from "@/shared/brand";
import { UPSTREAM_REPOSITORY_URL } from "@/shared/viscosityRelease";
import { useRemoteServersStore } from "@/renderer/state/remoteServersStore";
import type { RemoteServerRecord } from "@/renderer/state/remoteServers/types";
import { AboutSettings } from "./AboutSettings";

function pairedHost(desktopId: string, endpoint: string): RemoteServerRecord {
  return { desktopId, label: desktopId, endpoint, accessToken: "token", scopes: [] };
}

describe("AboutSettings update download", () => {
  beforeEach(() => {
    useUpdateStore.setState({
      phase: "idle",
      version: null,
      downloadPercent: 0,
      errorMessage: null,
      downloadTransferred: null,
      downloadTotal: null,
      downloadBytesPerSecond: null,
    });
  });

  it("does not show a stuck 0% before the first download-progress event", () => {
    useUpdateStore.setState({ phase: "downloading", version: "1.6.3-nightly.202608160500" });
    render(<AboutSettings />);

    expect(screen.getByRole("progressbar", { name: "Downloading update" })).not.toHaveAttribute(
      "aria-valuenow",
    );
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
  });

  it("shows percent once a real total arrives", () => {
    useUpdateStore.setState({
      phase: "downloading",
      version: "1.6.3-nightly.202608160500",
      downloadPercent: 42.4,
      downloadTransferred: 424,
      downloadTotal: 1000,
    });
    render(<AboutSettings />);

    expect(screen.getByRole("progressbar", { name: "Downloading update" })).toHaveAttribute(
      "aria-valuenow",
      "42",
    );
    expect(screen.getByText("42%")).toBeInTheDocument();
  });
});

describe("AboutSettings", () => {
  beforeEach(() => {
    bridgeMock.openExternal.mockClear();
    session.remote = false;
    useRemoteServersStore.setState({ servers: [] });
  });

  it("shows app details and links without the retired data import action", () => {
    useUpdateStore.setState({ phase: "idle" });
    render(<AboutSettings />);

    expect(screen.getByText("1.0.0")).toBeVisible();
    expect(screen.getByRole("button", { name: "Check for updates" })).toBeVisible();
    expect(screen.queryByText(/Lightcode/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Import/ })).not.toBeInTheDocument();
  });

  // ViscosityCode: the fork's name, the version, and one upstream attribution line.
  it("names the fork and attributes Poracode without linking its community", () => {
    useUpdateStore.setState({ phase: "idle" });
    render(<AboutSettings />);

    expect(screen.getByLabelText(BRAND_NAME)).toBeVisible();
    const attribution = screen.getByRole("button", { name: "Based on Poracode (Apache-2.0)" });
    fireEvent.click(attribution);
    expect(bridgeMock.openExternal).toHaveBeenCalledWith(UPSTREAM_REPOSITORY_URL);

    for (const name of [/Website/, /on X/, /GitHub Repository/, /Report an Issue/]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
    expect(screen.queryByText(/All rights reserved/)).not.toBeInTheDocument();
    const visibleText = document.body.textContent ?? "";
    expect(visibleText.replace("Based on Poracode (Apache-2.0)", "")).not.toMatch(/\bPoracode/);
  });

  // ViscosityCode: the Tauri window is a remote session of its own host.
  it("shows the host version and the installer note in a remote session", () => {
    session.remote = true;
    // Another paired host chosen in Settings must not stand in for this app's version.
    useRemoteServersStore.setState({
      servers: [
        { ...pairedHost("other", "https://other.test/"), appVersion: "9.9.9" },
        { ...pairedHost("home", window.location.origin), appVersion: "2.4.0" },
      ],
    });
    useUpdateStore.setState({ phase: "idle" });
    render(<AboutSettings />);

    expect(screen.getByText("2.4.0")).toBeVisible();
    expect(screen.queryByText("1.0.0")).not.toBeInTheDocument();
    expect(screen.queryByText("9.9.9")).not.toBeInTheDocument();
    expect(screen.queryByText("Electron")).not.toBeInTheDocument();
    expect(screen.queryByText("43.1.0")).not.toBeInTheDocument();
    expect(
      screen.getByText(
        `Updates arrive as new ${BRAND_NAME} installers. Install the latest release to update.`,
      ),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: "Check for updates" })).not.toBeInTheDocument();
  });
});
