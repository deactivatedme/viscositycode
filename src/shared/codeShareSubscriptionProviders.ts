import { claudeCodeShareSubscription } from "./agents/claudeCodeShare";
import { devinCodeShareSubscription } from "./agents/devinCodeShare";
import { codexCodeShareSubscription } from "./agents/codexCodeShare";

import type { AgentStatus } from "./contracts";

interface CodeShareSubscriptionProvider {
  id: string;
  ownerLabel: string;
  supportsOwnerChat?: boolean;
  /** True only for IDs runnable in an isolated owner session without local model aliases. */
  supportsOwnerModel?(id: string): boolean;
  acceptsAccount(metadata: AgentStatus["providerMetadata"]): boolean;
  modelLabel?(id: string): string | undefined;
}

const providers = new Map<string, CodeShareSubscriptionProvider>(
  [claudeCodeShareSubscription, codexCodeShareSubscription, devinCodeShareSubscription].map(
    (provider) => [provider.id, provider],
  ),
);

export function getCodeShareSubscriptionProvider(id: string) {
  return providers.get(id);
}

export function listCodeShareSubscriptionProviders() {
  return [...providers.values()];
}
