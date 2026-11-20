import { describe, expect, it } from "vitest";
import type { UsageSnapshot } from "@/shared/contracts";
import { pickProfileIdentity, profileInitial } from "./profileIdentity";

function snapshot(providerId: string, overrides: Partial<UsageSnapshot> = {}): UsageSnapshot {
  return { providerId, status: "ok", windows: [], fetchedAt: 1, ...overrides } as UsageSnapshot;
}

const RANK: Record<string, number> = { first: 1, second: 2, third: 3 };
const rank = (id: string) => RANK[id] ?? 99;

describe("pickProfileIdentity", () => {
  it("takes the first OK snapshot in provider rank order and shows the email local part", () => {
    expect(
      pickProfileIdentity(
        {
          third: snapshot("third", { authenticatedAs: "z@x.dev", plan: "Free" }),
          second: snapshot("second", { authenticatedAs: "sam@example.com", plan: "Pro" }),
          first: snapshot("first", { status: "auth-missing", authenticatedAs: "no@x.dev" }),
        },
        rank,
      ),
    ).toEqual({ name: "sam", plan: "Pro" });
  });

  it("falls back to no name and no plan", () => {
    expect(pickProfileIdentity({}, rank)).toEqual({ name: null, plan: null });
    expect(pickProfileIdentity({ first: snapshot("first") }, rank)).toEqual({
      name: null,
      plan: null,
    });
  });

  it("shows no plan when the snapshot has none", () => {
    expect(
      pickProfileIdentity({ first: snapshot("first", { authenticatedAs: "ana" }) }, rank),
    ).toEqual({ name: "ana", plan: null });
  });

  it("initials the shown name", () => {
    expect(profileInitial("sam")).toBe("S");
    expect(profileInitial("Account")).toBe("A");
  });
});
