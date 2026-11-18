// ViscosityCode: account pools — usage settings show pooled accounts the host
// collects as tracked (they are off only by the built-in default).
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { useProviderUsageStore } from "@/renderer/state/providerUsageStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { useUsageLoginStateStore } from "@/renderer/state/usageLoginStateStore";
import { DEFAULT_USAGE_DISABLED_PROVIDER_IDS } from "@/shared/settings";
import { UsageSettings } from "./UsageSettings";

const bridgeMock = vi.hoisted(() => ({
  getProviderUsage: vi.fn<() => Promise<{ snapshots: []; fromCache: boolean }>>(),
  refreshProviderUsage: vi.fn<() => Promise<{ snapshots: []; fromCache: boolean }>>(),
  getUsageLoginState: vi.fn<() => Promise<{ stored: Record<string, boolean> }>>(),
}));

vi.mock("@/renderer/bridge", () => ({
  isRemoteSession: () => false,
  readBridge: () => bridgeMock,
}));

vi.mock("@/renderer/adaptiveLayout", () => ({
  useCompactLayout: () => false,
}));

vi.mock("@/renderer/components/providers/refreshProviderUsageSnapshot", () => ({
  refreshAndMergeProviderUsage: vi.fn<() => Promise<void>>(async () => undefined),
}));

vi.mock("@/renderer/components/providers/useProviderUsageRefresh", () => ({
  useProviderUsageRefresh: () => ({ refreshing: false, refresh: vi.fn<() => Promise<void>>() }),
}));

vi.mock("@/renderer/components/providers/useUsageProviderLogin", () => ({
  useUsageProviderLogin: () => ({
    supportsLogin: false,
    canSignIn: false,
    canBrowserSignIn: false,
    canApiKeySignIn: false,
    canSignOut: false,
    signingIn: false,
    signingOut: false,
    apiKey: "",
    setApiKey: vi.fn<(value: string) => void>(),
    handleSignIn: vi.fn<() => Promise<void>>(),
    handleSubmitApiKey: vi.fn<() => Promise<void>>(),
    handleSignOut: vi.fn<() => Promise<void>>(),
  }),
}));

describe("UsageSettings with account pools", () => {
  beforeEach(() => {
    bridgeMock.getProviderUsage.mockResolvedValue({ snapshots: [], fromCache: true });
    bridgeMock.refreshProviderUsage.mockResolvedValue({ snapshots: [], fromCache: false });
    bridgeMock.getUsageLoginState.mockResolvedValue({ stored: {} });
    useProviderUsageStore.setState({ snapshots: {} });
    useUsageLoginStateStore.setState({ stored: {} });
    useSharedSettings.setState((state) => ({
      agentInstances: { team: { id: "team", driver: "gemini", displayName: "Team" } },
      accountPools: { gemini: { enabled: true, members: ["gemini", "gemini:team"] } },
      usage: {
        ...state.usage,
        autoRefresh: true,
        refreshIntervalMinutes: 5,
        showInSidebar: true,
        showEstimatedCost: false,
        sidebarHiddenProviders: [],
        disabledProviders: [...DEFAULT_USAGE_DISABLED_PROVIDER_IDS],
        providerOrder: [],
        collapsedProviders: [],
      },
    }));
  });

  afterEach(() => {
    cleanup();
    useSharedSettings.setState({ accountPools: {} });
  });

  it("lists a pooled default-off account as tracked, with its switch locked on", () => {
    expect(DEFAULT_USAGE_DISABLED_PROVIDER_IDS).toContain("gemini");
    render(<UsageSettings />);
    const tracked = screen.getByRole("switch", { name: /usage \(needed by an account pool\)$/ });
    expect(tracked).toBeTruthy();
    expect(tracked).toBeChecked();
    expect(tracked).toBeDisabled();
    // The stored opt-out list is untouched: the pool, not a write, tracks it.
    expect(useSharedSettings.getState().usage.disabledProviders).toContain("gemini");
    // It is not offered again under More providers.
    fireEvent.click(screen.getByRole("button", { name: /More providers/ }));
    expect(screen.queryByRole("switch", { name: /^Track Gemini usage$/ })).toBeNull();
  });

  it("lists the account under More providers once the pool is off", () => {
    useSharedSettings.setState({
      accountPools: { gemini: { enabled: false, members: ["gemini", "gemini:team"] } },
    });
    render(<UsageSettings />);
    expect(screen.queryByRole("switch", { name: /needed by an account pool/ })).toBeNull();
  });
});
