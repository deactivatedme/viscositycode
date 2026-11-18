import { describe, expect, it } from "vitest";
import type { UsageSnapshot } from "@poracode/agents-usage/types";
import {
  accountPoolsSchema,
  bestPoolMember,
  creditBalanceExhausted,
  memberAvailability,
  nextPoolMember,
  type PoolMemberState,
} from "./accountPools";

const NOW = 1_800_000_000_000;

function snapshot(partial: Partial<UsageSnapshot>): UsageSnapshot {
  return { providerId: "codex", status: "ok", windows: [], fetchedAt: NOW, ...partial };
}

describe("memberAvailability", () => {
  it("treats polling hiccups as unknown, never exhausted", () => {
    expect(memberAvailability(undefined, NOW).kind).toBe("unknown");
    expect(memberAvailability(snapshot({ status: "rate-limited" }), NOW).kind).toBe("unknown");
    expect(memberAvailability(snapshot({ status: "error" }), NOW).kind).toBe("unknown");
  });

  it("is exhausted when any live window reaches the threshold, until its reset", () => {
    const result = memberAvailability(
      snapshot({
        windows: [
          { id: "5h", label: "5h", usedPercent: 100, resetsAt: NOW + 60_000 },
          { id: "week", label: "week", usedPercent: 40 },
        ],
      }),
      NOW,
    );
    expect(result).toEqual({ kind: "exhausted", until: NOW + 60_000 });
  });

  it("ignores windows that already reset and honours an earlier switch threshold", () => {
    const s = snapshot({
      windows: [
        { id: "5h", label: "5h", usedPercent: 100, resetsAt: NOW - 1 },
        { id: "week", label: "week", usedPercent: 92 },
      ],
    });
    expect(memberAvailability(s, NOW)).toEqual({ kind: "available", headroomPercent: 8 });
    expect(memberAvailability(s, NOW, 90).kind).toBe("exhausted");
  });

  it("is exhausted when credits run out unless unlimited", () => {
    expect(memberAvailability(snapshot({ credits: { balance: 0 } }), NOW).kind).toBe("exhausted");
    expect(
      memberAvailability(snapshot({ credits: { balance: 0, unlimited: true } }), NOW).kind,
    ).toBe("available");
  });

  it("counts a credit balance only for a credit-only account", () => {
    // Window-backed account: some providers report a zero balance whenever no
    // extra credits were bought. The windows decide.
    const windowed = snapshot({
      windows: [{ id: "5h", label: "5h", usedPercent: 30, resetsAt: NOW + 60_000 }],
      credits: { balance: 0 },
    });
    expect(memberAvailability(windowed, NOW)).toEqual({ kind: "available", headroomPercent: 70 });
    expect(creditBalanceExhausted(windowed)).toBe(false);
    // A full window still reads as out, with its reset time.
    expect(
      memberAvailability(
        snapshot({
          windows: [{ id: "5h", label: "5h", usedPercent: 100, resetsAt: NOW + 60_000 }],
          credits: { balance: 0 },
        }),
        NOW,
      ),
    ).toEqual({ kind: "exhausted", until: NOW + 60_000 });
    // Credit-only account: the balance is the meter.
    const creditOnly = snapshot({ credits: { balance: 0 } });
    expect(memberAvailability(creditOnly, NOW)).toEqual({ kind: "exhausted" });
    expect(creditBalanceExhausted(creditOnly)).toBe(true);
    expect(memberAvailability(snapshot({ credits: { balance: -3 } }), NOW).kind).toBe("exhausted");
    expect(memberAvailability(snapshot({ credits: { balance: 12 } }), NOW).kind).toBe("available");
  });

  it("lets a pool fail over to a window-backed account with a zero credit balance", () => {
    const states: PoolMemberState[] = [
      { agentKind: "codex", ready: true, availability: { kind: "exhausted" } },
      {
        agentKind: "codex:work",
        ready: true,
        availability: memberAvailability(
          snapshot({
            providerId: "codex:work",
            windows: [{ id: "5h", label: "5h", usedPercent: 10 }],
            credits: { balance: 0 },
          }),
          NOW,
        ),
      },
    ];
    expect(nextPoolMember(states, "codex")).toBe("codex:work");
    expect(bestPoolMember(states)).toBe("codex:work");
  });
});

const members: PoolMemberState[] = [
  { agentKind: "codex", ready: true, availability: { kind: "exhausted" } },
  {
    agentKind: "codex:work",
    ready: true,
    availability: { kind: "available", headroomPercent: 20 },
  },
  {
    agentKind: "codex:home",
    ready: true,
    availability: { kind: "available", headroomPercent: 70 },
  },
  {
    agentKind: "codex:old",
    ready: false,
    availability: { kind: "available", headroomPercent: 99 },
  },
];

describe("pool choices", () => {
  it("starts new threads on the ready account with the most headroom", () => {
    expect(bestPoolMember(members)).toBe("codex:home");
    expect(bestPoolMember([members[0]!, members[3]!])).toBe("codex");
    expect(bestPoolMember([members[3]!])).toBeUndefined();
  });

  it("fails over in the owner's order, skipping exhausted, not-ready and tried accounts", () => {
    expect(nextPoolMember(members, "codex")).toBe("codex:work");
    expect(nextPoolMember(members, "codex", new Set(["codex:work"]))).toBe("codex:home");
    expect(nextPoolMember(members, "codex:home")).toBe("codex:work");
    expect(nextPoolMember(members.slice(0, 1), "codex")).toBeUndefined();
  });

  it("validates pool settings", () => {
    expect(
      accountPoolsSchema.safeParse({ codex: { enabled: true, members: ["codex", "codex:work"] } })
        .success,
    ).toBe(true);
    expect(
      accountPoolsSchema.safeParse({ codex: { enabled: true, members: [], switchAtPercent: 10 } })
        .success,
    ).toBe(false);
  });
});
