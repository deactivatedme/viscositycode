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

type Provider = CodeShareProvider | CodeShareCloudProvider;
const providers = new Map<string, Provider>(
  [openAiSharing, anthropicSharing, xaiSharing, cursorSharing].map((provider) => [
    provider.id,
    provider,
  ]),
);

export function getCodeShareProvider(id: string): Provider | undefined {
  return providers.get(id);
}

export function createProviderRunner(keys: ProviderKeys, request = globalThis.fetch): RunProvider {
  return async (input) => {
    const provider = getCodeShareProvider(input.model.provider);
    const key = provider && keys[provider.id];
    if (!provider || !key) throw new ProviderFailure("provider_access");
    return "run" in provider
      ? provider.run(input, key, request)
      : runProviderStream(provider, key, request, input);
  };
}
