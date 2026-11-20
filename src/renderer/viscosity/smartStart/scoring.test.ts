import { describe, expect, it } from "vitest";
import type { MemberAvailability } from "@/shared/accountPools";
import {
  decideSmartStart,
  headroomPoints,
  lastUsedProviderOrder,
  PREFERENCE_BONUS,
  preferenceBonus,
  resolvePreferenceOrder,
  scoreSmartStartCandidates,
  smartStartProviderOf,
  STICKY_MARGIN,
  threadProviderOrder,
  UNKNOWN_HEADROOM,
  type SmartStartCandidate,
} from "./scoring";

function available(headroomPercent: number): MemberAvailability {
  return { kind: "available", headroomPercent };
}

function candidate(
  agentKind: string,
  availability: MemberAvailability,
  extra: Partial<SmartStartCandidate> = {},
): SmartStartCandidate {
  return {
    agentKind,
    provider: smartStartProviderOf(agentKind),
    model: "model-1",
    presentationMode: "gui",
    availability,
    ...extra,
  };
}

describe("smartStartProviderOf", () => {
  it("maps a profile account to its driver and keeps a base kind", () => {
    expect(smartStartProviderOf("alpha:work")).toBe("alpha");
    expect(smartStartProviderOf("alpha")).toBe("alpha");
  });
});

describe("headroomPoints", () => {
  it("uses the reported headroom, clamped to 0–100", () => {
    expect(headroomPoints(available(72))).toBe(72);
    expect(headroomPoints(available(140))).toBe(100);
    expect(headroomPoints(available(-5))).toBe(0);
  });

  it("treats unreported usage as neutral and exhausted accounts as unusable", () => {
    expect(headroomPoints({ kind: "unknown" })).toBe(UNKNOWN_HEADROOM);
    expect(headroomPoints({ kind: "exhausted" })).toBeUndefined();
  });

  it("ranks a failed poll by its last good reading, like the pool pick", () => {
    const nearlyOut = headroomPoints({ kind: "unknown", transient: true, headroomPercent: 2 });
    expect(nearlyOut).toBe(2);
    expect(nearlyOut!).toBeLessThan(headroomPoints(available(40))!);
    expect(headroomPoints({ kind: "unknown", transient: true })).toBe(UNKNOWN_HEADROOM);
  });
});

describe("preferenceBonus", () => {
  it("gives a mild, decreasing head start to the first few ranks only", () => {
    expect(preferenceBonus(0)).toBe(PREFERENCE_BONUS[0]);
    expect(preferenceBonus(1)).toBeLessThan(preferenceBonus(0));
    expect(preferenceBonus(PREFERENCE_BONUS.length)).toBe(0);
    expect(preferenceBonus(undefined)).toBe(0);
    expect(preferenceBonus(-1)).toBe(0);
    // Mild: never more than a fifth of the headroom scale.
    expect(Math.max(...PREFERENCE_BONUS)).toBeLessThanOrEqual(20);
  });
});

describe("scoreSmartStartCandidates", () => {
  it("ranks by headroom plus the preference bonus", () => {
    const ranked = scoreSmartStartCandidates(
      [candidate("alpha", available(60)), candidate("beta", available(70))],
      ["alpha", "beta"],
    );
    // alpha: 60 + 15 = 75, beta: 70 + 10 = 80.
    expect(ranked.map((entry) => [entry.agentKind, entry.score])).toEqual([
      ["beta", 80],
      ["alpha", 75],
    ]);
    expect(ranked[1]).toMatchObject({ headroom: 60, bonus: 15, preferenceRank: 0 });
  });

  it("lets a large headroom gap beat the preference", () => {
    const ranked = scoreSmartStartCandidates(
      [candidate("alpha", available(20)), candidate("beta", available(90))],
      ["alpha"],
    );
    expect(ranked[0]?.agentKind).toBe("beta");
  });

  it("leaves accounts that are out of usage out", () => {
    const ranked = scoreSmartStartCandidates(
      [candidate("alpha", { kind: "exhausted" }), candidate("beta", available(10))],
      ["alpha"],
    );
    expect(ranked.map((entry) => entry.agentKind)).toEqual(["beta"]);
  });

  it("breaks score ties by preference rank, then by candidate order", () => {
    const tiedByPreference = scoreSmartStartCandidates(
      [
        candidate("alpha", available(50)),
        candidate("beta", available(50)),
        candidate("gamma", available(50)),
      ],
      [],
    );
    expect(tiedByPreference.map((entry) => entry.agentKind)).toEqual(["alpha", "beta", "gamma"]);

    // Equal scores (60 + 0 vs 45 + 15): the preferred provider wins the tie.
    const tiedScore = scoreSmartStartCandidates(
      [candidate("alpha", available(60)), candidate("beta", available(45))],
      ["beta"],
    );
    expect(tiedScore.map((entry) => [entry.agentKind, entry.score])).toEqual([
      ["beta", 60],
      ["alpha", 60],
    ]);
  });

  it("scores pooled accounts one by one under their provider's preference", () => {
    const ranked = scoreSmartStartCandidates(
      [
        candidate("alpha:home", available(10)),
        candidate("alpha:work", available(80)),
        candidate("beta", available(85)),
      ],
      ["alpha", "beta"],
    );
    expect(ranked.map((entry) => entry.agentKind)).toEqual(["alpha:work", "beta", "alpha:home"]);
  });
});

describe("decideSmartStart", () => {
  it("picks the best scoring candidate", () => {
    const decision = decideSmartStart({
      candidates: [candidate("alpha", available(30)), candidate("beta", available(72))],
      preferenceOrder: [],
    });
    expect(decision.kind).toBe("pick");
    if (decision.kind !== "pick") return;
    expect(decision.pick.agentKind).toBe("beta");
    expect(decision.ranked.map((entry) => entry.agentKind)).toEqual(["beta", "alpha"]);
    expect(decision.keptCurrent).toBe(false);
  });

  it("falls back to the manual picker when no agent is ready", () => {
    expect(decideSmartStart({ candidates: [], preferenceOrder: ["alpha"] })).toEqual({
      kind: "none",
      reason: "no-ready-agent",
    });
  });

  it("falls back to the manual picker when every ready account is out of usage", () => {
    expect(
      decideSmartStart({
        candidates: [candidate("alpha", { kind: "exhausted" })],
        preferenceOrder: [],
      }),
    ).toEqual({ kind: "none", reason: "all-exhausted" });
  });

  it("keeps the current account unless another is clearly better", () => {
    const close = decideSmartStart({
      candidates: [
        candidate("alpha", available(50)),
        candidate("beta", available(50 + STICKY_MARGIN)),
      ],
      preferenceOrder: [],
      currentAgentKind: "alpha",
    });
    expect(close.kind === "pick" && close.pick.agentKind).toBe("alpha");
    expect(close.kind === "pick" && close.keptCurrent).toBe(true);

    const clear = decideSmartStart({
      candidates: [
        candidate("alpha", available(50)),
        candidate("beta", available(51 + STICKY_MARGIN)),
      ],
      preferenceOrder: [],
      currentAgentKind: "alpha",
    });
    expect(clear.kind === "pick" && clear.pick.agentKind).toBe("beta");
  });

  it("ignores a current account that is out of usage or not a candidate", () => {
    const exhausted = decideSmartStart({
      candidates: [candidate("alpha", { kind: "exhausted" }), candidate("beta", available(5))],
      preferenceOrder: [],
      currentAgentKind: "alpha",
    });
    expect(exhausted.kind === "pick" && exhausted.pick.agentKind).toBe("beta");

    const missing = decideSmartStart({
      candidates: [candidate("beta", available(5))],
      preferenceOrder: [],
      currentAgentKind: "gone",
    });
    expect(missing.kind === "pick" && missing.pick.agentKind).toBe("beta");
  });
});

describe("resolvePreferenceOrder", () => {
  it("uses the owner's list for the task kind, else the last-used order", () => {
    const preferences = { coding: ["beta", "alpha"] };
    expect(resolvePreferenceOrder("coding", preferences, ["alpha"])).toEqual(["beta", "alpha"]);
    expect(resolvePreferenceOrder("quick", preferences, ["alpha"])).toEqual(["alpha"]);
    expect(resolvePreferenceOrder(undefined, preferences, ["alpha"])).toEqual(["alpha"]);
  });

  it("keeps an explicitly emptied list (no head start at all)", () => {
    expect(resolvePreferenceOrder("quick", { quick: [] }, ["alpha"])).toEqual([]);
  });
});

describe("last-used provider order", () => {
  it("orders thread providers by latest activity, one entry per provider", () => {
    expect(
      threadProviderOrder([
        { agentKind: "alpha", updatedAt: "2026-11-01T10:00:00.000Z" },
        { agentKind: "beta:work", updatedAt: "2026-11-03T10:00:00.000Z" },
        { agentKind: "alpha:home", updatedAt: "2026-11-02T10:00:00.000Z" },
        { agentKind: "beta", updatedAt: "2026-10-01T10:00:00.000Z" },
      ]),
    ).toEqual(["beta", "alpha"]);
  });

  it("puts hand-picked starts before thread activity", () => {
    expect(lastUsedProviderOrder(["gamma", "alpha"], ["beta", "alpha", "gamma"])).toEqual([
      "gamma",
      "alpha",
      "beta",
    ]);
  });
});
