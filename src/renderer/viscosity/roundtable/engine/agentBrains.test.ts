import { describe, expect, it } from "vitest";
import type { AgentCapability, AgentStatus } from "@/shared/contracts";
import {
  buildAgentThreadConfig,
  selectReadyAgentBrains,
  type ReadyAgentBrainsInput,
} from "./agentBrains";

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

function input(overrides: Partial<ReadyAgentBrainsInput> = {}): ReadyAgentBrainsInput {
  return {
    agents: [agent("first"), agent("second")],
    disabledAgents: [],
    lastDraftConfig: undefined,
    providerConfigs: {},
    providerModelPreferences: {},
    ...overrides,
  };
}

describe("selectReadyAgentBrains", () => {
  it("lists ready agents with their models and a default model", () => {
    const brains = selectReadyAgentBrains(input());
    expect(brains.map((brain) => brain.agentKind)).toEqual(["first", "second"]);
    expect(brains[0]).toMatchObject({
      label: "first label",
      models: [
        { id: "m-1", label: "Model One" },
        { id: "m-2", label: "Model Two" },
      ],
      defaultModel: "m-1",
      presentationModes: ["gui", "terminal"],
    });
  });

  it("uses the project's last model for that agent as the default", () => {
    const brains = selectReadyAgentBrains(
      input({ lastDraftConfig: { agentKind: "second", model: "m-2" } }),
    );
    expect(brains.find((brain) => brain.agentKind === "second")?.defaultModel).toBe("m-2");
  });

  it("skips uninstalled, disabled, signed-out and model-less agents", () => {
    const brains = selectReadyAgentBrains(
      input({
        agents: [
          agent("missing-cli", { installed: false }),
          agent("off"),
          agent("signed-out", { authState: "missing" }),
          agent("empty", { capabilities: { ...capabilities, models: [] } }),
          agent("ok"),
        ],
        disabledAgents: ["off"],
      }),
    );
    expect(brains.map((brain) => brain.agentKind)).toEqual(["ok"]);
  });

  it("keeps only the presentations that are signed in and drivable in the background", () => {
    const brains = selectReadyAgentBrains(
      input({
        agents: [
          agent("gui-signed-out", { presentationAuthStates: { gui: "missing" } }),
          agent("focus-terminal", {
            capabilities: { ...capabilities, requiresTerminalFocusBeforeInput: true },
          }),
        ],
      }),
    );
    expect(brains.find((brain) => brain.agentKind === "gui-signed-out")?.presentationModes).toEqual(
      ["terminal"],
    );
    expect(brains.find((brain) => brain.agentKind === "focus-terminal")?.presentationModes).toEqual(
      ["gui"],
    );
  });
});

describe("buildAgentThreadConfig", () => {
  it("launches the brain's model and leaves approval, sandbox and mode to the provider", () => {
    const config = buildAgentThreadConfig(
      { kind: "agent", agentKind: "first", model: "m-2", presentationMode: "gui" },
      agent("first"),
    );
    expect(config.model).toBe("m-2");
    expect(config).not.toHaveProperty("approvalPolicy");
    expect(config).not.toHaveProperty("sandboxMode");
    expect(config).not.toHaveProperty("mode");
  });

  it("falls back to the bare model when the agent is unknown", () => {
    expect(
      buildAgentThreadConfig(
        { kind: "agent", agentKind: "gone", model: "m-9", presentationMode: "terminal" },
        undefined,
      ),
    ).toEqual({ model: "m-9" });
  });
});
