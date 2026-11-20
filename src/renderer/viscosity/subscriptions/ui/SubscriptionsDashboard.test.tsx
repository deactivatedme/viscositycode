import type { ReactNode } from "react";
import type { DragEndEvent } from "@dnd-kit/react";
import type { MessageDescriptor } from "@lingui/core";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentInstanceConfigMap, AgentStatus, UsageSnapshot } from "@/shared/contracts";
import { useAgentStatusesStore } from "@/renderer/state/agentStatusesStore";
import { useProviderUsageStore } from "@/renderer/state/providerUsageStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { i18n, type TranslateFn } from "@/renderer/i18n/i18n";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import {
  MAX_PRETEND_SUBSCRIPTIONS,
  readSubscriptionsPrefs,
  SUBSCRIPTIONS_PREFS_KEY,
  useSubscriptionsPrefsStore,
} from "../subscriptionsPrefs";
import { formatUpdatedAgo, SubscriptionsDashboard } from "./SubscriptionsDashboard";

const dnd = vi.hoisted(() => ({
  end: undefined as ((event: DragEndEvent) => void) | undefined,
}));
vi.mock("@dnd-kit/react", () => ({
  DragDropProvider: (props: { children: ReactNode; onDragEnd: (event: DragEndEvent) => void }) => {
    dnd.end = props.onDragEnd;
    return props.children;
  },
}));
vi.mock("@dnd-kit/react/sortable", () => ({
  isSortable: () => true,
  useSortable: () => ({ ref: () => {}, handleRef: () => {}, isDragging: false }),
}));

function dragEnd(providerId: string, index: number, canceled = false) {
  act(() =>
    dnd.end?.({
      canceled,
      operation: { source: { id: `subscription-provider:${providerId}`, index } },
    } as unknown as DragEndEvent),
  );
}

function sectionOrder(): (string | null)[] {
  return [...document.querySelectorAll("[data-subscription-provider]")].map((section) =>
    section.getAttribute("data-subscription-provider"),
  );
}

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
      // Signed out, but usage it reported earlier keeps the row listed.
      claude: usage("claude", 30, { status: "auth-missing" }),
      // Usage is set up but reports no windows yet.
      pi: usage("pi", 0, { windows: [] }),
    },
  });
});

afterEach(() => {
  useSharedSettings.setState(original, true);
  useAgentStatusesStore.setState({ agentStatuses: [], wslAgentStatuses: [] });
  useProviderUsageStore.setState({ snapshots: {} });
  useSubscriptionsPrefsStore.setState({ providerOrder: [], pretend: [], overrides: [] });
  localStorage.clear();
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
    expect(
      accountRow("pi").querySelector('[data-subscription-usage="none"]')?.textContent,
    ).toContain("No usage data");
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
    // Sentence-case heading, like the rest of the app's section labels.
    expect(screen.getByRole("heading", { name: "Who has room right now" }).className).not.toMatch(
      /uppercase|tracking-/,
    );
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
    const pi = document.querySelector<HTMLElement>('[data-subscription-provider="pi"]');
    expect(pi).toBeTruthy();
    expect(within(pi!).queryByRole("button", { name: /Manage pool/ })).toBeNull();
  });

  it("shows an empty state without any provider", async () => {
    useAgentStatusesStore.setState({ agentStatuses: [], wslAgentStatuses: [] });
    useSharedSettings.setState({ agentInstances: {} } as never);
    useProviderUsageStore.setState({ snapshots: {} });
    render(<SubscriptionsDashboard />);
    expect(await screen.findByText(/No enabled subscriptions yet/)).toBeTruthy();
    expect(document.querySelector("[data-subscriptions-updated]")).toBeNull();
    expect(document.querySelector("[data-subscriptions-room]")).toBeNull();
  });
});

describe("SubscriptionsDashboard filter and order", () => {
  it("leaves out a disabled agent", async () => {
    useSharedSettings.setState({ disabledAgents: ["pi"] } as never);
    render(<SubscriptionsDashboard />);
    await screen.findByRole("list", { name: "Codex accounts" });
    expect(document.querySelector('[data-subscription-provider="pi"]')).toBeNull();
  });

  it("lists an account whose usage returns nothing only once the owner customized it", async () => {
    useProviderUsageStore.setState((state) => ({
      snapshots: {
        ...state.snapshots,
        pi: usage("pi", 0, { status: "auth-missing", windows: [] }),
      },
    }));
    const view = render(<SubscriptionsDashboard />);
    await screen.findByRole("list", { name: "Codex accounts" });
    expect(document.querySelector('[data-subscription-provider="pi"]')).toBeNull();

    view.unmount();
    useSubscriptionsPrefsStore.setState({ overrides: [{ key: "pi", provider: "Kept AI" }] });
    render(<SubscriptionsDashboard />);
    await screen.findByRole("list", { name: "Kept AI accounts" });
    expect(accountRow("pi")).toBeTruthy();
  });

  it("reorders providers by drag, persists the order and honours it on remount", async () => {
    const view = render(<SubscriptionsDashboard />);
    await screen.findByRole("list", { name: "Codex accounts" });
    expect(screen.getByRole("button", { name: "Reorder Codex" })).toBeTruthy();
    const before = sectionOrder();
    expect(before).toHaveLength(3);

    dragEnd("pi", 0, true);
    expect(sectionOrder()).toEqual(before);
    expect(localStorage.getItem(SUBSCRIPTIONS_PREFS_KEY)).toBeNull();

    dragEnd("pi", 0);
    const after = ["pi", ...before.filter((id) => id !== "pi")];
    expect(sectionOrder()).toEqual(after);
    expect(readSubscriptionsPrefs().providerOrder).toEqual(after);

    view.unmount();
    render(<SubscriptionsDashboard />);
    await screen.findByRole("list", { name: "Codex accounts" });
    expect(sectionOrder()).toEqual(after);
  });
});

describe("pretend subscriptions", () => {
  it("adds, edits and deletes a pretend row that renders like a real one", async () => {
    render(<SubscriptionsDashboard />);
    fireEvent.click(await screen.findByRole("button", { name: "Add pretend subscription" }));
    const dialog = await screen.findByRole("dialog");
    const save = within(dialog).getByRole("button", { name: "Save" });
    expect(save.hasAttribute("disabled") || save.getAttribute("aria-disabled") === "true").toBe(
      true,
    );
    fireEvent.change(within(dialog).getByLabelText("Provider"), {
      target: { value: "Grok Heavy" },
    });
    fireEvent.change(within(dialog).getByLabelText("Plan"), { target: { value: "Ultra" } });
    fireEvent.change(within(dialog).getByLabelText("Account (optional)"), {
      target: { value: "larp@example.com" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add bar" }));
    fireEvent.change(within(dialog).getByLabelText("Bar 1 name"), { target: { value: "Weekly" } });
    fireEvent.change(within(dialog).getByLabelText("Bar 1 percent used"), {
      target: { value: "40" },
    });
    fireEvent.change(within(dialog).getByLabelText("Bar 1 reset text"), {
      target: { value: "Resets Friday" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    const [stored] = readSubscriptionsPrefs().pretend;
    expect(stored).toMatchObject({
      provider: "Grok Heavy",
      plan: "Ultra",
      account: "larp@example.com",
      bars: [{ label: "Weekly", usedPercent: 40, reset: "Resets Friday" }],
    });
    const section = document.querySelector<HTMLElement>(
      `[data-subscription-provider="vc-pretend:${stored!.id}"]`,
    )!;
    // Same row anatomy as a real account: plan chip, readiness, bars.
    expect(section.querySelector("[data-subscription-plan]")?.textContent).toBe("Ultra");
    expect(section.querySelector('[data-subscription-readiness="signed-in"]')).toBeTruthy();
    expect(section.querySelectorAll('[role="progressbar"]')).toHaveLength(1);
    expect(within(section).getByText("Resets Friday")).toBeTruthy();
    expect(within(section).getByText("larp@example.com")).toBeTruthy();
    // It joins the draggable order and the room strip.
    expect(sectionOrder()).toContain(`vc-pretend:${stored!.id}`);
    expect(
      document.querySelector(`[data-subscription-room="vc-pretend:${stored!.id}"]`),
    ).toBeTruthy();

    fireEvent.click(within(section).getByRole("button", { name: "Edit Grok Heavy" }));
    const edit = await screen.findByRole("dialog");
    fireEvent.change(within(edit).getByLabelText("Plan"), { target: { value: "Pro" } });
    fireEvent.click(within(edit).getByRole("button", { name: "Save" }));
    expect(readSubscriptionsPrefs().pretend[0]?.plan).toBe("Pro");

    fireEvent.click(within(section).getByRole("button", { name: "Edit Grok Heavy" }));
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Delete" }),
    );
    expect(readSubscriptionsPrefs().pretend).toEqual([]);
    expect(
      document.querySelector(`[data-subscription-provider="vc-pretend:${stored!.id}"]`),
    ).toBeNull();
  });
});

describe("pretend subscriptions look", () => {
  function pretendEntry(id: string, provider = "Codex") {
    return { id, provider, plan: "Ultra", bars: [{ label: "Weekly", usedPercent: 10 }] };
  }

  it("borrows a known provider's icon and accent on the row and in the room strip", async () => {
    useSubscriptionsPrefsStore.setState({ pretend: [pretendEntry("p1")] });
    render(<SubscriptionsDashboard />);
    const room = await waitForElement('[data-subscription-room="vc-pretend:p1"]');
    expect(room.getAttribute("data-vc-agent-kind")).toBe("codex");
    expect(accountRow("vc-pretend:p1").getAttribute("data-vc-agent-kind")).toBe("codex");
  });

  it("disables adding at the cap and explains why", async () => {
    useSubscriptionsPrefsStore.setState({
      pretend: Array.from({ length: MAX_PRETEND_SUBSCRIPTIONS }, (_, index) =>
        pretendEntry(`p${index}`, `Fake ${index}`),
      ),
    });
    render(<SubscriptionsDashboard />);
    const add = await screen.findByRole("button", { name: "Add pretend subscription" });
    expect(add.hasAttribute("disabled") || add.getAttribute("aria-disabled") === "true").toBe(true);
    const note = screen.getByText(
      `You can have up to ${MAX_PRETEND_SUBSCRIPTIONS} pretend subscriptions`,
    );
    expect(add.getAttribute("aria-describedby")).toBe(note.id);
  });

  it("says why saving failed when the cap filled up while the dialog was open", async () => {
    render(<SubscriptionsDashboard />);
    fireEvent.click(await screen.findByRole("button", { name: "Add pretend subscription" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Provider"), { target: { value: "Grok" } });
    fireEvent.change(within(dialog).getByLabelText("Plan"), { target: { value: "Ultra" } });
    act(() =>
      useSubscriptionsPrefsStore.setState({
        pretend: Array.from({ length: MAX_PRETEND_SUBSCRIPTIONS }, (_, index) =>
          pretendEntry(`p${index}`, `Fake ${index}`),
        ),
      }),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(within(dialog).getByRole("alert").textContent).toContain(
      `up to ${MAX_PRETEND_SUBSCRIPTIONS} pretend subscriptions`,
    );
    expect(screen.getByRole("dialog")).toBe(dialog);
  });
});

describe("customize real subscriptions", () => {
  function datalistValues(input: HTMLElement): string[] {
    const list = document.getElementById(input.getAttribute("list") ?? "");
    return [...(list?.querySelectorAll("option") ?? [])].map((option) => option.value);
  }

  it("prefills from the real row, draws the override everywhere and resets to real", async () => {
    render(<SubscriptionsDashboard />);
    await screen.findByRole("list", { name: "Codex accounts" });
    const before = sectionOrder();
    fireEvent.click(screen.getByRole("button", { name: "Customize account Codex Work…" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Customize subscription")).toBeTruthy();
    expect(dialog.querySelector("[data-vc-customized]")).toBeNull();
    const provider = within(dialog).getByLabelText<HTMLInputElement>("Provider");
    const plan = within(dialog).getByLabelText<HTMLInputElement>("Plan");
    expect(provider.value).toBe("Codex");
    expect(plan.value).toBe("Pro");
    expect(within(dialog).getByLabelText<HTMLInputElement>("Account (optional)").value).toBe(
      "Codex Work",
    );
    // Real usage stays live until the owner chooses to type bars.
    const live = within(dialog).getByRole<HTMLInputElement>("switch", { name: "Use real usage" });
    expect(live.checked).toBe(true);
    expect(within(dialog).queryByLabelText("Bar 1 name")).toBeNull();
    fireEvent.click(live);
    expect(within(dialog).getByLabelText<HTMLInputElement>("Bar 1 name").value).toBe(
      "Session (5h)",
    );
    expect(within(dialog).getByLabelText<HTMLInputElement>("Bar 1 percent used").value).toBe("20");
    // No computed countdown is stored as text.
    expect(within(dialog).getByLabelText<HTMLInputElement>("Bar 1 reset text").value).toBe("");
    // Provider names come from the registry; plans from the provider's capability.
    expect(datalistValues(provider)).toContain("Codex");
    expect(datalistValues(plan).length).toBeGreaterThan(1);
    expect(datalistValues(plan)).toContain("Pro");

    fireEvent.change(plan, { target: { value: "Ultra Max" } });
    fireEvent.change(within(dialog).getByLabelText("Account (optional)"), {
      target: { value: "boss@example.com" },
    });
    fireEvent.change(within(dialog).getByLabelText("Bar 1 percent used"), {
      target: { value: "5" },
    });
    fireEvent.change(within(dialog).getByLabelText("Bar 1 reset text"), {
      target: { value: "Resets whenever" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(readSubscriptionsPrefs().overrides).toEqual([
      {
        key: "codex:work",
        provider: "Codex",
        plan: "Ultra Max",
        account: "boss@example.com",
        bars: [{ label: "Session (5h)", usedPercent: 5, reset: "Resets whenever" }],
      },
    ]);
    const row = accountRow("codex:work");
    expect(row.querySelector("[data-subscription-plan]")?.textContent).toBe("Ultra Max");
    expect(within(row).getByText("boss@example.com")).toBeTruthy();
    expect(within(row).getByText("Resets whenever")).toBeTruthy();
    expect(document.querySelector('[data-subscription-room="codex:work"]')?.textContent).toContain(
      "95% left",
    );
    // The dashboard itself carries no marker, and the order is unchanged.
    expect(document.querySelector("[data-vc-customized]")).toBeNull();
    expect(sectionOrder()).toEqual(before);
    // Real data keeps flowing underneath.
    expect(useProviderUsageStore.getState().snapshots["codex:work"]?.plan).toBe("Pro");

    fireEvent.click(screen.getByRole("button", { name: "Customize account boss@example.com…" }));
    const again = await screen.findByRole("dialog");
    expect(again.querySelector("[data-vc-customized]")).toBeTruthy();
    expect(within(again).getByLabelText<HTMLInputElement>("Plan").value).toBe("Ultra Max");
    fireEvent.click(within(again).getByRole("button", { name: "Reset to real" }));
    expect(readSubscriptionsPrefs().overrides).toEqual([]);
    expect(accountRow("codex:work").querySelector("[data-subscription-plan]")?.textContent).toBe(
      "Pro",
    );
  });

  it("saving without edits keeps the real row, usage and countdowns live", async () => {
    render(<SubscriptionsDashboard />);
    await screen.findByRole("list", { name: "Codex accounts" });
    const before = accountRow("codex:work").innerHTML;
    fireEvent.click(screen.getByRole("button", { name: "Customize account Codex Work…" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(readSubscriptionsPrefs().overrides).toEqual([
      { key: "codex:work", provider: "Codex", plan: "Pro", account: "Codex Work" },
    ]);
    expect(accountRow("codex:work").innerHTML).toBe(before);
  });

  it("prefills a second account with the real provider name, not the section rename", async () => {
    useSubscriptionsPrefsStore.setState({ overrides: [{ key: "codex", provider: "Renamed" }] });
    render(<SubscriptionsDashboard />);
    await screen.findByRole("list", { name: "Renamed accounts" });
    fireEvent.click(screen.getByRole("button", { name: "Customize account Codex Work…" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText<HTMLInputElement>("Provider").value).toBe("Codex");
  });

  it("does not reopen the dialog by itself when its account hides and returns", async () => {
    render(<SubscriptionsDashboard />);
    await screen.findByRole("list", { name: "Codex accounts" });
    fireEvent.click(screen.getByRole("button", { name: "Customize account Codex Work…" }));
    await screen.findByRole("dialog");
    act(() => useSharedSettings.setState({ disabledAgents: ["codex:work"] }));
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => useSharedSettings.setState({ disabledAgents: [] }));
    expect(accountRow("codex:work")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renames a section from its header and keeps a plan-less provider editable", async () => {
    render(<SubscriptionsDashboard />);
    await screen.findByRole("list", { name: "Codex accounts" });
    fireEvent.click(screen.getByRole("button", { name: "Customize Pi…" }));
    const dialog = await screen.findByRole("dialog");
    const plan = within(dialog).getByLabelText<HTMLInputElement>("Plan");
    expect(plan.value).toBe("");
    fireEvent.change(within(dialog).getByLabelText("Provider"), {
      target: { value: "Totally Real AI" },
    });
    // Free text has no declared plans; an empty plan is still savable.
    expect(datalistValues(plan)).toEqual([]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    const section = document.querySelector<HTMLElement>('[data-subscription-provider="pi"]')!;
    expect(within(section).getByRole("heading").textContent).toBe("Totally Real AI");
    expect(readSubscriptionsPrefs().overrides[0]).toMatchObject({ key: "pi" });
  });
});

async function waitForElement(selector: string): Promise<HTMLElement> {
  await screen.findAllByRole("list");
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) throw new Error(`no element for ${selector}`);
  return element;
}

describe("formatUpdatedAgo", () => {
  const t = ((descriptor: MessageDescriptor) => i18n._(descriptor)) as TranslateFn;

  it("reads minutes, hours and days", () => {
    expect(formatUpdatedAgo(NOW, NOW, t)).toBe("just now");
    expect(formatUpdatedAgo(NOW - 5 * 60_000, NOW, t)).toBe("5m ago");
    expect(formatUpdatedAgo(NOW - 3 * HOUR, NOW, t)).toBe("3h ago");
    expect(formatUpdatedAgo(NOW - 50 * HOUR, NOW, t)).toBe("2d ago");
  });
});
