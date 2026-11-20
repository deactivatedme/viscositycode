import { describe, expect, it } from "vitest";
import type { UsageSnapshot } from "@poracode/agents-usage/types";
import { agentCapabilitySchema, agentStatusSchema, type AgentStatus } from "@/shared/contracts";
import {
  buildPoolMemberStates,
  classifyFailure,
  decideFailover,
  exhaustedMarkFor,
  failoverThreadConfig,
  failureAvailability,
  FAILOVER_CONTINUE_PROMPT,
  isPoolMemberReady,
  promptFromUserMessages,
  readAccountPoolsSetting,
  resolveAccountPool,
  sharesEnabledAccountPool,
  userMessageContent,
} from "./failoverPolicy";

const NOW = 1_800_000_000_000;

function status(kind: string, overrides: Record<string, unknown> = {}): AgentStatus {
  return agentStatusSchema.parse({
    kind,
    label: kind,
    installed: true,
    authState: "authenticated",
    capabilities: { presentationMode: "gui", presentationModes: ["gui", "terminal"] },
    ...overrides,
  });
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

describe("readAccountPoolsSetting", () => {
  it("reads nothing from settings that predate the field", () => {
    expect(readAccountPoolsSetting({})).toEqual({});
    expect(readAccountPoolsSetting({ accountPools: null })).toEqual({});
    expect(readAccountPoolsSetting({ accountPools: [] })).toEqual({});
  });

  it("drops only the malformed pool", () => {
    expect(
      readAccountPoolsSetting({
        accountPools: {
          codex: { enabled: true, members: ["codex", "codex:work"] },
          claude: { enabled: "yes", members: 3 },
        },
      }),
    ).toEqual({ codex: { enabled: true, members: ["codex", "codex:work"] } });
  });
});

describe("resolveAccountPool", () => {
  const pools = {
    codex: { enabled: true, members: ["codex", "codex:work", "codex:work", "claude:x"] },
    claude: { enabled: false, members: ["claude", "claude:work"] },
    antigravity: { enabled: true, members: ["antigravity", "antigravity:two"] },
    gemini: { enabled: true, members: ["gemini"] },
  };

  it("resolves an enabled profile-driver pool, de-duplicated to its own driver", () => {
    expect(resolveAccountPool(pools, "codex:work")).toMatchObject({
      driver: "codex",
      members: ["codex", "codex:work"],
    });
  });

  it("ignores disabled pools, non-profile drivers, non-members and single-member pools", () => {
    expect(resolveAccountPool(pools, "claude")).toBeUndefined();
    expect(resolveAccountPool(pools, "antigravity")).toBeUndefined();
    expect(resolveAccountPool(pools, "codex:other")).toBeUndefined();
    expect(resolveAccountPool(pools, "gemini")).toBeUndefined();
  });

  it("knows when two kinds share an enabled pool", () => {
    expect(sharesEnabledAccountPool(pools, "codex", "codex:work")).toBe(true);
    expect(sharesEnabledAccountPool(pools, "claude", "claude:work")).toBe(false);
    expect(sharesEnabledAccountPool(pools, "claude", "claude")).toBe(true);
  });
});

describe("classifyFailure", () => {
  it("trusts the provider's reason and never fails over a sign-in problem", () => {
    expect(classifyFailure("usage_limited", { kind: "unknown" })).toBe("usage");
    expect(classifyFailure("auth_required", { kind: "exhausted" })).toBe("auth");
  });

  it("falls back to the account's usage snapshot", () => {
    expect(classifyFailure(undefined, { kind: "exhausted" })).toBe("usage");
    expect(classifyFailure(undefined, { kind: "available", headroomPercent: 10 })).toBe("other");
    expect(classifyFailure("something_else", { kind: "unknown" })).toBe("other");
  });
});

describe("member readiness and decisions", () => {
  it("requires an installed, chat-capable, signed-in agent", () => {
    expect(isPoolMemberReady(undefined)).toBe(false);
    expect(isPoolMemberReady(status("codex:a"))).toBe(true);
    expect(isPoolMemberReady(status("codex:a", { authState: "missing" }))).toBe(false);
    expect(
      isPoolMemberReady(
        status("codex:a", {
          authState: "authenticated",
          presentationAuthStates: { gui: "missing" },
        }),
      ),
    ).toBe(false);
    expect(
      isPoolMemberReady(
        status("codex:a", {
          capabilities: { presentationMode: "terminal" },
        }),
      ),
    ).toBe(false);
  });

  const members = ["codex", "codex:work", "codex:home"];
  const statuses = members.map((kind) => status(kind));

  it("switches to the next member with usage left and never back to a tried one", () => {
    const states = buildPoolMemberStates({
      members,
      statuses,
      snapshotFor: (kind) =>
        kind === "codex:work" ? snapshot(kind, 100, NOW + 60_000) : undefined,
      usageIdFor: (kind) => kind,
      exhaustedMarks: new Map(),
      now: NOW,
      switchAtPercent: undefined,
    });
    expect(decideFailover(states, "codex", new Set(["codex"]))).toEqual({
      kind: "switch",
      to: "codex:home",
    });
    expect(decideFailover(states, "codex:home", new Set(["codex", "codex:home"]))).toEqual({
      kind: "exhausted",
      until: NOW + 60_000,
      notReadyCount: 0,
    });
  });

  it("applies host-observed marks and counts members that only need sign-in", () => {
    const states = buildPoolMemberStates({
      members,
      statuses: [
        status("codex"),
        status("codex:work"),
        status("codex:home", { authState: "missing" }),
      ],
      snapshotFor: () => undefined,
      usageIdFor: (kind) => kind,
      exhaustedMarks: new Map([["codex:work", { until: NOW + 5_000, resetKnown: false }]]),
      now: NOW,
      switchAtPercent: undefined,
    });
    expect(states.map((state) => state.availability.kind)).toEqual([
      "unknown",
      "exhausted",
      "unknown",
    ]);
    // A guessed cool-down is never reported as a reset time.
    expect(decideFailover(states, "codex", new Set(["codex"]))).toEqual({
      kind: "exhausted",
      notReadyCount: 1,
    });
  });

  it("never moves to a disabled agent or to an account metered with the failed one", () => {
    const states = buildPoolMemberStates({
      members: ["codex", "codex:shared", "codex:off", "codex:home"],
      statuses: ["codex", "codex:shared", "codex:off", "codex:home"].map((kind) => status(kind)),
      snapshotFor: () => undefined,
      usageIdFor: (kind) => (kind === "codex:shared" ? "codex" : kind),
      exhaustedMarks: new Map(),
      now: NOW,
      switchAtPercent: undefined,
      disabledAgents: ["codex:off"],
    });
    expect(states.map((state) => [state.ready, state.usageAccountId])).toEqual([
      [true, "codex"],
      [true, "codex"],
      [false, "codex:off"],
      [true, "codex:home"],
    ]);
    expect(decideFailover(states, "codex", new Set(["codex"]))).toEqual({
      kind: "switch",
      to: "codex:home",
    });
  });

  it("marks the failed account until its reported reset, else a cool-down guess", () => {
    expect(exhaustedMarkFor(snapshot("codex", 100, NOW + 9_000), NOW)).toEqual({
      until: NOW + 9_000,
      resetKnown: true,
    });
    expect(exhaustedMarkFor(undefined, NOW, 1_000)).toEqual({
      until: NOW + 1_000,
      resetKnown: false,
    });
  });
});

describe("failoverThreadConfig", () => {
  const capabilities = agentCapabilitySchema.parse({
    presentationMode: "gui",
    models: [
      { id: "gpt-a", label: "A" },
      { id: "gpt-b", label: "B" },
    ],
    efforts: ["low", "high"],
    defaultEffort: "low",
    fastModels: ["gpt-a"],
    approvalPolicies: [{ id: "on-request", label: "On request" }],
    sandboxModes: [],
  });

  it("keeps the model and its options when the new account offers them", () => {
    expect(
      failoverThreadConfig(
        {
          model: "gpt-a",
          effort: "high",
          fast: true,
          approvalPolicy: "on-request",
          sandboxMode: "workspace-write",
          mcpServerOverrides: { docs: true },
          selectionBinding: {
            version: 1,
            kind: "family-member",
            owner: { agentKind: "codex", presentationMode: "gui" },
            model: "gpt-a",
            inertValues: { effort: "high" },
          },
        },
        capabilities,
      ),
    ).toEqual({
      model: "gpt-a",
      effort: "high",
      fast: true,
      approvalPolicy: "on-request",
      sandboxMode: "workspace-write",
      mcpServerOverrides: { docs: true },
    });
  });

  it("falls back to the account's default model and drops what it cannot run", () => {
    expect(
      failoverThreadConfig(
        { model: "gpt-z", effort: "max", fast: true, approvalPolicy: "never" },
        capabilities,
      ),
    ).toEqual({ model: "gpt-a", effort: "low", fast: true });
    expect(failoverThreadConfig({ model: "gpt-b", fast: true }, capabilities)).toEqual({
      model: "gpt-b",
      effort: "low",
    });
  });
});

describe("interrupted prompt recovery", () => {
  it("reads only top-level, turn-bound user messages", () => {
    const payload = { content: [{ kind: "text", text: "hi" }] };
    expect(userMessageContent("user_message", payload, undefined)).toEqual(payload.content);
    expect(userMessageContent("user_message", payload, "parent")).toBeUndefined();
    expect(userMessageContent("assistant_message", payload, undefined)).toBeUndefined();
    expect(
      userMessageContent("user_message", { ...payload, turnIndependent: true }, undefined),
    ).toBeUndefined();
  });

  it("rebuilds plain text as a plain prompt", () => {
    expect(promptFromUserMessages([[{ kind: "text", text: "Fix the build" }]])).toEqual({
      prompt: "Fix the build",
    });
  });

  it("keeps structured content and joins steering messages", () => {
    expect(
      promptFromUserMessages([
        [
          { kind: "text", text: "Look at " },
          { kind: "file", path: "/repo/a.ts", name: "a.ts", source: "mention" },
          {
            kind: "image",
            mimeType: "image/png",
            dataUrl: "file:///tmp/shot.png",
            path: "/tmp/shot.png",
            source: "attachment",
          },
        ],
        [{ kind: "skill", name: "review", invocation: "/review" }],
      ]),
    ).toEqual({
      prompt: "Look at @/repo/a.ts\n\n/review",
      segments: [
        { kind: "text", content: "Look at " },
        { kind: "file", path: "/repo/a.ts" },
        { kind: "attachment", path: "/tmp/shot.png", mimeType: "image/png" },
        { kind: "text", content: "\n\n" },
        { kind: "text", content: "/review" },
      ],
    });
  });

  it("asks the next account to continue when nothing was recoverable", () => {
    expect(promptFromUserMessages([])).toEqual({ prompt: FAILOVER_CONTINUE_PROMPT });
  });
});

// ViscosityCode: account pool follow-ups.
describe("left-out accounts and the failure threshold", () => {
  it("resolves a pool without the accounts the owner left out", () => {
    const pools = {
      codex: {
        enabled: true,
        members: ["codex", "codex:work", "codex:home"],
        excludedMembers: ["codex:work"],
      },
    };
    expect(resolveAccountPool(pools, "codex")?.members).toEqual(["codex", "codex:home"]);
    expect(resolveAccountPool(pools, "codex:work")).toBeUndefined();
    expect(sharesEnabledAccountPool(pools, "codex", "codex:work")).toBe(false);
    // Leaving all but one account out leaves nothing to fail over to.
    expect(
      resolveAccountPool(
        { codex: { ...pools.codex, excludedMembers: ["codex:work", "codex:home"] } },
        "codex",
      ),
    ).toBeUndefined();
  });

  it("classifies failures by the default 100% rule, not switchAtPercent", () => {
    const at92 = failureAvailability(snapshot("codex", 92), undefined, NOW);
    expect(at92.kind).toBe("available");
    expect(classifyFailure(undefined, at92)).toBe("other");
    const full = failureAvailability(snapshot("codex", 100), undefined, NOW);
    expect(classifyFailure(undefined, full)).toBe("usage");
    // A recent provider-reported failure on another thread still counts.
    const marked = failureAvailability(
      snapshot("codex", 10),
      { until: NOW + 60_000, resetKnown: false },
      NOW,
    );
    expect(classifyFailure(undefined, marked)).toBe("usage");
    expect(
      classifyFailure(
        undefined,
        failureAvailability(undefined, { until: NOW - 1, resetKnown: false }, NOW),
      ),
    ).toBe("other");
  });
});
