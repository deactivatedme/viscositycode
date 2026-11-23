import type { AgentStatus } from "../contracts";

export const claudeCodeShareSubscription = {
  id: "claude",
  supportsOwnerChat: true,
  supportsOwnerModel(id: string): boolean {
    // Local CLI shorthands may depend on settings deliberately absent from the
    // shared session. Retain the native catalog's concrete release IDs only.
    return /^claude-[a-z]+-\d+(?:-\d+)*(?:\[\d+[mk]\])?$/u.test(id);
  },
  ownerLabel: "Anthropic · Claude subscription",
  acceptsAccount(metadata: AgentStatus["providerMetadata"]): boolean {
    return metadata?.authMethod === "Claude.ai" && !!metadata.plan;
  },
};
