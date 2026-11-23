import type { AgentStatus } from "../contracts";

export const codexCodeShareSubscription = {
  id: "codex",
  acceptsAccount(metadata: AgentStatus["providerMetadata"]): boolean {
    // Codex's structured account probe supplies a plan for ChatGPT and an auth
    // method for API key or other credentials.
    return !!metadata?.plan && !metadata.authMethod;
  },
};
