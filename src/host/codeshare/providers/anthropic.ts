import { z } from "zod";
import { MAX_OUTPUT_TOKENS } from "@/shared/codeShare";
import {
  type CodeShareProvider,
  type ProviderInput,
  type TokenUsage,
  ProviderFailure,
  tokenCount,
} from "../providerTransport";
import { confirmServedModel } from "../providerModelEvidence";

const anthropicChunk = z.object({
  type: z.string(),
  delta: z.object({ type: z.string().optional(), text: z.string().optional() }).optional(),
  message: z
    .object({
      model: z.string(),
      usage: z.object({ input_tokens: tokenCount }).optional(),
    })
    .optional(),
  usage: z.object({ output_tokens: tokenCount }).optional(),
  error: z.object({ type: z.string() }).optional(),
});

async function readAnthropicStream(
  events: AsyncIterable<string>,
  append: ProviderInput["append"],
  requestedModel: string,
): Promise<TokenUsage | null> {
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  let confirmed = false;
  for await (const event of events) {
    const chunk = anthropicChunk.parse(JSON.parse(event));
    if (chunk.type === "error") {
      throw new ProviderFailure(
        chunk.error?.type === "rate_limit_error" ? "provider_limited" : "provider_unavailable",
      );
    }
    if (chunk.type === "message_stop") {
      if (!confirmed) throw new ProviderFailure("model_mismatch");
      return inputTokens === undefined || outputTokens === undefined
        ? null
        : { inputTokens, outputTokens };
    }
    if (chunk.type === "message_start") {
      if (!chunk.message) throw new ProviderFailure("model_mismatch");
      confirmServedModel(requestedModel, chunk.message.model, /-\d{8}$/u);
      confirmed = true;
      inputTokens = chunk.message.usage?.input_tokens;
    }
    if (chunk.type === "message_delta") outputTokens = chunk.usage?.output_tokens;
    if (
      chunk.type === "content_block_delta" &&
      chunk.delta?.type === "text_delta" &&
      chunk.delta.text
    ) {
      if (!confirmed) throw new ProviderFailure("model_mismatch");
      append(chunk.delta.text);
    }
  }
  throw new ProviderFailure("provider_unavailable");
}

export const anthropicSharing: CodeShareProvider = {
  id: "anthropic",
  keyEnvironmentVariable: "CODESHARE_ANTHROPIC_API_KEY",
  endpoint: "https://api.anthropic.com/v1/messages",
  modelEndpoint: "https://api.anthropic.com/v1/models/",
  headers: (key) => ({ "x-api-key": key, "anthropic-version": "2023-06-01" }),
  body: (model, messages) => ({ model, messages, stream: true, max_tokens: MAX_OUTPUT_TOKENS }),
  readStream: readAnthropicStream,
};
