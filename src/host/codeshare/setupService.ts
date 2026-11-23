import { randomUUID } from "node:crypto";
import { nativeKeyCatalog } from "./nativeKeyBridge";
import { z } from "zod";
import type { SupervisorClient } from "@/host/supervisor/SupervisorClient";
import { parseModel, ShareError } from "@/shared/codeShare";
import {
  shareApiKeySchema,
  type CodeShareSetupSnapshot,
  type ShareConnection,
} from "@/shared/codeShareSetup";
import { verifyCodeShareModels } from "./checkModels";
import { getCodeShareProvider, listCodeShareHostedProviders, type ProviderKeys } from "./providers";
import type { CodeShareSetupStore } from "./setupStore";
import type { CodeShareCloudflareSetup } from "./cloudflareSetup";

export class CodeShareOwnerSetup {
  private readonly writes = new Set<Promise<void>>();
  private closed = false;
  constructor(
    private readonly store: CodeShareSetupStore,
    private readonly keys: ProviderKeys,
    private readonly supervisor: Pick<SupervisorClient, "callCodeShare">,
    readonly cloudflare: CodeShareCloudflareSetup,
    private readonly refreshModels: () => Promise<void>,
    private readonly configuredModels: (provider: string) => string[],
    private readonly applyKeys: () => void,
    private readonly request = globalThis.fetch,
  ) {}

  async snapshot(): Promise<CodeShareSetupSnapshot> {
    const data = this.store.read();
    const subscriptions = await this.supervisor.callCodeShare<ShareConnection[]>({
      action: "connections",
    });
    return {
      subscriptions,
      apiKeys: listCodeShareHostedProviders().map((provider) => ({
        id: provider.id,
        label: provider.ownerLabel,
        configured: Boolean(this.keys[provider.id]),
        ...("nativeBridge" in provider ? { importAccount: true as const } : {}),
        discoverModels:
          "nativeBridge" in provider ||
          ("discoverModels" in provider && Boolean(provider.discoverModels)),
        models: data.models[provider.id] ?? this.configuredModels(provider.id),
      })),
      cloudflare: await this.cloudflare.snapshot(),
    };
  }
  async login(provider: string, cancel: boolean): Promise<void> {
    await this.supervisor.callCodeShare({
      action: cancel ? "login-cancel" : "login-start",
      provider,
    });
    if (!cancel && !this.closed) await this.refreshModels();
  }
  saveKey(value: z.infer<typeof shareApiKeySchema>): Promise<void> {
    if (this.closed) return Promise.reject(new Error("CodeShare is closing."));
    const pending = this.saveConnection(value);
    this.writes.add(pending);
    void pending.finally(() => this.writes.delete(pending)).catch(() => undefined);
    return pending;
  }
  private async saveConnection(value: z.infer<typeof shareApiKeySchema>): Promise<void> {
    const provider = getCodeShareProvider(value.provider);
    if (!provider)
      throw new ShareError(400, "unsupported_provider", "Select a supported API provider.");
    if (value.action === "import") {
      if (!("nativeBridge" in provider))
        throw new ShareError(
          400,
          "unsupported_provider",
          "This connector has no native account import.",
        );
      const key = await this.supervisor.callCodeShare<string>({
        action: "key-import",
        id: randomUUID(),
        provider: provider.id,
      });
      return this.saveConnection({ action: "save", provider: provider.id, key, models: [] });
    }
    if (value.action === "save") {
      const models = value.models.map(parseModel);
      if (models.some((model) => model.provider !== provider.id))
        throw new ShareError(
          400,
          "invalid_models",
          "Model IDs must belong to the selected provider.",
        );
      if (models.length)
        await verifyCodeShareModels(
          models,
          { [provider.id]: value.key },
          this.request,
          this.supervisor,
        );
      else if ("nativeBridge" in provider)
        await nativeKeyCatalog(this.supervisor, provider.id, value.key);
      else if ("discoverModels" in provider && provider.discoverModels)
        await provider.discoverModels(value.key, this.request);
      else
        throw new ShareError(
          400,
          "models_required",
          "Enter the exact model IDs to enable for this key.",
        );
    }
    if (this.closed) throw new Error("CodeShare is closing.");
    await this.store.update((current) => ({
      ...current,
      keys: { ...current.keys, [provider.id]: value.action === "save" ? value.key : null },
      models: { ...current.models, [provider.id]: value.action === "save" ? value.models : [] },
    }));
    this.applyKeys();
    await this.refreshModels();
  }
  async close(): Promise<void> {
    this.closed = true;
    await Promise.all([this.cloudflare.close(), Promise.allSettled([...this.writes])]);
  }
}
