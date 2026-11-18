import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentInstanceConfigMap, AgentStatus, Thread } from "@/shared/contracts";
import { useAgentStatusesStore } from "@/renderer/state/agentStatusesStore";
import { useAppStore } from "@/renderer/state/appStore";
import { useProviderUsageStore } from "@/renderer/state/providerUsageStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import {
  clearStatusBarRegistry,
  getStatusBarItems,
} from "@/renderer/viscosity/layout/statusBar/statusBarRegistry";
import {
  ACCOUNT_POOL_STATUS_ITEM_ID,
  AccountPoolStatusItem,
  registerAccountPoolStatusBarItem,
} from "./AccountPoolStatusItem";

const panelActions = vi.hoisted(() => ({
  openUsagePanelForProvider: vi.fn<(providerId: string) => void>(),
}));
vi.mock("@/renderer/actions/panelActions", () => panelActions);

const NOW = Date.now();

const instances = {
  work: { id: "work", driver: "codex", displayName: "Work", config: {} },
} as AgentInstanceConfigMap;

function status(kind: string, label: string): AgentStatus {
  return {
    kind,
    label,
    installed: true,
    authState: "authenticated",
    capabilities: {},
  } as AgentStatus;
}

function thread(partial: Partial<Thread>): Thread {
  return {
    id: "t1",
    projectId: "p1",
    title: "Thread",
    status: "working",
    archived: false,
    done: false,
    agentKind: "codex:work",
    presentationMode: "gui",
    config: { model: "" },
    ...partial,
  } as Thread;
}

function focus(next: Partial<Thread>) {
  useAppStore.setState({
    threads: [thread(next)],
    focusedPaneId: "t1",
    view: { kind: "thread", panes: ["t1"] } as never,
  });
}

function setUsage(usedPercent: number) {
  useProviderUsageStore.setState({
    snapshots: {
      "codex:work": {
        providerId: "codex:work",
        status: "ok",
        fetchedAt: NOW,
        windows: [{ id: "session-5h", label: "5h", usedPercent, resetsAt: NOW + 3_600_000 }],
      },
    },
  });
}

function item(): HTMLElement | null {
  return document.querySelector(`[data-vc-status-item="${ACCOUNT_POOL_STATUS_ITEM_ID}"]`);
}

const original = useSharedSettings.getState();

beforeEach(() => {
  useSharedSettings.setState({
    agentInstances: instances,
    accountPools: { codex: { enabled: true, members: ["codex", "codex:work"] } },
  });
  useAgentStatusesStore.setState({
    agentStatuses: [status("codex", "Codex"), status("codex:work", "Codex Work")],
    wslAgentStatuses: [],
  });
  setUsage(38);
  focus({});
});

afterEach(() => {
  useSharedSettings.setState(original, true);
  useProviderUsageStore.setState({ snapshots: {} });
  clearStatusBarRegistry();
});

describe("AccountPoolStatusItem", () => {
  it("shows the focused thread's account and usage left", () => {
    render(<AccountPoolStatusItem />);
    expect(screen.getByText("Codex Work · 62% left")).toBeTruthy();
    expect(item()).not.toHaveAttribute("data-tone");
    expect(item()).toHaveAttribute("data-pool-tone", "ok");
  });

  it("turns amber when running low and red once the account is out", () => {
    setUsage(85);
    const { unmount } = render(<AccountPoolStatusItem />);
    expect(item()).toHaveAttribute("data-tone", "attention");
    unmount();

    setUsage(100);
    render(<AccountPoolStatusItem />);
    expect(screen.getByText("Codex Work · 0% left")).toBeTruthy();
    expect(item()).toHaveAttribute("data-tone", "error");
  });

  it("honours an earlier switch-at threshold", () => {
    useSharedSettings.setState({
      accountPools: {
        codex: { enabled: true, members: ["codex", "codex:work"], switchAtPercent: 90 },
      },
    });
    setUsage(91);
    render(<AccountPoolStatusItem />);
    expect(item()).toHaveAttribute("data-tone", "error");
  });

  it("is hidden for unpooled, paired-host and disabled-pool threads", () => {
    focus({ agentKind: "claude" });
    const first = render(<AccountPoolStatusItem />);
    expect(item()).toBeNull();
    first.unmount();

    focus({ remoteServerId: "paired" });
    const second = render(<AccountPoolStatusItem />);
    expect(item()).toBeNull();
    second.unmount();

    focus({});
    useSharedSettings.setState({
      accountPools: { codex: { enabled: false, members: ["codex", "codex:work"] } },
    });
    render(<AccountPoolStatusItem />);
    expect(item()).toBeNull();
  });

  it("shows only the account name while usage is unknown", () => {
    useProviderUsageStore.setState({ snapshots: {} });
    render(<AccountPoolStatusItem />);
    expect(screen.getByText("Codex Work")).toBeTruthy();
    expect(item()).toHaveAttribute("data-pool-tone", "unknown");
  });

  it("registers once on the right side of the status bar", () => {
    const unregister = registerAccountPoolStatusBarItem();
    registerAccountPoolStatusBarItem();
    expect(getStatusBarItems().filter((entry) => entry.id === ACCOUNT_POOL_STATUS_ITEM_ID)).toEqual(
      [expect.objectContaining({ align: "right" })],
    );
    unregister();
    expect(getStatusBarItems().some((entry) => entry.id === ACCOUNT_POOL_STATUS_ITEM_ID)).toBe(
      false,
    );
  });
});
