import { agentCapabilitySchema } from "@/shared/contracts";
import { CODE_SHARE_PROJECT_PROTOCOL } from "@/shared/codeShare";
import { CODE_SHARE_PROJECT_AGENT } from "@/shared/codeShareProjectAccess";
import type { CodeShareFileRuntime } from "../../codeShareFileRuntime";
import type { AgentAdapter } from "../base";
import type { CodeShareProjectConnections } from "./connection";
import { CodeShareProjectSession } from "./session";

const label = "CodeShare";
const capabilities = agentCapabilitySchema.parse({
  supportsResume: true,
  presentationMode: "gui",
  presentationModes: ["gui"],
  liveInputMode: "server",
  modes: ["agent"],
});

function noTerminal(): never {
  throw new Error("CodeShare models require Chat mode.");
}

export function createCodeShareProjectAdapter(
  shares: CodeShareProjectConnections,
  files: CodeShareFileRuntime,
): AgentAdapter {
  return {
    kind: CODE_SHARE_PROJECT_AGENT,
    label,
    capabilities,
    refreshModelCatalog: true,
    buildLaunchArgv: noTerminal,
    buildResumeArgv: noTerminal,
    createInitialSessionRef: () => undefined,
    async detectInstall(ctx) {
      const status = {
        kind: CODE_SHARE_PROJECT_AGENT,
        label,
        installed: false,
        authState: "missing" as const,
        capabilities,
      };
      if (ctx?.envKind === "wsl") return status;
      try {
        const connection = shares.current();
        if (!connection) return status;
        const state = await connection.snapshot(ctx?.signal);
        if (state.status !== "active" || state.projectProtocol !== CODE_SHARE_PROJECT_PROTOCOL)
          return status;
        const models = state.models
          .filter(({ execution }) => execution !== "guest-subscription")
          .map(({ id, label: modelLabel, model }) => ({ id, label: modelLabel ?? model }));
        return {
          ...status,
          installed: models.length > 0,
          authState: "authenticated",
          capabilities: { ...capabilities, models },
        };
      } catch {
        return status;
      }
    },
    async createStructuredSession(input) {
      if (input.projectLocation.kind === "wsl" || input.presentationMode === "terminal")
        throw new Error("Use a native local project in Chat mode for CodeShare.");
      const connection = shares.current();
      if (!connection) throw new Error("Join a CodeShare invite before starting a project chat.");
      return new CodeShareProjectSession(input, connection, files);
    },
  };
}
