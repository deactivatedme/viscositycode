import { describe, expect, it } from "vitest";
import type { AccountPools } from "@/shared/accountPools";
import type { AgentInstanceConfigMap, AgentStatus, UsageSnapshot } from "@/shared/contracts";
import {
  activePoolFor,
  bestPoolMembersByDriver,
  buildPoolMemberViews,
  driverAccountKinds,
  moveMember,
  poolPreferredAgentKind,
  poolUsageTone,
  preferBestPoolMembers,
  reorderMember,
  resolvePoolOrder,
  enabledPoolMembers,
  updatedPool,
  usagePercentLeft,
  withMemberIncluded,
} from "./poolModel";

const NOW = 1_800_000_000_000;

const instances: AgentInstanceConfigMap = {
  work: { id: "work", driver: "codex", displayName: "Work", config: {} },
  personal: { id: "personal", driver: "codex", displayName: "Personal", config: {} },
  off: { id: "off", driver: "codex", displayName: "Off", enabled: false, config: {} },
  other: { id: "other", driver: "claude", displayName: "Other", config: {} },
} as AgentInstanceConfigMap;

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

function snapshot(providerId: string, usedPercent: number, resetsAt?: number): UsageSnapshot {
  return {
    providerId,
    status: "ok",
    fetchedAt: NOW,
    windows: [
      { id: "5h", label: "5h", usedPercent, ...(resetsAt !== undefined ? { resetsAt } : {}) },
    ],
  };
}

describe("pool ordering", () => {
  it("lists the base account first, then enabled profiles by name", () => {
    expect(driverAccountKinds("codex", instances)).toEqual([
      "codex",
      "codex:personal",
      "codex:work",
    ]);
  });

  it("keeps the saved order, drops removed accounts and appends new ones", () => {
    expect(
      resolvePoolOrder(
        ["codex:work", "codex:gone", "codex", "codex:work"],
        ["codex", "codex:personal", "codex:work"],
      ),
    ).toEqual(["codex:work", "codex", "codex:personal"]);
    expect(resolvePoolOrder(undefined, ["codex", "codex:work"])).toEqual(["codex", "codex:work"]);
  });

  it("moves members by arrows and by drag, clamped to the list", () => {
    const order = ["a", "b", "c"];
    expect(moveMember(order, "c", -1)).toEqual(["a", "c", "b"]);
    expect(moveMember(order, "a", -1)).toEqual(["a", "b", "c"]);
    expect(moveMember(order, "a", 5)).toEqual(["b", "c", "a"]);
    expect(moveMember(order, "missing", 1)).toEqual(order);
    expect(reorderMember(order, 0, 2)).toEqual(["b", "c", "a"]);
    expect(reorderMember(order, 0, 9)).toEqual(order);
  });

  it("writes the full order and keeps the default threshold implicit", () => {
    expect(updatedPool(undefined, ["codex", "codex:work"], { enabled: true })).toEqual({
      enabled: true,
      members: ["codex", "codex:work"],
    });
    const pool = updatedPool({ enabled: true, members: ["codex"], switchAtPercent: 90 }, [
      "codex:work",
      "codex",
    ]);
    expect(pool).toEqual({ enabled: true, members: ["codex:work", "codex"], switchAtPercent: 90 });
    expect(updatedPool(pool, pool.members, { switchAtPercent: 100 })).toEqual({
      enabled: true,
      members: ["codex:work", "codex"],
    });
  });
});

describe("activePoolFor", () => {
  const pools: AccountPools = {
    codex: { enabled: true, members: ["codex:work", "codex", "codex:gone"] },
    claude: { enabled: false, members: ["claude", "claude:other"] },
  };

  it("resolves enabled pools with at least two existing members", () => {
    expect(activePoolFor("codex", pools, instances)?.members).toEqual(["codex:work", "codex"]);
    expect(activePoolFor("codex:personal", pools, instances)).toBeUndefined();
    expect(activePoolFor("claude", pools, instances)).toBeUndefined();
    expect(
      activePoolFor("codex", { codex: { enabled: true, members: ["codex"] } }, instances),
    ).toBeUndefined();
  });

  it("never pools a driver without profiles", () => {
    expect(
      activePoolFor("copilot", { copilot: { enabled: true, members: ["copilot", "x"] } }, {}),
    ).toBeUndefined();
  });
});

describe("usage readouts", () => {
  it("reports usage left from the most-used live window", () => {
    expect(usagePercentLeft(snapshot("codex", 38), NOW)).toBe(62);
    expect(usagePercentLeft(snapshot("codex", 100, NOW - 1), NOW)).toBeUndefined();
    expect(usagePercentLeft(undefined, NOW)).toBeUndefined();
    expect(usagePercentLeft({ ...snapshot("codex", 0), status: "rate-limited" }, NOW)).toBe(
      undefined,
    );
    // A zero balance next to live windows (no extra credits bought) is not the meter.
    expect(usagePercentLeft({ ...snapshot("codex", 10), credits: { balance: 0 } }, NOW)).toBe(90);
    // A credit-only account whose balance ran out has nothing left.
    expect(
      usagePercentLeft({ ...snapshot("codex", 10), windows: [], credits: { balance: 0 } }, NOW),
    ).toBe(0);
    expect(
      usagePercentLeft({ ...snapshot("codex", 10), windows: [], credits: { balance: 5 } }, NOW),
    ).toBeUndefined();
  });

  it("tones amber when running low and red when out", () => {
    expect(poolUsageTone({ kind: "available", headroomPercent: 50 })).toBe("ok");
    expect(poolUsageTone({ kind: "available", headroomPercent: 20 })).toBe("low");
    expect(poolUsageTone({ kind: "exhausted" })).toBe("exhausted");
    expect(poolUsageTone({ kind: "unknown" })).toBe("unknown");
  });

  it("builds member views with readiness, threshold and tracking", () => {
    const views = buildPoolMemberViews({
      order: ["codex", "codex:work"],
      statuses: [status("codex"), status("codex:work", { authState: "missing" })],
      disabledAgents: [],
      instances,
      snapshots: { codex: snapshot("codex", 92, NOW + 60_000) },
      disabledUsageProviders: ["codex:work"],
      labelFor: (kind) => `label ${kind}`,
      switchAtPercent: 90,
      now: NOW,
    });
    expect(views[0]).toMatchObject({
      agentKind: "codex",
      ready: true,
      label: "label codex",
      percentLeft: 8,
      tone: "exhausted",
      availability: { kind: "exhausted", until: NOW + 60_000 },
      usageTracked: true,
    });
    expect(views[1]).toMatchObject({
      agentKind: "codex:work",
      ready: false,
      tone: "unknown",
      usageTracked: false,
    });
  });
});

describe("new-thread account choice", () => {
  const pools: AccountPools = { codex: { enabled: true, members: ["codex", "codex:work"] } };
  const snapshots = {
    codex: snapshot("codex", 95),
    "codex:work": snapshot("codex:work", 20),
  };

  it("pre-selects the pooled account with the most usage left", () => {
    expect(
      poolPreferredAgentKind({
        preferred: "codex",
        candidates: [status("codex"), status("codex:work")],
        pools,
        instances,
        snapshots,
        now: NOW,
      }),
    ).toEqual({ agentKind: "codex:work", pooled: true });
  });

  it("keeps the composer's pick when the provider is not pooled or nothing is ready", () => {
    const base = {
      candidates: [status("codex"), status("codex:work")],
      instances,
      snapshots,
      now: NOW,
    };
    expect(poolPreferredAgentKind({ ...base, preferred: "claude", pools })).toEqual({
      agentKind: "claude",
      pooled: false,
    });
    expect(
      poolPreferredAgentKind({
        ...base,
        preferred: "codex",
        pools: { codex: { enabled: false, members: ["codex", "codex:work"] } },
      }),
    ).toEqual({ agentKind: "codex", pooled: false });
    expect(
      poolPreferredAgentKind({
        ...base,
        preferred: "codex",
        pools,
        candidates: [status("codex", { authState: "missing" })],
      }),
    ).toEqual({ agentKind: "codex", pooled: false });
    expect(poolPreferredAgentKind({ ...base, preferred: undefined, pools }).agentKind).toBe(
      undefined,
    );
  });

  it("keeps the composer's pick on a tie and claims nothing when usage is unknown", () => {
    const base = {
      preferred: "codex:work",
      candidates: [status("codex"), status("codex:work")],
      pools,
      instances,
      now: NOW,
    };
    // No usage known for any account: the pick stays, without a "most usage left" claim.
    expect(poolPreferredAgentKind({ ...base, snapshots: {} })).toEqual({
      agentKind: "codex:work",
      pooled: false,
    });
    // Equal headroom: the pick stays, and it does have the most usage left.
    expect(
      poolPreferredAgentKind({
        ...base,
        snapshots: { codex: snapshot("codex", 40), "codex:work": snapshot("codex:work", 40) },
      }),
    ).toEqual({ agentKind: "codex:work", pooled: true });
    // An account with known headroom beats one whose usage is unknown.
    expect(
      poolPreferredAgentKind({ ...base, snapshots: { codex: snapshot("codex", 40) } }),
    ).toEqual({ agentKind: "codex", pooled: true });
  });

  it("skips signed-out accounts", () => {
    expect(
      poolPreferredAgentKind({
        preferred: "codex",
        candidates: [status("codex"), status("codex:work", { authState: "missing" })],
        pools,
        instances,
        snapshots,
        now: NOW,
      }).agentKind,
    ).toBe("codex");
  });
});

describe("Roundtable preference", () => {
  it("finds each enabled pool's best ready member", () => {
    expect(
      bestPoolMembersByDriver({
        pools: {
          codex: { enabled: true, members: ["codex", "codex:work"] },
          claude: { enabled: false, members: ["claude", "claude:other"] },
        },
        statuses: [status("codex"), status("codex:work")],
        disabledAgents: [],
        instances,
        snapshots: { codex: snapshot("codex", 99), "codex:work": snapshot("codex:work", 10) },
        now: NOW,
      }),
    ).toEqual({ codex: "codex:work" });
  });

  it("moves the best account to the front of its provider's entries only", () => {
    const entries = [
      { agentKind: "claude" },
      { agentKind: "codex" },
      { agentKind: "gemini" },
      { agentKind: "codex:work" },
    ];
    expect(
      preferBestPoolMembers(entries, { codex: "codex:work" }).map((entry) => entry.agentKind),
    ).toEqual(["claude", "codex:work", "codex", "gemini"]);
    expect(preferBestPoolMembers(entries, {})).toEqual(entries);
    expect(preferBestPoolMembers(entries, { codex: "codex" })).toEqual(entries);
  });
});

// ViscosityCode: account pool follow-ups — accounts left out of a pool.
describe("left-out pool members", () => {
  const profiles = {
    work: { id: "work", driver: "codex", displayName: "Work" },
    home: { id: "home", driver: "codex", displayName: "Home" },
  };
  const order = ["codex", "codex:work", "codex:home"];

  it("writes the exclusion list only when an account is left out", () => {
    const out = updatedPool(undefined, order, { enabled: true, excludedMembers: ["codex:work"] });
    expect(out).toEqual({ enabled: true, members: order, excludedMembers: ["codex:work"] });
    // Other edits keep the saved exclusions; including everyone drops the key.
    expect(updatedPool(out, order, { switchAtPercent: 90 }).excludedMembers).toEqual([
      "codex:work",
    ]);
    expect(updatedPool(out, order, { excludedMembers: [] })).toEqual({
      enabled: true,
      members: order,
    });
    // Unknown or duplicate entries never reach the stored list.
    expect(
      updatedPool(out, order, { excludedMembers: ["codex:gone", "codex:home", "codex:home"] })
        .excludedMembers,
    ).toEqual(["codex:home"]);
  });

  it("toggles one account in or out", () => {
    const pool = { enabled: true, members: order, excludedMembers: ["codex:work"] };
    expect(withMemberIncluded(pool, "codex:home", false)).toEqual(["codex:work", "codex:home"]);
    expect(withMemberIncluded(pool, "codex:work", true)).toEqual([]);
    expect(withMemberIncluded(undefined, "codex", false)).toEqual(["codex"]);
  });

  it("leaves excluded accounts out of the members in use", () => {
    const pool = { enabled: true, members: order, excludedMembers: ["codex:work"] };
    expect(enabledPoolMembers("codex", pool, profiles)).toEqual(["codex", "codex:home"]);
    expect(activePoolFor("codex:work", { codex: pool }, profiles)).toBeUndefined();
    expect(
      enabledPoolMembers(
        "codex",
        { ...pool, excludedMembers: ["codex:work", "codex:home"] },
        profiles,
      ),
    ).toBeUndefined();
  });
});
