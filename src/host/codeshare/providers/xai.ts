import { z } from "zod";
import { MAX_OUTPUT_TOKENS } from "@/shared/codeShare";
import { confirmServedModel } from "../providerModelEvidence";
import {
  ProviderFailure,
  tokenCount,
  type CodeShareProvider,
  type ProviderInput,
  type TokenUsage,
} from "../providerTransport";

const responseMetadata = z.object({
  model: z.string(),
  usage: z.object({ input_tokens: tokenCount, output_tokens: tokenCount }).nullish(),
});
const responseEvent = z.object({
  type: z.string(),
  response: responseMetadata.optional(),
  delta: z.string().optional(),
});

async function readXaiStream(
  events: AsyncIterable<string>,
  append: ProviderInput["append"],
  requestedModel: string,
): Promise<TokenUsage | null> {
  let confirmed = false;
  for await (const data of events) {
    if (data === "[DONE]") break;
    const event = responseEvent.parse(JSON.parse(data));
    if (
      event.type === "response.created" ||
      event.type === "response.completed" ||
      event.type === "response.incomplete"
    ) {
      if (!event.response) throw new ProviderFailure("model_mismatch");
      confirmServedModel(requestedModel, event.response.model, /-(?:\d{8}|\d{4}-\d{2}-\d{2})$/u);
      confirmed = true;
      if (event.type !== "response.created") {
        const usage = event.response.usage;
        return usage
          ? { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens }
          : null;
      }
    }
    if (event.type === "response.output_text.delta" && event.delta) {
      if (!confirmed) throw new ProviderFailure("model_mismatch");
      append(event.delta);
    }
    if (event.type === "response.failed" || event.type === "error")
      throw new ProviderFailure("provider_unavailable");
  }
  throw new ProviderFailure("provider_unavailable");
}

export const xaiSharing: CodeShareProvider = {
  id: "xai",
  keyEnvironmentVariable: "CODESHARE_XAI_API_KEY",
  endpoint: "https://api.x.ai/v1/responses",
  modelEndpoint: "https://api.x.ai/v1/language-models/",
  headers: (key) => ({ Authorization: `Bearer ${key}` }),
  body: (model, messages) => ({
    model,
    input: messages,
    stream: true,
    store: false,
    max_output_tokens: MAX_OUTPUT_TOKENS,
  }),
  readStream: readXaiStream,
};
