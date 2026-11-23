import { z } from "zod";
import type { ChatMessage, ShareModel, TurnIssue } from "@/shared/codeShare";

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ProviderInput {
  model: ShareModel;
  messages: ChatMessage[];
  signal: AbortSignal;
  append: (text: string) => void;
}

export type RunProvider = (input: ProviderInput) => Promise<TokenUsage | null>;

export class ProviderFailure extends Error {
  constructor(readonly issue: TurnIssue) {
    super(issue);
  }
}

interface CodeShareProviderIdentity {
  id: string;
  keyEnvironmentVariable: string;
}

export interface CodeShareProvider extends CodeShareProviderIdentity {
  endpoint: string;
  modelEndpoint: string;
  headers: (key: string) => Record<string, string>;
  body: (model: string, messages: ChatMessage[]) => object;
  readStream: (
    events: AsyncIterable<string>,
    append: ProviderInput["append"],
    requestedModel: string,
  ) => Promise<TokenUsage | null>;
}

export interface CodeShareCloudProvider extends CodeShareProviderIdentity {
  validateModel: (model: string, key: string, request: typeof fetch) => Promise<void>;
  run: (input: ProviderInput, key: string, request: typeof fetch) => Promise<TokenUsage | null>;
}

export const tokenCount = z.number().int().nonnegative();

export function statusIssue(status: number): TurnIssue {
  if (status === 429 || status === 402) return "provider_limited";
  if (status === 401 || status === 403) return "provider_access";
  if (status === 404) return "model_unavailable";
  if (status >= 400 && status < 500) return "request_rejected";
  return "provider_unavailable";
}

const MAX_EVENT_CHARS = 256_000;

async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  const reader = body.getReader();
  let partial = "";
  let data: string[] = [];
  let eventChars = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      partial += decoder.decode(chunk.value, { stream: true });
      let end = partial.indexOf("\n");
      while (end >= 0) {
        const line = partial.slice(0, end).replace(/\r$/u, "");
        partial = partial.slice(end + 1);
        eventChars += line.length + 1;
        if (eventChars > MAX_EVENT_CHARS) throw new ProviderFailure("provider_unavailable");
        if (line === "") {
          if (data.length) yield data.join("\n");
          data = [];
          eventChars = 0;
        } else if (line.startsWith("data:")) {
          data.push(line.slice(5).replace(/^ /u, ""));
        }
        end = partial.indexOf("\n");
      }
      if (partial.length > MAX_EVENT_CHARS) throw new ProviderFailure("provider_unavailable");
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export async function runProviderStream(
  provider: CodeShareProvider,
  key: string,
  request: typeof fetch,
  input: ProviderInput,
): Promise<TokenUsage | null> {
  const { model, messages, signal, append } = input;
  const response = await request(provider.endpoint, {
    method: "POST",
    signal,
    redirect: "error",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      ...provider.headers(key),
    },
    body: JSON.stringify(provider.body(model.model, messages)),
  });
  if (
    !response.ok ||
    !response.body ||
    !response.headers.get("content-type")?.includes("text/event-stream")
  ) {
    await response.body?.cancel().catch(() => undefined);
    throw new ProviderFailure(statusIssue(response.status));
  }
  return provider.readStream(sseData(response.body), append, model.model);
}
