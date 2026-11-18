import type { MessageDescriptor } from "@lingui/core";
import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentInstanceConfigMap, AgentStatus, UsageSnapshot } from "@/shared/contracts";
import { useAgentStatusesStore } from "@/renderer/state/agentStatusesStore";
import { useProviderUsageStore } from "@/renderer/state/providerUsageStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { i18n, type TranslateFn } from "@/renderer/i18n/i18n";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { formatUpdatedAgo, SubscriptionsDashboard } from "./SubscriptionsDashboard";

const actions = vi.hoisted(() => ({
  refreshSubscriptionsUsage: vi.fn<() => Promise<void>>(),
  openProviderAgentSettings: vi.fn<(agentKind: string) => void>(),
  startAccountSignIn: vi.fn<(status: AgentStatus, usageId: string) => boolean>(),
}));

vi.mock("../subscriptionsActions", () => ({
  ...actions,
  canOpenLocalAgentSettings: () => true,
  canStartTerminalSignIn: (agent: AgentStatus | undefined) => Boolean(agent?.loginCommand),
}));
vi.mock("@/renderer/components/providers/useProviderUsageHydration", () => ({
  useProviderUsageHydration: () => undefined,
}));
vi.mock("@/renderer/components/providers/ProviderUsageCircle", () => ({
  ProviderUsageCircle: () => <span />,
}));

const NOW = Date.now();
const HOUR = 3_600_000;

const instances = {
  work: { id: "work", driver: "codex", displayName: "Work", config: {} },
} as AgentInstanceConfigMap;

function status(kind: string, label: string, partial: Partial<AgentStatus> = {}): AgentStatus {
  return {
    kind,
    label,
    installed: true,
    authState: "authenticated",
    capabilities: {},
    ...partial,
  } as AgentStatus;
}

function usage(providerId: string, usedPercent: number, partial: Partial<UsageSnapshot> = {}) {
  return {
    providerId,
    status: "ok",
    fetchedAt: NOW - 5 * 60_000,
    windows: [{ id: "session-5h", label: "5h", usedPercent, resetsAt: NOW + 2 * HOUR }],
    ...partial,
  } as UsageSnapshot;
}

const original = useSharedSettings.getState();

beforeEach(() => {
  actions.refreshSubscriptionsUsage.mockReset().mockResolvedValue(undefined);
  actions.openProviderAgentSettings.mockReset();
  actions.startAccountSignIn.mockReset().mockReturnValue(true);
  useSharedSettings.setState({
    agentInstances: instances,
    accountPools: {
      codex: { enabled: true, members: ["codex:work", "codex"], switchAtPercent: 90 },
    },
    disabledAgents: [],
    setAccountPools: vi.fn<(pools: unknown) => void>(),
  } as never);
  useAgentStatusesStore.setState({
    agentStatuses: [
      status("codex", "Codex"),
      status("codex:work", "Codex Work"),
      status("claude", "Claude Code", { authState: "missing", loginCommand: "claude /login" }),
      status("pi", "Pi"),
    ],
    wslAgentStatuses: [],
  });
  useProviderUsageStore.setState({
    snapshots: {
      codex: usage("codex", 95, {
        windows: [{ id: "weekly", label: "Weekly", usedPercent: 95, resetsAt: NOW + 3 * HOUR }],
      }),
      "codex:work": usage("codex:work", 20, { plan: "Pro" }),
    },
  });
});

afterEach(() => {
  useSharedSettings.setState(original, true);
  useAgentStatusesStore.setState({ agentStatuses: [], wslAgentStatuses: [] });
  useProviderUsageStore.setState({ snapshots: {} });
});

function accountRow(kind: string): HTMLElement {
  const row = document.querySelector<HTMLElement>(`[data-subscription-account="${kind}"]`);
  if (!row) throw new Error(`no row for ${kind}`);
  return row;
}

describe("SubscriptionsDashboard", () => {
  it("nests accounts under providers with plan, pool order, bars and readiness", async () => {
    render(<SubscriptionsDashboard />);
    const codex = await screen.findByRole("list", { name: "Codex accounts" });
    const kinds = [...codex.querySelectorAll("[data-subscription-account]")].map((row) =>
      row.getAttribute("data-subscription-account"),
    );
    // The pool's own order: Work first.
    expect(kinds).toEqual(["codex:work", "codex"]);

    const work = accountRow("codex:work");
    expect(work.getAttribute("data-vc-agent-kind")).toBe("codex:work");
    expect(work.querySelector("[data-subscription-plan]")?.textContent).toBe("Pro");
    expect(work.querySelector('[data-subscription-readiness="signed-in"]')).toBeTruthy();
    expect(work.querySelector('[data-subscription-badge="pooled"]')?.textContent).toBe(
      "Pooled · 1 of 2 · switches at 90% used",
    );
    expect(work.querySelectorAll('[role="progressbar"]').length).toBeGreaterThan(0);

    // 95% used is out at the pool's 90% rule, with its reset countdown.
    expect(
      accountRow("codex").querySelector('[data-subscription-badge="exhausted"]')?.textContent,
    ).toMatch(/^Out of usage · resets in (2h 59m|3h 0m)$/);
    expect(document.querySelector('[data-subscription-pool="on"]')?.textContent).toBe(
      "Pool on · switches at 90% used",
    );
  });

  it("says honestly when an account has no usage data and offers its sign-in", async () => {
    render(<SubscriptionsDashboard />);
    const claude = await screen.findByRole("list", { name: "Claude Code accounts" });
    const row = claude.querySelector<HTMLElement>("[data-subscription-account]")!;
    expect(row.querySelector('[data-subscription-readiness="needs-sign-in"]')).toBeTruthy();
    expect(row.querySelector('[data-subscription-usage="none"]')?.textContent).toContain(
      "No usage data",
    );
    fireEvent.click(screen.getByRole("button", { name: "Sign in to Claude Code" }));
    expect(actions.startAccountSignIn).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "claude" }),
      "claude",
      expect.any(Function),
    );
  });

  it("ranks who has room and lists who is out", async () => {
    render(<SubscriptionsDashboard />);
    const room = await screen.findByRole("list", { name: "Accounts by usage left" });
    const entries = [...room.querySelectorAll("[data-subscription-room]")];
    expect(entries.map((entry) => entry.getAttribute("data-subscription-room"))).toEqual([
      "codex:work",
    ]);
    expect(entries[0]!.textContent).toContain("80% left");
    const out = screen.getByRole("list", { name: "Accounts out of usage" });
    expect(out.querySelector('[data-subscription-out="codex"]')?.textContent).toMatch(
      /resets in (2h 59m|3h 0m)/,
    );
  });

  it("refreshes usage and opens a provider's pool settings", async () => {
    render(<SubscriptionsDashboard />);
    expect(screen.getByText(/^Updated /).textContent).toBe("Updated 5m ago");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Refresh usage" }));
    });
    expect(actions.refreshSubscriptionsUsage).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Manage pool for Codex" }));
    expect(actions.openProviderAgentSettings).toHaveBeenCalledWith("codex");
    // Only providers with profiles can pool.
    const pi = document.querySelector('[data-subscription-provider="pi"]');
    expect(pi).toBeTruthy();
    expect(pi!.querySelector("button")).toBeNull();
  });

  it("shows an empty state without any provider", async () => {
    useAgentStatusesStore.setState({ agentStatuses: [], wslAgentStatuses: [] });
    useSharedSettings.setState({ agentInstances: {} } as never);
    useProviderUsageStore.setState({ snapshots: {} });
    render(<SubscriptionsDashboard />);
    expect(await screen.findByText(/No subscriptions yet/)).toBeTruthy();
    expect(document.querySelector("[data-subscriptions-updated]")).toBeNull();
    expect(document.querySelector("[data-subscriptions-room]")).toBeNull();
  });
});

describe("formatUpdatedAgo", () => {
  const t = ((descriptor: MessageDescriptor) => i18n._(descriptor)) as TranslateFn;

  it("reads minutes, hours and days", () => {
    expect(formatUpdatedAgo(NOW, NOW, t)).toBe("just now");
    expect(formatUpdatedAgo(NOW - 5 * 60_000, NOW, t)).toBe("5m ago");
    expect(formatUpdatedAgo(NOW - 3 * HOUR, NOW, t)).toBe("3h ago");
    expect(formatUpdatedAgo(NOW - 50 * HOUR, NOW, t)).toBe("2d ago");
  });
});
