import { nativeKeyCatalog } from "./nativeKeyBridge";
import type { SupervisorClient } from "@/host/supervisor/SupervisorClient";
import { parseModel, type ShareModel } from "@/shared/codeShare";
import { verifyCodeShareModels } from "./checkModels";
import {
  discoverCodeShareHostedModels,
  listCodeShareHostedProviders,
  type ProviderKeys,
} from "./providers";
import type { CodeShareSetupStore } from "./setupStore";

/** The environment seeds setup; explicit dashboard choices override it across restarts. */
export class CodeShareProviderConfiguration {
  readonly keys: ProviderKeys = {};
  constructor(
    private readonly initialModels: ShareModel[],
    private readonly initialKeys: ProviderKeys,
    private readonly ownerModels: ReadonlySet<string> | undefined,
    private readonly store: CodeShareSetupStore,
    private readonly supervisor: Pick<SupervisorClient, "callCodeShare">,
    private readonly request = globalThis.fetch,
  ) {
    this.applyKeys();
  }
  applyKeys(): void {
    for (const id of Object.keys(this.keys)) delete this.keys[id];
    Object.assign(this.keys, this.initialKeys);
    for (const [id, key] of Object.entries(this.store.read().keys)) {
      if (key === null) delete this.keys[id];
      else this.keys[id] = key;
    }
  }
  configuredModels(provider: string): string[] {
    return (
      this.store.read().models[provider] ??
      this.initialModels
        .filter((model) => model.provider === provider && model.execution !== "guest-subscription")
        .map(({ id }) => id)
    );
  }
  async discover(strict = false): Promise<ShareModel[]> {
    const catalog = await this.supervisor.callCodeShare<ShareModel[]>({ action: "catalog" });
    const participant = this.initialModels.filter(
      (model) => model.execution === "guest-subscription",
    );
    const owner = catalog.filter(({ id }) =>
      this.ownerModels ? this.ownerModels.has(id) : !participant.some((model) => model.id === id),
    );
    if (
      strict &&
      this.ownerModels &&
      [...this.ownerModels].some((id) => !owner.some((model) => model.id === id))
    )
      throw new Error(
        "An owner subscription model is unavailable. Connect the owner account in the dashboard and check the model IDs.",
      );
    const hosted = await Promise.all(
      listCodeShareHostedProviders().map(async (provider) => {
        const selected = this.configuredModels(provider.id).map(parseModel);
        if (!this.keys[provider.id]) {
          if (strict && selected.length) throw new Error(`${provider.id} needs a configured key.`);
          return [];
        }
        try {
          if ("nativeBridge" in provider) {
            const keyCatalog = await nativeKeyCatalog(
              this.supervisor,
              provider.id,
              this.keys[provider.id]!,
            );
            if (selected.some((model) => !keyCatalog.some((entry) => entry.id === model.id)))
              throw new Error("A selected native account model is unavailable.");
            return selected.length
              ? keyCatalog.filter((model) => selected.some((entry) => entry.id === model.id))
              : keyCatalog;
          }
          if (selected.length) {
            await verifyCodeShareModels(selected, this.keys, this.request);
            return selected;
          }
          return await discoverCodeShareHostedModels(
            [],
            { [provider.id]: this.keys[provider.id] },
            this.request,
          );
        } catch (error) {
          if (strict) throw error;
          return [];
        }
      }),
    );
    // Explicit participant funding wins over an overlapping auto-discovered key catalog.
    // Connecting a native key must not silently re-bill an existing participant model.
    const participantIds = new Set(participant.map(({ id }) => id));
    const models = [
      ...participant,
      ...owner,
      ...hosted.flat().filter(({ id }) => !participantIds.has(id)),
    ];
    // Inventory can exceed a single grant. Guests still receive at most 64
    // explicitly allowed models, preserving previous app-reader limits.
    return models.slice(0, 512);
  }
}
