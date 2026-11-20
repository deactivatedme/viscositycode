// Modified for ViscosityCode (fork of Poracode). See FORK_CHANGES.md.
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import type { MachineDescriptor } from "@/renderer/state/machines";
import { AgentsGeneralSettings } from "./AgentsGeneralSettings";

const mocks = vi.hoisted(() => ({
  rediscover: vi.fn<(distros: string[]) => Promise<unknown>>(),
  host: vi.fn<(machine: MachineDescriptor) => void>(),
  danger: vi.fn<(message: string) => void>(),
}));
let machine: MachineDescriptor;
vi.mock("@/renderer/state/machines", () => ({ useSelectedMachine: () => machine }));
vi.mock("@/renderer/components/providers/settings/agentManagementHost", () => ({
  agentManagementHostForMachine: (selected: MachineDescriptor) => {
    mocks.host(selected);
    return {
      isRemote: selected.ref.host === "remote" || selected.desktopId !== undefined,
      rediscoverAgents: mocks.rediscover,
    };
  },
}));
vi.mock("@heroui/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@heroui/react")>()),
  toast: { danger: mocks.danger },
}));
vi.mock("./ModelVisibilitySection", () => ({ ModelVisibilitySection: () => null }));
vi.mock("./ModelOrderSection", () => ({ ModelOrderSection: () => null }));

const LOCAL: MachineDescriptor = {
  id: "local",
  kind: "local",
  label: "Local",
  status: "online",
  ref: { host: "local", env: { kind: "native" } },
};

const refreshButton = () => screen.getByRole("button", { name: "Refresh detected agents" });

describe("Agents General refresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rediscover.mockReset().mockResolvedValue({ windows: [], wsl: [] });
    machine = LOCAL;
  });

  it("keeps Refresh available when no agents are installed", async () => {
    render(<AgentsGeneralSettings />);
    fireEvent.click(refreshButton());
    await waitFor(() => expect(mocks.rediscover).toHaveBeenCalledExactlyOnceWith([]));
    expect(mocks.host).toHaveBeenCalledWith(machine);
    expect(screen.getByRole("heading", { name: "Agents · General" })).toBeInTheDocument();
    await waitFor(() => expect(refreshButton()).toBeEnabled());
  });

  it.each([
    ["local native", LOCAL, []],
    [
      "local WSL",
      {
        ...LOCAL,
        id: "wsl:Ubuntu",
        kind: "local-wsl",
        ref: { host: "local", env: { kind: "wsl", distro: "Ubuntu" } },
      },
      ["Ubuntu"],
    ],
    [
      "remote native",
      {
        id: "remote:studio",
        kind: "remote",
        label: "Studio",
        status: "online",
        ref: { host: "remote", desktopId: "studio", env: { kind: "native" } },
      },
      [],
    ],
    [
      "remote WSL",
      {
        id: "remote:studio:wsl",
        kind: "remote-wsl",
        label: "Studio",
        status: "online",
        ref: { host: "remote", desktopId: "studio", env: { kind: "wsl", distro: "Ubuntu" } },
      },
      ["Ubuntu"],
    ],
  ] as [string, MachineDescriptor, string[]][])(
    "rediscovers the %s machine and shows its spinner until the call settles",
    async (_name, selected, distros) => {
      machine = selected;
      let finish!: () => void;
      mocks.rediscover.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = () => resolve({ windows: [], wsl: [] });
          }),
      );
      render(<AgentsGeneralSettings />);
      fireEvent.click(refreshButton());
      expect(mocks.rediscover).toHaveBeenCalledExactlyOnceWith(distros);
      expect(mocks.host).toHaveBeenCalledWith(selected);
      expect(refreshButton()).toBeDisabled();
      fireEvent.click(refreshButton());
      expect(mocks.rediscover).toHaveBeenCalledOnce();
      await act(async () => finish());
      expect(refreshButton()).toBeEnabled();
    },
  );

  it("disables Refresh while the selected machine is offline", () => {
    machine = { ...machine, status: "offline" };
    render(<AgentsGeneralSettings />);
    expect(refreshButton()).toBeDisabled();
    expect(mocks.rediscover).not.toHaveBeenCalled();
  });

  it("keeps pending discovery on its original machine when the selection changes", async () => {
    let finish!: () => void;
    machine = { ...machine, desktopId: "studio" };
    mocks.rediscover.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ windows: [], wsl: [] });
        }),
    );
    const { rerender } = render(<AgentsGeneralSettings />);
    fireEvent.click(refreshButton());
    expect(refreshButton()).toBeDisabled();
    machine = { ...machine, id: "other", label: "Other" };
    rerender(<AgentsGeneralSettings />);
    expect(refreshButton()).not.toBeDisabled();
    await act(async () => finish());
    expect(mocks.rediscover).toHaveBeenCalledTimes(1);
  });

  it("reports failures and allows another refresh", async () => {
    mocks.rediscover.mockRejectedValueOnce(new Error("Host unavailable"));
    render(<AgentsGeneralSettings />);
    fireEvent.click(refreshButton());
    await waitFor(() => expect(mocks.danger).toHaveBeenCalledWith("Host unavailable"));
    await waitFor(() => expect(refreshButton()).not.toBeDisabled());
    fireEvent.click(refreshButton());
    expect(mocks.rediscover).toHaveBeenCalledTimes(2);
  });
});
