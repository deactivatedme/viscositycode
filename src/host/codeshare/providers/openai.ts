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

const openAiChunk = z.object({
  model: z.string(),
  choices: z
    .array(
      z.object({
        delta: z.object({ content: z.string().nullish(), refusal: z.string().nullish() }),
      }),
    )
    .max(1),
  usage: z.object({ prompt_tokens: tokenCount, completion_tokens: tokenCount }).nullish(),
});

async function readOpenAiStream(
  events: AsyncIterable<string>,
  append: ProviderInput["append"],
  requestedModel: string,
): Promise<TokenUsage | null> {
  let usage: TokenUsage | null = null;
  let confirmed = false;
  for await (const event of events) {
    if (event === "[DONE]") {
      if (!confirmed) throw new ProviderFailure("model_mismatch");
      return usage;
    }
    const chunk = openAiChunk.safeParse(JSON.parse(event));
    if (!chunk.success) throw new ProviderFailure("provider_unavailable");
    confirmServedModel(requestedModel, chunk.data.model, /-\d{4}-\d{2}-\d{2}$/u);
    confirmed = true;
    const delta = chunk.data.choices[0]?.delta;
    const text = delta?.content ?? delta?.refusal;
    if (text) append(text);
    if (chunk.data.usage) {
      usage = {
        inputTokens: chunk.data.usage.prompt_tokens,
        outputTokens: chunk.data.usage.completion_tokens,
      };
    }
  }
  throw new ProviderFailure("provider_unavailable");
}

export const openAiSharing: CodeShareProvider = {
  id: "openai",
  ownerLabel: "OpenAI API",
  keyEnvironmentVariable: "CODESHARE_OPENAI_API_KEY",
  endpoint: "https://api.openai.com/v1/chat/completions",
  modelEndpoint: "https://api.openai.com/v1/models/",
  headers: (key) => ({ Authorization: `Bearer ${key}` }),
  body: (model, messages) => ({
    model,
    messages,
    stream: true,
    store: false,
    max_completion_tokens: MAX_OUTPUT_TOKENS,
    stream_options: { include_usage: true },
  }),
  readStream: readOpenAiStream,
};
