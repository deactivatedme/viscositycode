import { devinCodeShareKey } from "@/shared/agents/devinCodeShare";
import { nativeKeyCatalog, type NativeKeyBridge } from "./nativeKeyBridge";
import { createSubscriptionRunner } from "./subscriptionRunner";
import { parseModel, type ShareModel } from "@/shared/codeShare";
import {
  type CodeShareProvider,
  type CodeShareCloudProvider,
  type RunProvider,
  ProviderFailure,
  runProviderStream,
} from "./providerTransport";
import { cursorSharing } from "./providers/cursor";
import { anthropicSharing } from "./providers/anthropic";
import { openAiSharing } from "./providers/openai";
import { xaiSharing } from "./providers/xai";

export type ProviderKeys = Record<string, string | undefined>;

interface NativeKeyProvider {
  id: string;
  ownerLabel: string;
  keyEnvironmentVariable: string;
  nativeBridge: true;
  showInEmptyOwnerMenu?: boolean;
}
type Provider = CodeShareProvider | CodeShareCloudProvider | NativeKeyProvider;
const nativeKeyProviders: NativeKeyProvider[] = [devinCodeShareKey];
const providers = new Map<string, Provider>(
  [openAiSharing, anthropicSharing, xaiSharing, cursorSharing, ...nativeKeyProviders].map(
    (provider) => [provider.id, provider],
  ),
);

export function listCodeShareHostedProviders(): Provider[] {
  return [...providers.values()];
}

export function getCodeShareProvider(id: string): Provider | undefined {
  return providers.get(id);
}

export function createProviderRunner(
  keys: ProviderKeys,
  request = globalThis.fetch,
  supervisor?: NativeKeyBridge,
): RunProvider {
  return async (input) => {
    const provider = getCodeShareProvider(input.model.provider);
    const key = provider && keys[provider.id];
    if (!provider || !key) throw new ProviderFailure("provider_access");
    if ("nativeBridge" in provider) {
      if (!supervisor) throw new ProviderFailure("provider_unavailable");
      return createSubscriptionRunner(supervisor, () => key)(input);
    }
    return "run" in provider
      ? provider.run(input, key, request)
      : runProviderStream(provider, key, request, input);
  };
}

/** Discover exact key-entitled IDs only for providers without an explicit model list. */
export async function discoverCodeShareHostedModels(
  configured: readonly ShareModel[],
  keys: ProviderKeys,
  request = globalThis.fetch,
  supervisor?: NativeKeyBridge,
): Promise<ShareModel[]> {
  const models = await Promise.all(
    [...providers.values()].map(async (provider) => {
      const key = keys[provider.id];
      if (
        key &&
        "nativeBridge" in provider &&
        !configured.some((model) => model.provider === provider.id)
      )
        return nativeKeyCatalog(supervisor, provider.id, key);
      if (
        !key ||
        !("discoverModels" in provider) ||
        !provider.discoverModels ||
        configured.some((model) => model.provider === provider.id)
      )
        return [];
      const ids = await provider.discoverModels(key, request);
      return [...new Set(ids)].map((id) => parseModel(`${provider.id}:${id}`));
    }),
  );
  return models.flat();
}
