// ViscosityCode: accounts the owner leaves out of a pool (`excludedMembers`).
import { describe, expect, it } from "vitest";
import type { AgentInstanceConfigMap } from "./contracts/agentInstance";
import {
  accountPoolSchema,
  isPoolMemberExcluded,
  normalizeAccountPools,
  parseStoredAccountPools,
  poolForAgentKind,
  poolMembersInUse,
  poolUsageAccountIds,
  removePoolMember,
  type AccountPool,
} from "./accountPools";
import { usageCollectionDisabledProviders } from "./accountPoolUsage";
import { defaultSharedSettings } from "./settings";

const instances: AgentInstanceConfigMap = {
  work: { id: "work", driver: "codex", displayName: "Work" },
  home: { id: "home", driver: "codex", displayName: "Home" },
  team: { id: "team", driver: "gemini", displayName: "Team" },
};

const pool: AccountPool = {
  enabled: true,
  members: ["codex", "codex:work", "codex:home"],
  excludedMembers: ["codex:work"],
};

describe("left-out pool members", () => {
  it("parses pools written before exclusions existed without adding the key", () => {
    const legacy = { enabled: true, members: ["codex", "codex:work"] };
    const parsed = accountPoolSchema.parse(legacy);
    expect(parsed).toEqual(legacy);
    expect(Object.hasOwn(parsed, "excludedMembers")).toBe(false);
    expect(parseStoredAccountPools({ codex: legacy })).toEqual({ codex: legacy });
  });

  it("round-trips an exclusion list and rejects a malformed one on its own", () => {
    expect(parseStoredAccountPools({ codex: pool })).toEqual({ codex: pool });
    expect(
      parseStoredAccountPools({
        codex: { ...pool, excludedMembers: "codex:work" },
        gemini: { enabled: true, members: ["gemini"] },
      }),
    ).toEqual({ gemini: { enabled: true, members: ["gemini"] } });
  });

  it("keeps left-out accounts in the order but out of the members in use", () => {
    expect(isPoolMemberExcluded(pool, "codex:work")).toBe(true);
    expect(isPoolMemberExcluded(pool, "codex")).toBe(false);
    expect(poolMembersInUse("codex", pool, instances)).toEqual(["codex", "codex:home"]);
    expect(normalizeAccountPools({ codex: pool }, instances)).toEqual({
      codex: { enabled: true, members: ["codex", "codex:home"] },
    });
  });

  it("does not treat a left-out account as a pool member", () => {
    expect(poolForAgentKind({ codex: pool }, "codex:work", instances)).toBeUndefined();
    expect(poolForAgentKind({ codex: pool }, "codex:home", instances)).toEqual({
      enabled: true,
      members: ["codex", "codex:home"],
    });
  });

  it("does not collect a left-out account's usage on the pool's behalf", () => {
    expect(poolUsageAccountIds({ codex: pool }, instances)).toEqual(["codex", "codex:home"]);
    const gemini: AccountPool = {
      enabled: true,
      members: ["gemini", "gemini:team"],
      excludedMembers: ["gemini"],
    };
    expect(
      usageCollectionDisabledProviders({
        usage: { ...defaultSharedSettings.usage, disabledProviders: ["gemini", "cursor"] },
        accountPools: { gemini },
        agentInstances: instances,
      }),
    ).toEqual(["gemini", "cursor"]);
  });

  it("forces no usage collection for a pool with fewer than two accounts in use", () => {
    // The host cannot fail over within such a pool (`resolveAccountPool`).
    const one: AccountPool = { ...pool, excludedMembers: ["codex:work", "codex:home"] };
    expect(poolUsageAccountIds({ codex: one }, instances)).toEqual([]);
    expect(poolUsageAccountIds({ codex: { enabled: true, members: ["codex"] } })).toEqual([]);
    // A removed profile does not count towards the two either.
    expect(
      poolUsageAccountIds(
        { codex: { enabled: true, members: ["codex", "codex:gone"] } },
        instances,
      ),
    ).toEqual([]);
    expect(
      usageCollectionDisabledProviders({
        usage: { ...defaultSharedSettings.usage, disabledProviders: ["gemini", "cursor"] },
        accountPools: { gemini: { enabled: true, members: ["gemini"] } },
        agentInstances: instances,
      }),
    ).toEqual(["gemini", "cursor"]);
    // Two accounts in use: both are collected.
    expect(poolUsageAccountIds({ codex: pool }, instances)).toEqual(["codex", "codex:home"]);
  });

  it("removes a deleted profile from the order and the exclusion list", () => {
    expect(removePoolMember({ codex: pool }, "codex:work")).toEqual({
      codex: { enabled: true, members: ["codex", "codex:home"] },
    });
    const twoLeftOut = { ...pool, excludedMembers: ["codex:work", "codex:home"] };
    expect(removePoolMember({ codex: twoLeftOut }, "codex:work")).toEqual({
      codex: { enabled: true, members: ["codex", "codex:home"], excludedMembers: ["codex:home"] },
    });
    // A pool that never listed the account is returned as stored.
    const other = { enabled: false, members: ["gemini"] };
    expect(removePoolMember({ gemini: other }, "codex:work").gemini).toBe(other);
  });
});
