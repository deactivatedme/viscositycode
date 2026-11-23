import { z } from "zod";
import type { ShareModel } from "@/shared/codeShare";
import { readBoundedResponseBody } from "@/shared/remote/responseBody";
import { getCodeShareProvider, type ProviderKeys } from "./providers";

const catalogueModel = z.object({ id: z.string() });
const CHECK_CONCURRENCY = 4;

export async function verifyCodeShareModels(
  models: readonly ShareModel[],
  keys: ProviderKeys,
  request = globalThis.fetch,
): Promise<void> {
  const failures: string[] = [];
  for (let offset = 0; offset < models.length; offset += CHECK_CONCURRENCY) {
    const verified = await Promise.allSettled(
      models.slice(offset, offset + CHECK_CONCURRENCY).map(async (model) => {
        const provider = getCodeShareProvider(model.provider);
        const key = keys[model.provider];
        if (!provider || !key) throw new Error(`${model.id} has no configured credential`);
        if ("validateModel" in provider) {
          await provider.validateModel(model.model, key, request);
          return;
        }
        const response = await request(provider.modelEndpoint + encodeURIComponent(model.model), {
          headers: { Accept: "application/json", ...provider.headers(key) },
          redirect: "error",
          signal: AbortSignal.timeout(10_000),
        }).catch(() => null);
        if (!response) throw new Error(`${model.id} catalogue request failed`);
        if (!response.ok) {
          await response.body?.cancel().catch(() => undefined);
          throw new Error(`${model.id} catalogue returned HTTP ${response.status}`);
        }
        const payload = await readBoundedResponseBody(response, 64 * 1024)
          .then((buffer) => JSON.parse(new TextDecoder().decode(buffer)) as unknown)
          .catch(() => null);
        const result = catalogueModel.safeParse(payload);
        if (!result.success) throw new Error(`${model.id} catalogue returned no model ID`);
        if (result.data.id !== model.model)
          throw new Error(`${model.id} catalogue returned different model ID ${result.data.id}`);
      }),
    );
    for (const result of verified) {
      if (result.status === "rejected")
        failures.push(
          result.reason instanceof Error ? result.reason.message : "Catalogue request failed",
        );
    }
  }
  if (failures.length)
    throw new Error(`CodeShare model verification failed. ${failures.join(". ")}.`);
}
