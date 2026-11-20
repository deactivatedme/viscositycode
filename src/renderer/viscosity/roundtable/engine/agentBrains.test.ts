import { describe, expect, it } from "vitest";
import type { AgentCapability, AgentStatus, McpServer } from "@/shared/contracts";
import type { SavedPlaybook } from "@/shared/viscosity/playbook";
import { PLAYBOOK_BROWSER_ID } from "@/renderer/viscosity/playbooks/applyPlaybook";
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

  describe("with a playbook", () => {
    const reversing: SavedPlaybook = {
      id: "reversing",
      label: "Reversing",
      instructions: "Triage first.",
      mcp: ["Ghidra", "ida-pro-mcp", "missing"],
      browserMcp: true,
      switchPhrases: ["BREACHING THE BINARY"],
    };
    const server = (id: string, name: string, enabled: boolean) =>
      ({ id, name, enabled }) as unknown as McpServer;
    const servers = [
      server("s-ghidra", "ghidra", false),
      server("s-ida", "ida-pro-mcp", true),
      server("s-other", "other", false),
    ];
    const brain = (presentationMode: "gui" | "terminal") =>
      ({ kind: "agent", agentKind: "first", model: "m-1", presentationMode }) as const;

    it("binds the frozen copy and switches on only the named servers that are off", () => {
      const config = buildAgentThreadConfig(brain("gui"), agent("first"), {
        definition: reversing,
        mcpServers: servers,
      });
      expect(config.mcpServerOverrides).toEqual({ "s-ghidra": true });
      expect(config.browserMcp).toBe(true);
      expect(config.playbook).toEqual({
        version: 1,
        id: "reversing",
        label: "Reversing",
        instructions: "Triage first.",
        switchPhrases: ["BREACHING THE BINARY"],
        mcpServerIds: ["s-ghidra", PLAYBOOK_BROWSER_ID],
      });
      // A playbook never changes approval, sandbox or mode.
      expect(config).not.toHaveProperty("approvalPolicy");
      expect(config).not.toHaveProperty("sandboxMode");
      expect(config).not.toHaveProperty("mode");
    });

    it("leaves the browser off where the presentation has no MCP gating point", () => {
      const config = buildAgentThreadConfig(brain("terminal"), agent("first"), {
        definition: reversing,
        mcpServers: [],
      });
      expect(config).not.toHaveProperty("browserMcp");
      expect(config).not.toHaveProperty("mcpServerOverrides");
      expect(config.playbook).toMatchObject({ id: "reversing" });
      expect(config.playbook).not.toHaveProperty("mcpServerIds");
    });
  });
});
