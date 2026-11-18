import { describe, expect, it } from "vitest";
import type { AgentCapability, AgentStatus, UsageSnapshot } from "@/shared/contracts";
import {
  buildSmartStartCandidates,
  describeSmartStartAccount,
  isReadyForPresentation,
  type SmartStartCandidateInput,
} from "./candidates";

const NOW = Date.parse("2026-11-18T12:00:00.000Z");

const capabilities = {
  models: [
    { id: "m-1", label: "Model One" },
    { id: "m-2", label: "Model Two" },
  ],
  efforts: [],
  modelEfforts: {},
  contextSizes: [],
  modes: ["agent"],
  approvalPolicies: [],
  sandboxModes: [],
  supportsResume: true,
  supportsDirectInput: true,
  liveInputMode: "server",
  presentationMode: "gui",
  presentationModes: ["gui", "terminal"],
  settingDefs: [],
} as unknown as AgentCapability;

function agent(kind: string, overrides: Partial<AgentStatus> = {}): AgentStatus {
  return {
    kind,
    label: `${kind} label`,
    installed: true,
    authState: "authenticated",
    capabilities,
    ...overrides,
  } as AgentStatus;
}

function snapshot(providerId: string, usedPercent: number): UsageSnapshot {
  return {
    providerId,
    status: "ok",
    windows: [{ id: "5h", label: "5h", usedPercent }],
  } as unknown as UsageSnapshot;
}

function input(overrides: Partial<SmartStartCandidateInput> = {}): SmartStartCandidateInput {
  return {
    agents: [agent("first"), agent("second")],
    disabledAgents: [],
    presentationMode: "gui",
    lastDraftConfig: undefined,
    providerConfigs: {},
    providerModelPreferences: {},
    pools: {},
    instances: undefined,
    snapshots: {},
    now: NOW,
    usageIdFor: (agentKind) => `usage-${agentKind}`,
    ...overrides,
  };
}

describe("isReadyForPresentation", () => {
  it("needs an installed, enabled, signed-in agent with models for the presentation", () => {
    expect(isReadyForPresentation(agent("a"), "gui", [])).toBe(true);
    expect(isReadyForPresentation(agent("a", { installed: false }), "gui", [])).toBe(false);
    expect(isReadyForPresentation(agent("a"), "gui", ["a"])).toBe(false);
    expect(isReadyForPresentation(agent("a", { authState: "missing" }), "gui", [])).toBe(false);
    expect(
      isReadyForPresentation(
        agent("a", {
          capabilities: { ...capabilities, presentationModes: ["terminal"] } as AgentCapability,
        }),
        "gui",
        [],
      ),
    ).toBe(false);
    expect(
      isReadyForPresentation(
        agent("a", { capabilities: { ...capabilities, models: [] } as AgentCapability }),
        "gui",
        [],
      ),
    ).toBe(false);
  });
});

describe("buildSmartStartCandidates", () => {
  it("lists ready accounts with their default model and usage left", () => {
    const candidates = buildSmartStartCandidates(
      input({
        agents: [agent("first"), agent("second", { authState: "missing" }), agent("third")],
        snapshots: { "usage-first": snapshot("usage-first", 28) },
      }),
    );
    expect(candidates).toEqual([
      {
        agentKind: "first",
        provider: "first",
        model: "m-1",
        presentationMode: "gui",
        availability: { kind: "available", headroomPercent: 72 },
        percentLeft: 72,
      },
      {
        agentKind: "third",
        provider: "third",
        model: "m-1",
        presentationMode: "gui",
        availability: { kind: "unknown" },
      },
    ]);
  });

  it("uses the provider's saved model for new threads", () => {
    const [first] = buildSmartStartCandidates(
      input({
        agents: [agent("first")],
        providerConfigs: { first: { model: "m-2" } as never },
      }),
    );
    expect(first?.model).toBe("m-2");
  });

  it("marks an account at its limit as exhausted", () => {
    const [first] = buildSmartStartCandidates(
      input({
        agents: [agent("first")],
        snapshots: { "usage-first": snapshot("usage-first", 100) },
      }),
    );
    expect(first?.availability.kind).toBe("exhausted");
    expect(first?.percentLeft).toBe(0);
  });

  it("keeps the first status per kind and follows the picker rank", () => {
    const candidates = buildSmartStartCandidates(
      input({
        agents: [agent("first"), agent("second"), agent("first", { label: "wsl copy" })],
        rankOf: (kind) => (kind === "second" ? 0 : 1),
      }),
    );
    expect(candidates.map((candidate) => candidate.agentKind)).toEqual(["second", "first"]);
  });

  it("keeps a provider's accounts together", () => {
    const candidates = buildSmartStartCandidates(
      input({ agents: [agent("first"), agent("second"), agent("first:work")] }),
    );
    expect(candidates.map((candidate) => [candidate.agentKind, candidate.provider])).toEqual([
      ["first", "first"],
      ["first:work", "first"],
      ["second", "second"],
    ]);
  });

  it("orders an enabled pool's members first and applies its switch-at threshold", () => {
    // Pools exist only for profile drivers, so this case uses a real one.
    const candidates = buildSmartStartCandidates(
      input({
        agents: [agent("codex"), agent("codex:work")],
        pools: { codex: { enabled: true, members: ["codex:work", "codex"], switchAtPercent: 80 } },
        snapshots: {
          "usage-codex": snapshot("usage-codex", 85),
          "usage-codex:work": snapshot("usage-codex:work", 40),
        },
      }),
    );
    expect(candidates.map((candidate) => [candidate.agentKind, candidate.availability])).toEqual([
      ["codex:work", { kind: "available", headroomPercent: 40 }],
      ["codex", { kind: "exhausted" }],
    ]);
  });

  it("returns nothing when no agent is ready", () => {
    expect(
      buildSmartStartCandidates(input({ agents: [agent("first", { installed: false })] })),
    ).toEqual([]);
  });
});

describe("describeSmartStartAccount", () => {
  it("describes an account that is not ready, the way a candidate is", () => {
    expect(
      describeSmartStartAccount(
        agent("second:work", { authState: "missing" }),
        input({ snapshots: { "usage-second:work": snapshot("usage-second:work", 40) } }),
      ),
    ).toEqual({
      agentKind: "second:work",
      provider: "second",
      model: "m-1",
      presentationMode: "gui",
      availability: { kind: "available", headroomPercent: 60 },
      percentLeft: 60,
    });
  });
});
