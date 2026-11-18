import { describe, expect, it } from "vitest";
import type { UsageSnapshot } from "@poracode/agents-usage/types";
import type { AgentInstanceConfig, AgentInstanceConfigMap } from "./contracts/agentInstance";
import {
  nextPoolMember,
  normalizeAccountPools,
  normalizePoolMembers,
  parseStoredAccountPools,
  poolForAgentKind,
  poolMemberStates,
  poolUsageAccountIds,
  removePoolMember,
  type AccountPool,
  type PoolAgentStatus,
  type PoolMemberState,
} from "./accountPools";

const NOW = 1_800_000_000_000;

const codexProfile = (
  id: string,
  extra: Partial<AgentInstanceConfig> = {},
): AgentInstanceConfig => ({
  id,
  driver: "codex",
  displayName: id,
  ...extra,
});
const devinProfile = (id: string, auth: unknown): AgentInstanceConfig => ({
  id,
  driver: "devin",
  displayName: id,
  config: { format: 1, auth },
});

const instances: AgentInstanceConfigMap = {
  work: codexProfile("work"),
  home: codexProfile("home"),
  off: codexProfile("off", { enabled: false }),
  writer: { id: "writer", driver: "claude", displayName: "Writer" },
};

function usage(providerId: string, usedPercent: number, resetsAt?: number): UsageSnapshot {
  return {
    providerId,
    status: "ok",
    fetchedAt: NOW,
    windows: [
      { id: "5h", label: "5h", usedPercent, ...(resetsAt === undefined ? {} : { resetsAt }) },
    ],
  };
}

function status(kind: string, partial: Partial<PoolAgentStatus> = {}): PoolAgentStatus {
  return { kind, installed: true, authState: "authenticated", ...partial };
}

describe("account pool normalization", () => {
  it("keeps only profile drivers and the driver's own, still configured, unique members", () => {
    const pools = normalizeAccountPools(
      {
        codex: {
          enabled: true,
          members: ["codex:work", "codex", "codex:work", "claude:writer", "codex:gone", "codex:"],
          switchAtPercent: 90,
        },
        "acp-generic": { enabled: true, members: ["acp-generic:x"] },
        future: { enabled: true, members: ["future"] },
      },
      instances,
    );
    expect(pools).toEqual({
      codex: { enabled: true, members: ["codex:work", "codex"], switchAtPercent: 90 },
    });
  });

  it("keeps profiles it cannot check when the instance map is unknown", () => {
    expect(normalizePoolMembers("codex", ["codex:gone", "claude:writer", "codex"])).toEqual([
      "codex:gone",
      "codex",
    ]);
  });

  it("finds the pool an account belongs to, ignoring non-members and other drivers", () => {
    const pools = {
      codex: { enabled: false, members: ["codex", "codex:work", "codex:gone"] },
    } satisfies Record<string, AccountPool>;
    expect(poolForAgentKind(pools, "codex:work", instances)).toEqual({
      enabled: false,
      members: ["codex", "codex:work"],
    });
    expect(poolForAgentKind(pools, "codex:home", instances)).toBeUndefined();
    expect(poolForAgentKind(pools, "codex:gone", instances)).toBeUndefined();
    expect(poolForAgentKind(pools, "claude:writer", instances)).toBeUndefined();
    expect(poolForAgentKind(undefined, "codex", instances)).toBeUndefined();
    expect(poolForAgentKind({ constructor: pools.codex }, "constructor")).toBeUndefined();
  });

  it("removes a deleted account from every pool without touching the rest", () => {
    const pools = {
      codex: { enabled: true, members: ["codex", "codex:work"], switchAtPercent: 80 },
      claude: { enabled: true, members: ["claude"] },
    };
    const before = structuredClone(pools);
    expect(removePoolMember(pools, "codex:work")).toEqual({
      codex: { enabled: true, members: ["codex"], switchAtPercent: 80 },
      claude: { enabled: true, members: ["claude"] },
    });
    expect(pools).toEqual(before);
    expect(removePoolMember(undefined, "codex:work")).toEqual({});
  });

  it("drops a malformed stored pool on its own in the lenient reader", () => {
    expect(
      parseStoredAccountPools({
        codex: { enabled: true, members: ["codex", "codex:work"] },
        claude: { enabled: "yes", members: [] },
        gemini: { enabled: true, members: ["gemini"], switchAtPercent: 5 },
      }),
    ).toEqual({ codex: { enabled: true, members: ["codex", "codex:work"] } });
    const reserved = parseStoredAccountPools(
      JSON.parse('{"__proto__":{"enabled":true,"members":["codex"]}}'),
    );
    expect(Object.getPrototypeOf(reserved)).toBe(Object.prototype);
    expect(Object.hasOwn(reserved, "__proto__")).toBe(true);
    expect(parseStoredAccountPools(undefined)).toEqual({});
    expect(parseStoredAccountPools(["codex"])).toEqual({});
  });
});

describe("pool member states", () => {
  const pool: AccountPool = {
    enabled: true,
    members: ["codex", "codex:work", "codex:home", "codex:off"],
    switchAtPercent: 90,
  };

  it("derives readiness from install, enablement and sign-in, and usage from each account", () => {
    const states = poolMemberStates(pool, {
      agentStatuses: [
        status("codex"),
        status("codex:work", { authState: "unknown" }),
        status("codex:home", { authState: "missing" }),
        status("codex:off"),
      ],
      usageSnapshots: {
        codex: usage("codex", 95, NOW + 60_000),
        "codex:work": usage("codex:work", 30),
      },
      now: NOW,
      agentInstances: instances,
    });
    expect(states).toEqual([
      {
        agentKind: "codex",
        ready: true,
        availability: { kind: "exhausted", until: NOW + 60_000 },
        usageAccountId: "codex",
      },
      {
        agentKind: "codex:work",
        ready: true,
        availability: { kind: "available", headroomPercent: 60 },
        usageAccountId: "codex:work",
      },
      {
        agentKind: "codex:home",
        ready: false,
        availability: { kind: "unknown" },
        usageAccountId: "codex:home",
      },
      {
        agentKind: "codex:off",
        ready: false,
        availability: { kind: "unknown" },
        usageAccountId: "codex:off",
      },
    ]);
    expect(nextPoolMember(states, "codex")).toBe("codex:work");
  });

  it("is not ready when missing, not installed, disabled or signed out for the presentation", () => {
    const states = poolMemberStates(
      { enabled: true, members: ["codex", "codex:work", "codex:home", "codex:gone"] },
      {
        agentStatuses: [
          status("codex", { installed: false }),
          status("codex:work", { presentationAuthStates: { gui: "missing" } }),
          status("codex:home"),
          status("codex:gone"),
        ],
        usageSnapshots: new Map(),
        now: NOW,
        disabledAgents: ["codex:home"],
        agentInstances: instances,
        presentation: "gui",
      },
    );
    expect(states.map((state) => state.ready)).toEqual([false, false, false, false]);
  });

  it("reads snapshots from a map or a usage response list", () => {
    const fromMap = poolMemberStates(
      { enabled: true, members: ["codex:work"] },
      {
        agentStatuses: [status("codex:work")],
        usageSnapshots: new Map([["codex:work", usage("codex:work", 100)]]),
        now: NOW,
      },
    );
    const fromList = poolMemberStates(
      { enabled: true, members: ["codex:work"] },
      {
        agentStatuses: [status("codex:work")],
        usageSnapshots: [usage("codex", 0), usage("codex:work", 100)],
        now: NOW,
      },
    );
    expect(fromMap[0]!.availability.kind).toBe("exhausted");
    expect(fromList[0]!.availability.kind).toBe("exhausted");
  });

  it("never fails over between accounts that share one meter", () => {
    const owner = devinProfile("work", { kind: "isolated-owner" });
    const reference = devinProfile("review", { kind: "owner-reference", ownerId: "work" });
    const solo = devinProfile("solo", { kind: "isolated-owner" });
    const devinInstances = { work: owner, review: reference, solo };
    const states = poolMemberStates(
      { enabled: true, members: ["devin:work", "devin:review", "devin:solo"] },
      {
        agentStatuses: [status("devin:work"), status("devin:review"), status("devin:solo")],
        usageSnapshots: {},
        now: NOW,
        agentInstances: devinInstances,
      },
    );
    expect(states.map((state) => state.usageAccountId)).toEqual([
      "devin:work",
      "devin:work",
      "devin:solo",
    ]);
    expect(nextPoolMember(states, "devin:work")).toBe("devin:solo");
    expect(nextPoolMember(states, "devin:solo", new Set(["devin:work"]))).toBeUndefined();
  });

  it("keeps the original failover order for states without usage ids", () => {
    const states: PoolMemberState[] = [
      { agentKind: "codex", ready: true, availability: { kind: "unknown" } },
      { agentKind: "codex:work", ready: true, availability: { kind: "unknown" } },
    ];
    expect(nextPoolMember(states, "codex")).toBe("codex:work");
  });
});

describe("pool usage accounts", () => {
  it("lists the meters of enabled pools only, once each", () => {
    const devinInstances: AgentInstanceConfigMap = {
      ...instances,
      work: devinProfile("work", { kind: "isolated-owner" }),
      review: devinProfile("review", { kind: "owner-reference", ownerId: "work" }),
    };
    expect(
      poolUsageAccountIds(
        {
          devin: { enabled: true, members: ["devin", "devin:work", "devin:review"] },
          claude: { enabled: false, members: ["claude", "claude:writer"] },
        },
        devinInstances,
      ),
    ).toEqual(["devin", "devin:work"]);
  });
});
