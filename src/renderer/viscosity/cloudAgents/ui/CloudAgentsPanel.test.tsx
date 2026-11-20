import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Thread } from "@/shared/contracts";
import { useAppStore } from "@/renderer/state/appStore";
import { usePanelStore } from "@/renderer/state/panelStore";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import type {
  CloudAgentDetail,
  CloudAgentSummary,
  ListCloudAgentsResult,
} from "../cloudAgentsContract";
import { registerCloudAgentSetupHint } from "../cloudSetupHints";
import { CloudAgentsPanel } from "./CloudAgentsPanel";

const mocks = vi.hoisted(() => ({
  remote: false,
  present: true,
  list: vi.fn<(payload: unknown) => Promise<unknown>>(),
  get: vi.fn<(payload: unknown) => Promise<unknown>>(),
  follow: vi.fn<(item: unknown) => Promise<string | undefined>>(),
  startNew: vi.fn<(agentKind: string) => Promise<void>>(),
  openExternal: vi.fn<(url: string) => void>(),
}));

vi.mock("@/renderer/bridge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/renderer/bridge")>()),
  isRemoteSession: () => mocks.remote,
}));
vi.mock("../cloudAgentsContract", () => ({
  cloudAgentsBridge: () =>
    mocks.present
      ? {
          listCloudAgents: mocks.list,
          getCloudAgent: mocks.get,
          followCloudAgent: vi.fn<() => Promise<never>>(),
        }
      : undefined,
}));
vi.mock("../cloudAgentsActions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../cloudAgentsActions")>()),
  followCloudAgent: mocks.follow,
  startNewCloudAgent: mocks.startNew,
}));
vi.mock("@/renderer/viscosity/accountPools/poolHooks", () => ({
  useAccountLabelResolver: () => (agentKind: string) => `Profile ${agentKind}`,
}));
vi.mock("@/renderer/utils/openExternal", () => ({
  openExternalWithFeedback: mocks.openExternal,
}));

const NOW = Date.parse("2026-11-20T12:00:00.000Z");

function agent(id: string, patch: Partial<CloudAgentSummary> = {}): CloudAgentSummary {
  return {
    agentKind: "sample:cloud",
    id,
    providerSessionId: `sdk:${id}`,
    name: `Agent ${id}`,
    status: "running",
    updatedAt: "2026-11-20T11:55:00.000Z",
    repos: [{ url: "github.com/acme/api" }],
    ...patch,
  };
}

function listed(sources: ListCloudAgentsResult["sources"]): ListCloudAgentsResult {
  return { sources, fetchedAt: NOW };
}

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  mocks.remote = false;
  mocks.present = true;
  mocks.list.mockResolvedValue(listed([{ agentKind: "sample:cloud", items: [agent("bc-1")] }]));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  useAppStore.setState({ threads: [] });
});

describe("CloudAgentsPanel", () => {
  it("explains that a remote session lists cloud agents on the host", () => {
    mocks.remote = true;
    render(<CloudAgentsPanel />);
    expect(screen.getByText(/listed in the desktop app on the host computer/)).toBeTruthy();
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("asks for a newer host when the cloud procedures are missing", () => {
    mocks.present = false;
    render(<CloudAgentsPanel />);
    expect(screen.getByText(/cannot list cloud agents yet/)).toBeTruthy();
  });

  it("shows the registered provider setup hints when no profile runs in the cloud", async () => {
    mocks.list.mockResolvedValue(listed([]));
    const unregister = registerCloudAgentSetupHint({
      id: "sample",
      Hint: (props) => (
        <button type="button" onClick={() => props.openAgentSettings("sample")}>
          Sample setup
        </button>
      ),
    });
    try {
      render(<CloudAgentsPanel />);
      fireEvent.click(await screen.findByRole("button", { name: "Sample setup" }));
      expect(screen.getByText("Run agents in the cloud")).toBeTruthy();
      expect(usePanelStore.getState().settingsSection).toBe("agents:sample");
    } finally {
      unregister();
    }
  });

  it("renders auth, plan and rate-limited sources with their own messages", async () => {
    mocks.list.mockResolvedValue(
      listed([
        { agentKind: "a", items: [], error: { code: "auth" } },
        { agentKind: "b", items: [], error: { code: "plan" } },
        { agentKind: "c", items: [], error: { code: "rate_limited", retryAfterMs: 30_000 } },
      ]),
    );
    render(<CloudAgentsPanel />);
    expect(
      await screen.findByText(
        "The API key for Profile a was rejected. Add a valid key in Settings → Agents → Profile a.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Your plan or team does not allow cloud agents through the API for Profile b.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("The provider asked us to slow down. Retrying in 30 s.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Refresh cloud agents" })).toBeDisabled();
  });

  it("badges an agent as Following only on an exact resume reference match", async () => {
    mocks.list.mockResolvedValue(
      listed([{ agentKind: "sample:cloud", items: [agent("bc-1"), agent("bc-10")] }]),
    );
    useAppStore.setState({
      threads: [
        {
          id: "t-1",
          agentKind: "sample:cloud",
          sessionRef: { providerSessionId: "sdk:bc-1" },
        } as unknown as Thread,
      ],
    });
    render(<CloudAgentsPanel />);
    await screen.findByText("Agent bc-10");
    const following = document.querySelectorAll("[data-cloud-agent-following]");
    expect(following).toHaveLength(1);
    expect(following[0]!.closest("[data-cloud-agent]")?.getAttribute("data-cloud-agent")).toBe(
      "bc-1",
    );
  });

  it("hides archived agents until asked", async () => {
    mocks.list.mockResolvedValue(
      listed([
        { agentKind: "sample:cloud", items: [agent("bc-1"), agent("bc-2", { archived: true })] },
      ]),
    );
    render(<CloudAgentsPanel />);
    await screen.findByText("Agent bc-1");
    expect(screen.queryByText("Agent bc-2")).toBeNull();
    fireEvent.click(screen.getByRole("switch", { name: "Show archived" }));
    expect(await screen.findByText("Agent bc-2")).toBeTruthy();
  });

  it("expands a row into its run result, branch and PR links, and follows it", async () => {
    const detail: CloudAgentDetail = {
      ...agent("bc-1"),
      webUrl: "https://example.test/agents/bc-1",
      latestRun: { status: "finished", result: "All tests pass.", durationMs: 95_000 },
      branches: [
        { repoUrl: "github.com/acme/api", branch: "agent/fix", prUrl: "https://example.test/pr/7" },
      ],
    };
    mocks.list.mockResolvedValue(listed([{ agentKind: "sample:cloud", items: [detail] }]));
    mocks.get.mockResolvedValue(detail);
    mocks.follow.mockResolvedValue("t-new");
    render(<CloudAgentsPanel />);
    fireEvent.click(await screen.findByRole("button", { expanded: false }));

    expect(await screen.findByText("All tests pass.")).toBeTruthy();
    expect(mocks.get).toHaveBeenCalledWith({ agentKind: "sample:cloud", agentId: "bc-1" });
    expect(screen.getByText("acme/api @ agent/fix")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open PR" }));
    expect(mocks.openExternal).toHaveBeenCalledWith("https://example.test/pr/7");

    fireEvent.click(screen.getByRole("button", { name: "Follow" }));
    await waitFor(() => expect(mocks.follow).toHaveBeenCalledWith(detail));
  });

  it("starts a new cloud agent for its source", async () => {
    render(<CloudAgentsPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "New cloud agent" }));
    expect(mocks.startNew).toHaveBeenCalledWith("sample:cloud");
  });

  it("shows a failed first read with a retry", async () => {
    mocks.list.mockRejectedValueOnce(new Error("host offline"));
    render(<CloudAgentsPanel />);
    const retry = await screen.findByRole("button", { name: "Try again" });
    await act(async () => {
      fireEvent.click(retry);
    });
    expect(await screen.findByText("Agent bc-1")).toBeTruthy();
    expect(mocks.list).toHaveBeenLastCalledWith({ refresh: true });
  });
});
