import type { ReactNode } from "react";
import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountPools } from "@/shared/accountPools";
import type { AgentInstanceConfigMap, AgentStatus } from "@/shared/contracts";
import { useAgentStatusesStore } from "@/renderer/state/agentStatusesStore";
import { useProviderUsageStore } from "@/renderer/state/providerUsageStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { AccountPoolCard } from "./AccountPoolCard";
import { AccountPoolUnavailableNote } from "./AccountPoolUnavailableNote";

vi.mock("@/renderer/components/common/ToggleSwitch", () => ({
  ToggleSwitch: (props: {
    "aria-label": string;
    isSelected: boolean;
    onChange: (value: boolean) => void;
  }) => (
    <input
      type="checkbox"
      aria-label={props["aria-label"]}
      checked={props.isSelected}
      onChange={(event) => props.onChange(event.target.checked)}
    />
  ),
}));
vi.mock("@/renderer/components/common/Select", () => ({
  Select: (props: {
    "aria-label": string;
    value: string;
    options: readonly { id: string; label: string }[];
    onChange: (value: string) => void;
  }) => (
    <select
      aria-label={props["aria-label"]}
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
    >
      {props.options.map((option) => (
        <option key={option.id} value={option.id}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));
vi.mock("@/renderer/components/providers/ProviderUsageCircle", () => ({
  ProviderUsageCircle: () => <span />,
}));
vi.mock("@dnd-kit/react", () => ({
  DragDropProvider: (props: { children: ReactNode }) => <>{props.children}</>,
}));
vi.mock("@dnd-kit/react/sortable", () => ({
  isSortable: () => false,
  useSortable: () => ({ ref: () => {}, handleRef: () => {}, isDragging: false }),
}));

const NOW = Date.now();

const instances = {
  work: { id: "work", driver: "codex", displayName: "Work", config: {} },
  personal: { id: "personal", driver: "codex", displayName: "Personal", config: {} },
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

const original = useSharedSettings.getState();
let setAccountPools: ReturnType<typeof vi.fn<(pools: AccountPools) => void>>;

beforeEach(() => {
  setAccountPools = vi.fn<(pools: AccountPools) => void>((pools) => {
    useSharedSettings.setState({ accountPools: pools });
  });
  useSharedSettings.setState({
    agentInstances: instances,
    accountPools: {},
    disabledAgents: [],
    setAccountPools,
  } as never);
  useAgentStatusesStore.setState({
    agentStatuses: [
      status("codex", "Codex"),
      status("codex:personal", "Codex Personal", { authState: "missing" }),
      status("codex:work", "Codex Work"),
    ],
    wslAgentStatuses: [],
  });
  useProviderUsageStore.setState({
    snapshots: {
      codex: {
        providerId: "codex",
        status: "ok",
        fetchedAt: NOW,
        windows: [{ id: "session-5h", label: "5h", usedPercent: 100, resetsAt: NOW + 7_200_000 }],
      },
      "codex:work": {
        providerId: "codex:work",
        status: "ok",
        fetchedAt: NOW,
        windows: [{ id: "session-5h", label: "5h", usedPercent: 38 }],
      },
    },
  });
});

afterEach(() => {
  useSharedSettings.setState(original, true);
  useProviderUsageStore.setState({ snapshots: {} });
});

function memberOrder(): string[] {
  return [...document.querySelectorAll("[data-pool-member]")].map(
    (row) => row.getAttribute("data-pool-member") ?? "",
  );
}

describe("AccountPoolCard", () => {
  it("lists every account with live usage, badges and the default order", () => {
    useSharedSettings.setState({ accountPools: { codex: { enabled: true, members: [] } } });
    render(<AccountPoolCard driver="codex" />);
    expect(memberOrder()).toEqual(["codex", "codex:personal", "codex:work"]);
    const codexRow = document.querySelector('[data-pool-member="codex"]')!;
    expect(codexRow.querySelector('[data-pool-badge="exhausted"]')?.textContent).toMatch(
      /Out of usage · resets in (1h 59m|2h 0m)/,
    );
    expect(
      document.querySelector('[data-pool-member="codex:personal"] [data-pool-badge="not-ready"]'),
    ).toBeTruthy();
    expect(screen.getAllByRole("progressbar").length).toBeGreaterThan(0);
  });

  it("turns the pool on through the settings store with the full order", () => {
    render(<AccountPoolCard driver="codex" />);
    // Off: only the toggle, no order or threshold yet.
    expect(document.querySelector("[data-pool-member]")).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Switch at" })).toBeNull();
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Use these accounts as a pool (switch automatically when one runs out)",
      }),
    );
    expect(setAccountPools).toHaveBeenCalledTimes(1);
    expect(useSharedSettings.getState().accountPools).toEqual({
      codex: { enabled: true, members: ["codex", "codex:personal", "codex:work"] },
    });
    expect(memberOrder()).toEqual(["codex", "codex:personal", "codex:work"]);
  });

  it("reorders with the arrow buttons and keeps the saved toggle", () => {
    useSharedSettings.setState({
      accountPools: { codex: { enabled: true, members: ["codex:work", "codex"] } },
    });
    render(<AccountPoolCard driver="codex" />);
    // Saved members first, then the account the pool has not listed yet.
    expect(memberOrder()).toEqual(["codex:work", "codex", "codex:personal"]);
    expect(screen.getByRole("button", { name: "Move Codex Work up" })).toBeDisabled();

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Move Codex down" }));
    });
    expect(useSharedSettings.getState().accountPools?.codex).toEqual({
      enabled: true,
      members: ["codex:work", "codex:personal", "codex"],
    });
    expect(memberOrder()).toEqual(["codex:work", "codex:personal", "codex"]);
  });

  it("saves the switch-at threshold", () => {
    useSharedSettings.setState({
      accountPools: { codex: { enabled: true, members: ["codex", "codex:work"] } },
    });
    render(<AccountPoolCard driver="codex" />);
    fireEvent.change(screen.getByRole("combobox", { name: "Switch at" }), {
      target: { value: "90" },
    });
    expect(useSharedSettings.getState().accountPools?.codex).toEqual({
      enabled: true,
      members: ["codex", "codex:work", "codex:personal"],
      switchAtPercent: 90,
    });
  });

  // ViscosityCode: account pool follow-ups — leave an account out of the pool.
  it("leaves an account out of the pool and brings it back in its place", () => {
    useSharedSettings.setState({
      accountPools: {
        codex: { enabled: true, members: ["codex", "codex:work", "codex:personal"] },
      },
    });
    render(<AccountPoolCard driver="codex" />);
    const include = () => screen.getByRole("checkbox", { name: "Include Codex Work in the pool" });
    expect(include()).toBeChecked();

    act(() => {
      fireEvent.click(include());
    });
    expect(useSharedSettings.getState().accountPools?.codex).toEqual({
      enabled: true,
      members: ["codex", "codex:work", "codex:personal"],
      excludedMembers: ["codex:work"],
    });
    const row = document.querySelector('[data-pool-member="codex:work"]')!;
    expect(row.getAttribute("data-pool-member-included")).toBe("false");
    expect(row.querySelector('[data-pool-badge="left-out"]')).toBeTruthy();
    // The account keeps its place in the order.
    expect(memberOrder()).toEqual(["codex", "codex:work", "codex:personal"]);

    act(() => {
      fireEvent.click(include());
    });
    expect(useSharedSettings.getState().accountPools?.codex).toEqual({
      enabled: true,
      members: ["codex", "codex:work", "codex:personal"],
    });
  });

  it("warns when fewer than two accounts are left in the pool", () => {
    useSharedSettings.setState({
      accountPools: {
        codex: {
          enabled: true,
          members: ["codex", "codex:work", "codex:personal"],
          excludedMembers: ["codex:work", "codex:personal"],
        },
      },
    });
    render(<AccountPoolCard driver="codex" />);
    expect(document.querySelector('[data-pool-note="too-few"]')).toBeTruthy();
  });

  it("says tracking is off only for accounts the host does not collect", () => {
    useSharedSettings.setState({
      usage: { ...original.usage, disabledProviders: ["codex:personal"] },
      accountPools: { codex: { enabled: true, members: ["codex", "codex:work"] } },
    });
    useProviderUsageStore.setState({ snapshots: {} });
    render(<AccountPoolCard driver="codex" />);
    expect(document.querySelector('[data-pool-member="codex:personal"]')?.textContent).toContain(
      "Usage tracking is off for this account.",
    );
    expect(document.querySelector('[data-pool-member="codex:work"]')?.textContent).toContain(
      "No usage reported yet.",
    );
  });

  it("explains that a pool needs a second account", () => {
    useSharedSettings.setState({ agentInstances: {} });
    render(<AccountPoolCard driver="codex" />);
    expect(screen.getByText("Add another profile to use your accounts as a pool.")).toBeTruthy();
    expect(document.querySelector("[data-pool-member]")).toBeNull();
  });
});

describe("AccountPoolUnavailableNote", () => {
  it("shows the provider's own reason", () => {
    render(
      <AccountPoolUnavailableNote
        reason={{ id: "test.reason", message: "This provider keeps one sign-in per computer." }}
      />,
    );
    expect(screen.getByText("This provider keeps one sign-in per computer.")).toBeTruthy();
  });
});
