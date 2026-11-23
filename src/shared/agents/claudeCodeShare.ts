import type { AgentStatus } from "../contracts";

export const claudeCodeShareSubscription = {
  id: "claude",
  acceptsAccount(metadata: AgentStatus["providerMetadata"]): boolean {
    return metadata?.authMethod === "Claude.ai" && !!metadata.plan;
  },
};
