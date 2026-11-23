import { claudeCodeShareSubscription } from "./agents/claudeCodeShare";
import { devinCodeShareSubscription } from "./agents/devinCodeShare";
import { codexCodeShareSubscription } from "./agents/codexCodeShare";

const providers = new Map(
  [claudeCodeShareSubscription, codexCodeShareSubscription, devinCodeShareSubscription].map(
    (provider) => [provider.id, provider],
  ),
);

export function getCodeShareSubscriptionProvider(id: string) {
  return providers.get(id);
}
