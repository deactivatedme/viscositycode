import { describe, expect, it } from "vitest";
import type { AgentInstanceConfig, AgentInstanceConfigMap } from "./contracts/agentInstance";
import { AGENT_PROFILE_DRIVERS } from "./contracts/agentProfiles";
import { profileUsageAccountResolver, usageAccountIdForAgent } from "./usageAccountId";

const devinProfile = (id: string, auth: unknown, extra: Partial<AgentInstanceConfig> = {}) =>
  ({ id, driver: "devin", displayName: id, config: { format: 1, auth }, ...extra }) as const;

describe("shared usage account ids", () => {
  it("meters a base kind under its own id unless a client supplies an alias", () => {
    expect(usageAccountIdForAgent("codex", undefined, undefined)).toBe("codex");
    expect(
      usageAccountIdForAgent("alias", undefined, undefined, {
        baseUsageProviderId: (driver) => (driver === "alias" ? "target" : undefined),
      }),
    ).toBe("target");
  });

  it("meters each profile under its own kind, from the suffix or an explicit instance id", () => {
    const instances: AgentInstanceConfigMap = {
      work: { id: "work", driver: "codex", displayName: "Work" },
    };
    expect(usageAccountIdForAgent("codex:work", undefined, instances)).toBe("codex:work");
    expect(usageAccountIdForAgent("codex", "work", instances)).toBe("codex:work");
    expect(usageAccountIdForAgent("codex:gone", undefined, instances)).toBe("codex:gone");
  });

  it("resolves profiles that share a login to their owner, never to another account", () => {
    const instances: AgentInstanceConfigMap = {
      work: devinProfile("work", { kind: "isolated-owner" }),
      review: devinProfile("review", { kind: "owner-reference", ownerId: "work" }),
      native: devinProfile("native", { kind: "native-default" }),
      orphan: devinProfile("orphan", { kind: "owner-reference", ownerId: "missing" }),
      mislabeled: { id: "mislabeled", driver: "codex", displayName: "Codex" },
    };
    expect(usageAccountIdForAgent("devin:review", undefined, instances)).toBe("devin:work");
    expect(usageAccountIdForAgent("devin:native", undefined, instances)).toBe("devin");
    expect(usageAccountIdForAgent("devin:orphan", undefined, instances)).toBe("devin:orphan");
    expect(usageAccountIdForAgent("devin:mislabeled", undefined, instances)).toBe(
      "devin:mislabeled",
    );
    expect(usageAccountIdForAgent("devin:review", undefined, undefined)).toBe("devin:review");
  });

  it("lets a client replace the shared profile registry", () => {
    const instances: AgentInstanceConfigMap = {
      review: devinProfile("review", { kind: "owner-reference", ownerId: "work" }),
    };
    expect(
      usageAccountIdForAgent("devin:review", undefined, instances, {
        profileUsageAccountId: () => undefined,
      }),
    ).toBe("devin:review");
  });

  it("registers shared-meter resolvers only for profile drivers", () => {
    const withResolver = AGENT_PROFILE_DRIVERS.map((entry) => entry.driver).filter(
      (driver) => profileUsageAccountResolver(driver) !== undefined,
    );
    expect(withResolver).toEqual(["devin"]);
    expect(profileUsageAccountResolver("acp-generic")).toBeUndefined();
  });
});
