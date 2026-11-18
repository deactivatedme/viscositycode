import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { XaiError } from "./xaiErrors";
import {
  SseDecoder,
  XaiResponsesStreamReader,
  readXaiOutputText,
  readXaiUsage,
  type SseMessage,
  type XaiStreamOutcome,
} from "./xaiSse";

function fixture(name: string): string {
  return readFileSync(join(import.meta.dirname, "__fixtures__", name), "utf8");
}

function decodeAll(text: string, chunkSize = text.length): SseMessage[] {
  const decoder = new SseDecoder();
  const messages: SseMessage[] = [];
  for (let index = 0; index < text.length; index += chunkSize) {
    messages.push(...decoder.push(text.slice(index, index + chunkSize)));
  }
  messages.push(...decoder.finish());
  return messages;
}

interface ReadResult {
  deltas: string[];
  outcome?: XaiStreamOutcome;
  error?: XaiError;
}

function readFixture(name: string, chunkSize?: number): ReadResult {
  const deltas: string[] = [];
  const reader = new XaiResponsesStreamReader((text) => deltas.push(text));
  try {
    for (const message of decodeAll(fixture(name), chunkSize)) {
      const outcome = reader.push(message);
      if (outcome) return { deltas, outcome };
    }
    return { deltas, outcome: reader.end() };
  } catch (error) {
    if (error instanceof XaiError) return { deltas, error };
    throw error;
  }
}

describe("SseDecoder", () => {
  it("dispatches data-only events and ignores comments and blank keep-alives", () => {
    expect(decodeAll(": ping\n\ndata: one\n\n\n\ndata: two\n\n")).toEqual([
      { data: "one" },
      { data: "two" },
    ]);
  });

  it("joins multi-line data, keeps event names and accepts CRLF and CR line endings", () => {
    expect(decodeAll("event: a\r\ndata: x\r\ndata: y\r\n\r\nevent: b\rdata:z\r\r")).toEqual([
      { event: "a", data: "x\ny" },
      { event: "b", data: "z" },
    ]);
  });

  it("produces the same messages whatever the chunk boundaries", () => {
    const text = fixture("search-tools.sse").replace(/\n/gu, "\r\n");
    const whole = decodeAll(text);
    expect(whole.length).toBeGreaterThan(5);
    for (const size of [1, 2, 3, 7, 64]) expect(decodeAll(text, size)).toEqual(whole);
  });

  it("flushes a final event that has no trailing blank line", () => {
    expect(decodeAll("data: tail")).toEqual([{ data: "tail" }]);
  });
});

describe("XaiResponsesStreamReader on recorded-format fixtures", () => {
  it("streams output_text deltas and completes with usage", () => {
    const result = readFixture("text-deltas.sse", 5);
    expect(result.error).toBeUndefined();
    expect(result.deltas).toEqual(["Hello", ", round", "table! ✓"]);
    expect(result.outcome).toEqual({
      text: "Hello, roundtable! ✓",
      usage: { inputTokens: 42, outputTokens: 7 },
    });
  });

  it("ignores web_search / x_search progress and annotations", () => {
    const result = readFixture("search-tools.sse", 11);
    expect(result.deltas).toEqual(["Top story: ", "rates held."]);
    expect(result.outcome).toEqual({
      text: "Top story: rates held.",
      usage: { inputTokens: 1200, outputTokens: 5 },
    });
  });

  it("maps an `error` stream event to response-failed with a redacted detail", () => {
    const result = readFixture("error-event.sse");
    expect(result.deltas).toEqual(["Partial "]);
    expect(result.error?.code).toBe("response-failed");
    expect(result.error?.detail).toContain("The model is overloaded");
    expect(result.error?.detail).not.toContain("ABCDEFGHIJKLMNOP");
    expect(result.error?.detail).toContain("[redacted]");
  });

  it("maps response.failed to response-failed with the API's message", () => {
    const result = readFixture("failed-response.sse");
    expect(result.error?.code).toBe("response-failed");
    expect(result.error?.detail).toBe("Content was blocked by the safety system.");
  });

  it("keeps streamed text when [DONE] arrives without response.completed", () => {
    const result = readFixture("done-without-completed.sse");
    expect(result.outcome).toEqual({ text: "Short answer." });
  });

  it("fails with `stream` when the stream ends with no text and no completion", () => {
    const reader = new XaiResponsesStreamReader(() => undefined);
    reader.push({ data: '{"type":"response.created","response":{}}' });
    expect(() => reader.end()).toThrow(XaiError);
    expect(() => reader.end()).toThrow(expect.objectContaining({ code: "stream" }));
  });

  it("uses the completed response's output when no deltas were streamed", () => {
    const reader = new XaiResponsesStreamReader(() => undefined);
    const outcome = reader.push({
      data: JSON.stringify({
        type: "response.completed",
        response: {
          output: [{ type: "message", content: [{ type: "output_text", text: "Whole." }] }],
          usage: { prompt_tokens: 3, completion_tokens: 1 },
        },
      }),
    });
    expect(outcome).toEqual({ text: "Whole.", usage: { inputTokens: 3, outputTokens: 1 } });
  });

  it("treats an incomplete response with text as done and without text as a stream failure", () => {
    const withText = new XaiResponsesStreamReader(() => undefined);
    withText.push({ data: '{"type":"response.output_text.delta","delta":"Cut"}' });
    expect(
      withText.push({
        data: '{"type":"response.incomplete","response":{"incomplete_details":{"reason":"max_output_tokens"}}}',
      }),
    ).toEqual({ text: "Cut" });

    const empty = new XaiResponsesStreamReader(() => undefined);
    expect(() =>
      empty.push({
        data: '{"type":"response.incomplete","response":{"incomplete_details":{"reason":"max_output_tokens"}}}',
      }),
    ).toThrow(expect.objectContaining({ code: "stream", detail: "max_output_tokens" }));
  });

  it("ignores non-JSON data lines", () => {
    const reader = new XaiResponsesStreamReader(() => undefined);
    expect(reader.push({ data: "not json" })).toBeUndefined();
    expect(reader.settled).toBe(false);
  });
});

describe("response helpers", () => {
  it("reads output text only from message output_text parts", () => {
    expect(
      readXaiOutputText({
        output: [
          { type: "reasoning", summary: [{ text: "secret thoughts" }] },
          {
            type: "message",
            content: [
              { type: "output_text", text: "A" },
              { type: "refusal", text: "no" },
              { type: "output_text", text: "B" },
            ],
          },
        ],
      }),
    ).toBe("AB");
    expect(readXaiOutputText(null)).toBe("");
  });

  it("reads usage counts and ignores junk", () => {
    expect(readXaiUsage({ input_tokens: 1, output_tokens: 2 })).toEqual({
      inputTokens: 1,
      outputTokens: 2,
    });
    expect(readXaiUsage({ input_tokens: -1, output_tokens: "x" })).toBeUndefined();
    expect(readXaiUsage(undefined)).toBeUndefined();
  });
});
