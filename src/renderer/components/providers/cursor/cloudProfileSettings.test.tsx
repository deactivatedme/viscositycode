import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentInstanceConfig } from "@/shared/contracts";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { CursorCloudProfileSettings, cursorProfileConfigPatch } from "./cloudProfileSettings";

const mocks = vi.hoisted(() => ({
  flush: vi.fn<(options?: { requireSuccess?: boolean }) => Promise<void>>(),
  refresh: vi.fn<(distros: string[], options: unknown) => Promise<void>>(),
  toastDanger: vi.fn<(message: string) => void>(),
}));

vi.mock("@/renderer/state/sharedSettingsStore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/renderer/state/sharedSettingsStore")>()),
  flushSharedSettings: mocks.flush,
}));
vi.mock("@/renderer/bridge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/renderer/bridge")>()),
  readBridge: () => ({ refreshAgentStatuses: mocks.refresh }),
}));
vi.mock("@/renderer/utils/acpRegistryAuth", () => ({ currentWslDistros: () => [] }));
vi.mock("@heroui/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@heroui/react")>()),
  toast: { danger: mocks.toastDanger, success: vi.fn<(message: string) => void>() },
}));

function seed(config?: unknown): AgentInstanceConfig {
  const instance: AgentInstanceConfig = {
    id: "work",
    driver: "cursor",
    displayName: "Cursor Cloud",
    ...(config === undefined ? {} : { config }),
  };
  useSharedSettings.setState({ agentInstances: { work: instance } });
  return instance;
}

const stored = () => useSharedSettings.getState().agentInstances.work;

beforeEach(() => {
  mocks.flush.mockResolvedValue(undefined);
  mocks.refresh.mockResolvedValue(undefined);
});

afterEach(() => {
  useSharedSettings.setState({ agentInstances: {} });
  vi.clearAllMocks();
});

describe("cursorProfileConfigPatch", () => {
  it("writes format 1, keeps unknown keys and drops pull requests for local runs", () => {
    expect(
      cursorProfileConfigPatch(
        { keep: 1, autoCreatePR: true },
        { runtimeTarget: "local", autoCreatePR: true },
      ),
    ).toEqual({ keep: 1, format: 1, runtimeTarget: "local" });
    expect(
      cursorProfileConfigPatch(undefined, { runtimeTarget: "cloud", autoCreatePR: true }),
    ).toEqual({ format: 1, runtimeTarget: "cloud", autoCreatePR: true });
    expect(
      cursorProfileConfigPatch(undefined, { runtimeTarget: "cloud", autoCreatePR: false }),
    ).toEqual({ format: 1, runtimeTarget: "cloud" });
  });
});

describe("CursorCloudProfileSettings", () => {
  it("renders nothing for an unknown profile", () => {
    const { container } = render(<CursorCloudProfileSettings profileInstanceId="missing" />);
    expect(container.innerHTML).toBe("");
  });

  it("shows a profile without config as running on this computer, with no PR switch", () => {
    seed();
    render(<CursorCloudProfileSettings profileInstanceId="work" />);
    expect(screen.getAllByText("This computer").length).toBeGreaterThan(0);
    expect(screen.queryByText("Create pull requests automatically")).toBeNull();
    expect(screen.getByText(/Use a User API key from cursor\.com\/dashboard\/api/u)).toBeTruthy();
  });

  it("saves the pull request switch on a cloud profile and refreshes that profile", async () => {
    seed({ format: 1, runtimeTarget: "cloud" });
    render(<CursorCloudProfileSettings profileInstanceId="work" />);

    fireEvent.click(screen.getByRole("switch"));

    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
    expect(stored()?.config).toEqual({ format: 1, runtimeTarget: "cloud", autoCreatePR: true });
    expect(mocks.flush).toHaveBeenCalledWith({ requireSuccess: true });
    expect(mocks.refresh).toHaveBeenCalledWith([], { agentKinds: ["cursor:work"] });
  });

  it("restores the stored config when the host refuses the save", async () => {
    const original = seed({ format: 1, runtimeTarget: "cloud" });
    mocks.flush.mockRejectedValueOnce(new Error("Invalid Cursor profile config"));
    render(<CursorCloudProfileSettings profileInstanceId="work" />);

    fireEvent.click(screen.getByRole("switch"));

    await waitFor(() => expect(mocks.toastDanger).toHaveBeenCalled());
    expect(stored()).toEqual(original);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("keeps a save the host accepted when the status refresh fails", async () => {
    seed({ format: 1, runtimeTarget: "cloud" });
    mocks.refresh.mockRejectedValueOnce(new Error("detection failed"));
    render(<CursorCloudProfileSettings profileInstanceId="work" />);

    fireEvent.click(screen.getByRole("switch"));

    await waitFor(() => expect(mocks.toastDanger).toHaveBeenCalled());
    expect(stored()?.config).toEqual({ format: 1, runtimeTarget: "cloud", autoCreatePR: true });
    expect(mocks.flush).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByRole("switch")).not.toHaveProperty("disabled", true));
  });

  it("leaves a config from a newer format read-only", () => {
    seed({ format: 2, runtimeTarget: "elsewhere" });
    render(<CursorCloudProfileSettings profileInstanceId="work" />);
    expect(screen.getByText(/saved by a newer or different version/u)).toBeTruthy();
    expect(screen.queryByRole("switch")).toBeNull();
  });
});
