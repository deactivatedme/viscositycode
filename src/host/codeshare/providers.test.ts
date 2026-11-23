import { describe, expect, it, vi } from "vitest";
import { MAX_OUTPUT_TOKENS, parseModel } from "@/shared/codeShare";
import { createProviderRunner } from "./providers";

function stream(chunks: string[]): Response {
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
        controller.close();
      },
    }),
    { headers: { "Content-Type": "text/event-stream" } },
  );
}

const signal = new AbortController().signal;
const messages = [{ role: "user" as const, content: "Explain this code." }];

describe("CodeShare provider streaming", () => {
  it("streams OpenAI content and reads the terminal usage record", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        stream([
          'data: {"model":"test-model","choices":[{"delta":{"content":"Hell',
          'o"}}],"usage":null}\r\n\r\n',
          'data: {"model":"test-model","choices":[],"usage":{"prompt_tokens":8,"completion_tokens":2}}\n\n',
          "data: [DONE]\n\n",
        ]),
      );
    const append = vi.fn<(text: string) => void>();
    const run = createProviderRunner({ openai: "fixture-key" }, fetcher);
    await expect(
      run({ model: parseModel("openai:test-model"), messages, signal, append }),
    ).resolves.toEqual({ inputTokens: 8, outputTokens: 2 });
    expect(append.mock.calls).toEqual([["Hello"]]);
    const [url, options] = fetcher.mock.calls[0]!;
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(options?.headers).toMatchObject({ Authorization: "Bearer fixture-key" });
    expect(JSON.parse(options?.body as string)).toMatchObject({
      model: "test-model",
      stream: true,
      max_completion_tokens: MAX_OUTPUT_TOKENS,
      store: false,
    });
  });

  it("streams Anthropic text and uses the final cumulative output token count", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        stream([
          'event: message_start\ndata: {"type":"message_start","message":{"model":"test-model","usage":{"input_tokens":9}}}\n\n',
          'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}\n\n',
          'data: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"hidden"}}\n\n',
          'data: {"type":"message_delta","usage":{"output_tokens":3}}\n\n',
          'data: {"type":"message_delta","usage":{"output_tokens":4}}\n\n',
          'data: {"type":"message_stop"}\n\n',
        ]),
      );
    const append = vi.fn<(text: string) => void>();
    const run = createProviderRunner({ anthropic: "fixture-key" }, fetcher);
    await expect(
      run({ model: parseModel("anthropic:test-model"), messages, signal, append }),
    ).resolves.toEqual({ inputTokens: 9, outputTokens: 4 });
    expect(append.mock.calls).toEqual([["Hello"]]);
    const [url, options] = fetcher.mock.calls[0]!;
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(options?.headers).toMatchObject({
      "x-api-key": "fixture-key",
      "anthropic-version": "2023-06-01",
    });
    expect(JSON.parse(options?.body as string)).toMatchObject({
      model: "test-model",
      stream: true,
      max_tokens: MAX_OUTPUT_TOKENS,
    });
  });

  it("runs Grok through the xAI Responses endpoint and verifies its model", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        stream([
          'data: {"type":"response.created","response":{"model":"grok-4.7","usage":null}}\n\n',
          'data: {"type":"response.output_text.delta","delta":"Hello"}\n\n',
          'data: {"type":"response.completed","response":{"model":"grok-4.7","usage":{"input_tokens":8,"output_tokens":2}}}\n\n',
        ]),
      );
    const append = vi.fn<(text: string) => void>();
    const run = createProviderRunner({ xai: "fixture-key" }, fetcher);
    await expect(
      run({ model: parseModel("xai:grok-4.7"), messages, signal, append }),
    ).resolves.toEqual({ inputTokens: 8, outputTokens: 2 });
    expect(append.mock.calls).toEqual([["Hello"]]);
    const [url, options] = fetcher.mock.calls[0]!;
    expect(url).toBe("https://api.x.ai/v1/responses");
    expect(JSON.parse(options?.body as string)).toMatchObject({
      model: "grok-4.7",
      input: messages,
      store: false,
      max_output_tokens: MAX_OUTPUT_TOKENS,
    });
  });

  it("blocks text when the response identifies a different model", async () => {
    const fixtures = [
      [
        "openai:gpt-5.4",
        'data: {"model":"gpt-5.3","choices":[{"delta":{"content":"Wrong model"}}]}\n\n',
      ],
      [
        "anthropic:claude-fable-5-2",
        'data: {"type":"message_start","message":{"model":"claude-fable-5-1"}}\n\n',
      ],
    ] as const;
    const append = vi.fn<(text: string) => void>();
    for (const [id, event] of fixtures) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(stream([event]));
      const run = createProviderRunner({ openai: "fixture", anthropic: "fixture" }, fetcher);
      await expect(run({ model: parseModel(id), messages, signal, append })).rejects.toMatchObject({
        issue: "model_mismatch",
      });
    }
    expect(append).not.toHaveBeenCalled();
  });

  it("classifies provider errors and incomplete streams without retrying", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("secret provider detail", { status: 429 }))
      .mockResolvedValueOnce(
        stream(['data: {"model":"test-model","choices":[{"delta":{"content":"Partial"}}]}\n\n']),
      );
    const append = vi.fn<(text: string) => void>();
    const run = createProviderRunner({ openai: "fixture-key" }, fetcher);
    const input = { model: parseModel("openai:test-model"), messages, signal, append };
    await expect(run(input)).rejects.toMatchObject({ issue: "provider_limited" });
    await expect(run(input)).rejects.toMatchObject({ issue: "provider_unavailable" });
    expect(append.mock.calls).toEqual([["Partial"]]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
