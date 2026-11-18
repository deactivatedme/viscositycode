import { describe, expect, it } from "vitest";
import type { AccountPools } from "@/shared/accountPools";
import type { AgentInstanceConfigMap, AgentStatus, UsageSnapshot } from "@/shared/contracts";
import {
  accountReadiness,
  buildSubscriptionProviders,
  lastUsageUpdate,
  subscriptionProviderId,
  summarizeRoom,
  type SubscriptionsInput,
} from "./subscriptionsModel";

const NOW = 1_800_000_000_000;
const HOUR = 3_600_000;

function status(kind: string, partial: Partial<AgentStatus> = {}): AgentStatus {
  return {
    kind,
    label: kind,
    installed: true,
    authState: "authenticated",
    capabilities: {},
    ...partial,
  } as AgentStatus;
}

function snapshot(
  providerId: string,
  usedPercent: number,
  partial: Partial<UsageSnapshot> = {},
): UsageSnapshot {
  return {
    providerId,
    status: "ok",
    fetchedAt: NOW - 60_000,
    windows: [{ id: "session-5h", label: "5h", usedPercent, resetsAt: NOW + 2 * HOUR }],
    ...partial,
  } as UsageSnapshot;
}

const instances = {
  work: { id: "work", driver: "codex", displayName: "Work", config: {} },
  side: { id: "side", driver: "codex", displayName: "Side", enabled: false, config: {} },
} as AgentInstanceConfigMap;

function input(partial: Partial<SubscriptionsInput> = {}): SubscriptionsInput {
  return {
    statuses: [
      status("codex"),
      status("codex:work"),
      status("codex:side"),
      status("claude", { authState: "missing" }),
      status("gemini", { installed: false }),
      status("pi", { authState: "unknown" }),
    ],
    instances,
    disabledAgents: [],
    pools: {},
    snapshots: {
      codex: snapshot("codex", 40),
      "codex:work": snapshot("codex:work", 10),
      claude: snapshot("claude", 70, { plan: "Max" }),
    },
    disabledUsageProviders: [],
    usageSupportedIds: new Set(["codex", "codex:work", "codex:side", "claude", "gemini"]),
    usageIdFor: (kind) => kind,
    providerLabel: (id) => `P:${id}`,
    accountLabel: (kind) => `A:${kind}`,
    providerRank: (id) => ["claude", "codex", "pi"].indexOf(id),
    now: NOW,
    ...partial,
  };
}

describe("subscriptionProviderId", () => {
  it("nests profile kinds under their driver and keeps other kinds whole", () => {
    expect(subscriptionProviderId("codex:work")).toBe("codex");
    expect(subscriptionProviderId("codex")).toBe("codex");
    expect(subscriptionProviderId("acp-generic:mine")).toBe("acp-generic:mine");
  });
});

describe("accountReadiness", () => {
  it("reads disabled, not installed, needs sign-in, signed in and ready", () => {
    expect(accountReadiness("codex", status("codex"), instances, ["codex"])).toBe("disabled");
    expect(accountReadiness("codex:side", status("codex:side"), instances, [])).toBe("disabled");
    expect(accountReadiness("codex", undefined, instances, [])).toBe("not-installed");
    expect(accountReadiness("codex", status("codex", { installed: false }), instances, [])).toBe(
      "not-installed",
    );
    expect(
      accountReadiness("codex", status("codex", { authState: "missing" }), instances, []),
    ).toBe("needs-sign-in");
    expect(accountReadiness("codex", status("codex"), instances, [])).toBe("signed-in");
    expect(
      accountReadiness("codex", status("codex", { authState: "unknown" }), instances, []),
    ).toBe("ready");
  });
});

describe("buildSubscriptionProviders", () => {
  it("makes one row per owned provider with its accounts nested, in rank order", () => {
    const providers = buildSubscriptionProviders(input());
    expect(providers.map((provider) => provider.id)).toEqual(["claude", "codex", "pi"]);
    const codex = providers.find((provider) => provider.id === "codex")!;
    expect(codex.label).toBe("P:codex");
    expect(codex.supportsPool).toBe(true);
    expect(codex.pool).toBeUndefined();
    // Base account first, then profiles by label.
    expect(codex.accounts.map((account) => account.agentKind)).toEqual([
      "codex",
      "codex:side",
      "codex:work",
    ]);
    expect(codex.accounts.map((account) => account.readiness)).toEqual([
      "signed-in",
      "disabled",
      "signed-in",
    ]);
    // Not installed, not configured and no usage: no row.
    expect(providers.some((provider) => provider.id === "gemini")).toBe(false);
    expect(providers.find((provider) => provider.id === "pi")!.supportsPool).toBe(false);
  });

  it("carries plan, usage left, tone and honest usage flags per account", () => {
    const providers = buildSubscriptionProviders(input({ disabledUsageProviders: ["codex:side"] }));
    const claude = providers.find((provider) => provider.id === "claude")!.accounts[0]!;
    expect(claude.snapshot?.plan).toBe("Max");
    expect(claude.readiness).toBe("needs-sign-in");
    expect(claude.percentLeft).toBe(30);
    expect(claude.hasUsageData).toBe(true);
    const side = providers
      .find((provider) => provider.id === "codex")!
      .accounts.find((account) => account.agentKind === "codex:side")!;
    expect(side.hasUsageData).toBe(false);
    expect(side.usageTracked).toBe(false);
    expect(side.usageSupported).toBe(true);
    const pi = providers.find((provider) => provider.id === "pi")!.accounts[0]!;
    expect(pi.usageSupported).toBe(false);
    expect(pi.availability).toEqual({ kind: "unknown" });
  });

  it("orders an enabled pool's members first and judges them at its threshold", () => {
    const pools: AccountPools = {
      codex: { enabled: true, members: ["codex:work", "codex"], switchAtPercent: 90 },
    };
    const providers = buildSubscriptionProviders(
      input({
        pools,
        snapshots: {
          codex: snapshot("codex", 95, {
            windows: [{ id: "weekly", label: "Weekly", usedPercent: 95, resetsAt: NOW + 5 * HOUR }],
          }),
          "codex:work": snapshot("codex:work", 10),
        },
      }),
    );
    const codex = providers.find((provider) => provider.id === "codex")!;
    expect(codex.pool).toEqual({ size: 2, switchAtPercent: 90 });
    expect(codex.accounts.map((account) => account.agentKind)).toEqual([
      "codex:work",
      "codex",
      "codex:side",
    ]);
    expect(codex.accounts.map((account) => account.pool)).toEqual([
      { position: 1, size: 2, switchAtPercent: 90 },
      { position: 2, size: 2, switchAtPercent: 90 },
      undefined,
    ]);
    // 95% used is out at the pool's 90% rule, with the window's reset time.
    expect(codex.accounts[1]!.availability).toEqual({ kind: "exhausted", until: NOW + 5 * HOUR });
    expect(codex.accounts[1]!.tone).toBe("exhausted");
  });

  it("leaves accounts the owner left out of the pool off the Pooled badge", () => {
    const pools: AccountPools = {
      codex: {
        enabled: true,
        members: ["codex:work", "codex:personal", "codex"],
        excludedMembers: ["codex:personal"],
      },
    };
    const personal = { id: "personal", driver: "codex", displayName: "Personal", config: {} };
    const codex = buildSubscriptionProviders(
      input({
        pools,
        instances: { ...instances, personal } as AgentInstanceConfigMap,
        statuses: [status("codex"), status("codex:work"), status("codex:personal")],
      }),
    ).find((provider) => provider.id === "codex")!;
    expect(codex.pool).toEqual({ size: 2, switchAtPercent: 100 });
    const byKind = new Map(codex.accounts.map((account) => [account.agentKind, account.pool]));
    expect(byKind.get("codex:work")).toEqual({ position: 1, size: 2, switchAtPercent: 100 });
    expect(byKind.get("codex")).toEqual({ position: 2, size: 2, switchAtPercent: 100 });
    expect(byKind.get("codex:personal")).toBeUndefined();
  });

  it("ignores a disabled pool and a pool of one", () => {
    for (const pool of [
      { enabled: false, members: ["codex", "codex:work"] },
      { enabled: true, members: ["codex"] },
      // Two listed, but only one left in the pool.
      { enabled: true, members: ["codex", "codex:work"], excludedMembers: ["codex:work"] },
    ]) {
      const codex = buildSubscriptionProviders(input({ pools: { codex: pool } })).find(
        (provider) => provider.id === "codex",
      )!;
      expect(codex.pool).toBeUndefined();
      expect(codex.accounts.every((account) => account.pool === undefined)).toBe(true);
    }
  });

  it("shows a usage-only provider once, on the kind that owns the meter", () => {
    const providers = buildSubscriptionProviders(
      input({
        statuses: [status("meter", { installed: false }), status("alias", { installed: false })],
        instances: {},
        snapshots: { meter: snapshot("meter", 20) },
        usageIdFor: (kind) => (kind === "alias" ? "meter" : kind),
      }),
    );
    expect(providers.map((provider) => provider.id)).toEqual(["meter"]);
    expect(providers[0]!.accounts[0]!.readiness).toBe("not-installed");
  });

  it("does not read a hidden zero credit balance next to live windows as out of usage", () => {
    const providers = buildSubscriptionProviders(
      input({
        snapshots: {
          // No extra credits bought: a zero balance the usage panel hides.
          codex: snapshot("codex", 40, { credits: { balance: 0 } }),
          // Credits are the only meter, so a zero balance is out.
          claude: snapshot("claude", 0, { windows: [], credits: { balance: 0 } }),
        },
      }),
    );
    const codex = providers.find((provider) => provider.id === "codex")!.accounts[0]!;
    expect(codex.availability).toEqual({ kind: "available", headroomPercent: 60 });
    expect(codex.percentLeft).toBe(60);
    expect(codex.tone).toBe("ok");
    const claude = providers.find((provider) => provider.id === "claude")!.accounts[0]!;
    expect(claude.availability).toEqual({ kind: "exhausted" });
    expect(claude.hasUsageData).toBe(true);
  });

  it("uses the first status row per kind (native before WSL)", () => {
    const providers = buildSubscriptionProviders(
      input({
        statuses: [status("pi"), status("pi", { authState: "missing" })],
        instances: {},
      }),
    );
    expect(providers[0]!.accounts[0]!.readiness).toBe("signed-in");
  });
});

describe("summarizeRoom", () => {
  it("ranks ready accounts by usage left and lists the ones out by soonest reset", () => {
    const pools: AccountPools = {
      codex: { enabled: true, members: ["codex", "codex:work"], switchAtPercent: 90 },
    };
    const providers = buildSubscriptionProviders(
      input({
        pools,
        statuses: [
          status("codex"),
          status("codex:work"),
          status("claude"),
          status("claude:alt", { authState: "missing" }),
          status("pi"),
        ],
        instances: {
          work: { id: "work", driver: "codex", config: {} },
          alt: { id: "alt", driver: "claude", config: {} },
        } as AgentInstanceConfigMap,
        snapshots: {
          codex: snapshot("codex", 92, {
            windows: [{ id: "5h", label: "5h", usedPercent: 92, resetsAt: NOW + 3 * HOUR }],
          }),
          "codex:work": snapshot("codex:work", 55),
          claude: snapshot("claude", 20),
          "claude:alt": snapshot("claude:alt", 0),
          pi: snapshot("pi", 100, {
            windows: [{ id: "d", label: "Daily", usedPercent: 100, resetsAt: NOW + HOUR }],
          }),
        },
      }),
    );
    const summary = summarizeRoom(providers, NOW);
    // claude:alt has room but needs sign-in, so it is not offered.
    expect(summary.room.map((entry) => [entry.agentKind, entry.percentLeft])).toEqual([
      ["claude", 80],
      ["codex:work", 45],
    ]);
    // codex is out by its pool's 90% rule even though 8% is technically left.
    expect(summary.out.map((entry) => [entry.agentKind, entry.until])).toEqual([
      ["pi", NOW + HOUR],
      ["codex", NOW + 3 * HOUR],
    ]);
  });

  it("lists accounts sharing one meter once and skips unknown usage", () => {
    const providers = buildSubscriptionProviders(
      input({
        statuses: [status("devin"), status("devin:a"), status("pi")],
        instances: { a: { id: "a", driver: "devin", config: {} } } as AgentInstanceConfigMap,
        snapshots: { devin: snapshot("devin", 30) },
        usageIdFor: (kind) => (kind.startsWith("devin") ? "devin" : kind),
      }),
    );
    const summary = summarizeRoom(providers, NOW);
    expect(summary.room.map((entry) => entry.agentKind)).toEqual(["devin"]);
    expect(summary.out).toEqual([]);
  });

  it("claims no room for accounts without usage windows and ranks hidden zero balances", () => {
    const providers = buildSubscriptionProviders(
      input({
        statuses: [status("codex"), status("claude"), status("pi")],
        instances: {},
        snapshots: {
          codex: snapshot("codex", 30, { credits: { balance: 0 } }),
          // A plan alone, and a credit balance alone: no percentage to rank.
          claude: snapshot("claude", 0, { windows: [], plan: "Max" }),
          pi: snapshot("pi", 0, { windows: [], credits: { balance: 12 } }),
        },
      }),
    );
    const summary = summarizeRoom(providers, NOW);
    expect(summary.room.map((entry) => [entry.agentKind, entry.percentLeft])).toEqual([
      ["codex", 70],
    ]);
    expect(summary.out).toEqual([]);
  });
});

describe("lastUsageUpdate", () => {
  it("returns the newest fetch time, or 0 without snapshots", () => {
    expect(lastUsageUpdate(buildSubscriptionProviders(input()))).toBe(NOW - 60_000);
    expect(lastUsageUpdate(buildSubscriptionProviders(input({ snapshots: {} })))).toBe(0);
  });
});
