import type { AgentStatus } from "../contracts";

export const claudeCodeShareSubscription = {
  id: "claude",
  supportsOwnerChat: true,
  ownerLabel: "Anthropic · Claude subscription",
  acceptsAccount(metadata: AgentStatus["providerMetadata"]): boolean {
    return metadata?.authMethod === "Claude.ai" && !!metadata.plan;
  },
};
