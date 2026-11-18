import { describe, expect, it } from "vitest";
import type { AgentInstanceConfigMap } from "@/shared/contracts";
import { AGENT_PROFILE_DRIVERS } from "@/shared/contracts/agentProfiles";
import { profileUsageAccountResolver, usageAccountIdForAgent } from "@/shared/usageAccountId";
import { USAGE_PROFILE_SUPPORT } from "./usageProfileRegistry";
import { usageProviderIdForAgent } from "./usageProviders";

// ViscosityCode: the host resolves usage accounts through the shared registry
// while the renderer keeps its own registrations; both must agree.
describe("usage account parity between renderer and host", () => {
  it("declares the same shared-meter resolvers in both registries", () => {
    const drivers = AGENT_PROFILE_DRIVERS.map((entry) => entry.driver);
    const shared = drivers.map((driver) => [driver, profileUsageAccountResolver(driver)]);
    const renderer = drivers.map((driver) => [
      driver,
      USAGE_PROFILE_SUPPORT.find((entry) => entry.driver === driver)?.providerId,
    ]);
    expect(shared).toEqual(renderer);
    expect(shared.some(([, resolver]) => resolver !== undefined)).toBe(true);
  });

  it("resolves every profile kind to the same usage id", () => {
    const instances: AgentInstanceConfigMap = {
      work: {
        id: "work",
        driver: "devin",
        displayName: "Work",
        config: { format: 1, auth: { kind: "isolated-owner" } },
      },
      review: {
        id: "review",
        driver: "devin",
        displayName: "Review",
        config: { format: 1, auth: { kind: "owner-reference", ownerId: "work" } },
      },
      writer: { id: "writer", driver: "claude", displayName: "Writer" },
      team: { id: "team", driver: "codex", displayName: "Team" },
    };
    const kinds = [
      "devin",
      "devin:work",
      "devin:review",
      "claude",
      "claude:writer",
      "codex:team",
      "gemini",
    ];
    const shared = kinds.map((kind) => [kind, usageAccountIdForAgent(kind, undefined, instances)]);
    const renderer = kinds.map((kind) => [
      kind,
      usageProviderIdForAgent(kind, undefined, instances),
    ]);
    expect(shared).toEqual(renderer);
    expect(Object.fromEntries(shared)).toMatchObject({ "devin:review": "devin:work" });
  });
});
