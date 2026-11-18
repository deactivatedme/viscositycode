/**
 * ViscosityCode: Server-Sent Events parsing for the xAI Responses API.
 *
 * `POST /v1/responses` with `stream: true` sends data-only server-sent events
 * and ends with `data: [DONE]` (docs.x.ai › REST API › Responses). Each data
 * payload is a JSON object whose `type` names the Responses stream event:
 * `response.output_text.delta` carries text in `delta`,
 * `response.completed` carries the final `response` (with `output` and
 * `usage.input_tokens` / `usage.output_tokens`), `response.failed` /
 * `response.incomplete` end the response early, and `error` reports a
 * stream-level failure. Everything else (created, in_progress, output items,
 * reasoning, web_search_call / x_search_call progress) is ignored.
 */
import { XaiError, redactXaiText } from "./xaiErrors";

export interface SseMessage {
  /** The `event:` field, when the server sends one. */
  event?: string;
  data: string;
}

/**
 * Incremental SSE decoder (WHATWG event-stream rules, minus `id`/`retry`,
 * which this client does not use). Feed decoded text in arbitrary chunks.
 */
export class SseDecoder {
  private buffer = "";
  private dataLines: string[] = [];
  private eventName: string | undefined;

  push(chunk: string): SseMessage[] {
    this.buffer += chunk;
    const messages: SseMessage[] = [];
    let start = 0;
    for (let index = 0; index < this.buffer.length; index += 1) {
      const char = this.buffer[index];
      if (char !== "\n" && char !== "\r") continue;
      // A CR at the very end may be the first half of CRLF: wait for more input.
      if (char === "\r" && index === this.buffer.length - 1) break;
      const line = this.buffer.slice(start, index);
      if (char === "\r" && this.buffer[index + 1] === "\n") index += 1;
      start = index + 1;
      const message = this.processLine(line);
      if (message) messages.push(message);
    }
    this.buffer = this.buffer.slice(start);
    return messages;
  }

  /** Dispatch whatever is pending at end of stream. */
  finish(): SseMessage[] {
    const messages: SseMessage[] = [];
    if (this.buffer.length > 0) {
      const message = this.processLine(this.buffer);
      this.buffer = "";
      if (message) messages.push(message);
    }
    const trailing = this.dispatch();
    if (trailing) messages.push(trailing);
    return messages;
  }

  private processLine(line: string): SseMessage | undefined {
    if (line === "") return this.dispatch();
    if (line.startsWith(":")) return undefined;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "data") this.dataLines.push(value);
    else if (field === "event") this.eventName = value;
    return undefined;
  }

  private dispatch(): SseMessage | undefined {
    if (this.dataLines.length === 0) {
      this.eventName = undefined;
      return undefined;
    }
    const message: SseMessage = {
      ...(this.eventName ? { event: this.eventName } : {}),
      data: this.dataLines.join("\n"),
    };
    this.dataLines = [];
    this.eventName = undefined;
    return message;
  }
}

export interface XaiUsage {
  inputTokens?: number;
  outputTokens?: number;
}

export interface XaiStreamOutcome {
  text: string;
  usage?: XaiUsage;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** `usage.input_tokens/output_tokens` (schema), or the `prompt/completion` names some examples show. */
export function readXaiUsage(value: unknown): XaiUsage | undefined {
  const usage = asRecord(value);
  if (!usage) return undefined;
  const inputTokens = readCount(usage.input_tokens) ?? readCount(usage.prompt_tokens);
  const outputTokens = readCount(usage.output_tokens) ?? readCount(usage.completion_tokens);
  if (inputTokens === undefined && outputTokens === undefined) return undefined;
  return {
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
  };
}

/** Text of a Responses API `response` object: `output[].content[]` items of type `output_text`. */
export function readXaiOutputText(response: unknown): string {
  const record = asRecord(response);
  if (!record) return "";
  if (typeof record.output_text === "string") return record.output_text;
  const output = Array.isArray(record.output) ? record.output : [];
  const parts: string[] = [];
  for (const item of output) {
    const itemRecord = asRecord(item);
    if (!itemRecord || itemRecord.type !== "message") continue;
    const content = Array.isArray(itemRecord.content) ? itemRecord.content : [];
    for (const part of content) {
      const partRecord = asRecord(part);
      if (partRecord?.type === "output_text" && typeof partRecord.text === "string") {
        parts.push(partRecord.text);
      }
    }
  }
  return parts.join("");
}

function readErrorMessage(value: unknown): string | undefined {
  const record = asRecord(value);
  if (!record) return typeof value === "string" && value.trim() ? value : undefined;
  const nested = asRecord(record.error);
  const candidates = [record.message, nested?.message, record.error, record.code, nested?.code];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate;
  }
  return undefined;
}

/**
 * Turns decoded SSE messages into deltas and one terminal outcome. `push`
 * returns the outcome once the response has completed; it throws an
 * `XaiError` when the API reports a failure. Call `end()` when the byte
 * stream closes to settle a response that never sent `response.completed`.
 */
export class XaiResponsesStreamReader {
  private text = "";
  private outcome: XaiStreamOutcome | undefined;
  private readonly secret: string | undefined;

  constructor(
    private readonly onDelta: (text: string) => void,
    options: { secret?: string } = {},
  ) {
    this.secret = options.secret;
  }

  get settled(): boolean {
    return this.outcome !== undefined;
  }

  get partialText(): string {
    return this.text;
  }

  push(message: SseMessage): XaiStreamOutcome | undefined {
    if (this.outcome) return this.outcome;
    const data = message.data.trim();
    if (data === "[DONE]") return this.end();
    let payload: Record<string, unknown> | undefined;
    try {
      payload = asRecord(JSON.parse(data));
    } catch {
      // Keep-alives or vendor extras that are not JSON are ignored.
      return undefined;
    }
    if (!payload) return undefined;
    const type = typeof payload.type === "string" ? payload.type : message.event;
    switch (type) {
      case "response.output_text.delta": {
        if (typeof payload.delta === "string" && payload.delta.length > 0) {
          this.text += payload.delta;
          this.onDelta(payload.delta);
        }
        return undefined;
      }
      case "response.output_text.done": {
        // Only fills the text when no deltas arrived (some servers send the
        // whole text here); never duplicates text already streamed.
        if (!this.text && typeof payload.text === "string") this.text = payload.text;
        return undefined;
      }
      case "response.completed":
        return this.complete(payload.response);
      case "response.incomplete": {
        const response = asRecord(payload.response);
        if (this.text || readXaiOutputText(response)) return this.complete(response);
        const details = asRecord(response?.incomplete_details);
        throw this.failure(
          "stream",
          typeof details?.reason === "string" ? details.reason : undefined,
        );
      }
      case "response.failed": {
        const response = asRecord(payload.response);
        throw this.failure("response-failed", readErrorMessage(response?.error));
      }
      case "error":
        throw this.failure("response-failed", readErrorMessage(payload));
      default:
        return undefined;
    }
  }

  /** The byte stream closed (or sent `[DONE]`). */
  end(): XaiStreamOutcome {
    if (this.outcome) return this.outcome;
    if (!this.text) throw new XaiError("stream");
    // `[DONE]` without `response.completed`: keep what was streamed.
    this.outcome = { text: this.text };
    return this.outcome;
  }

  private complete(response: unknown): XaiStreamOutcome {
    const finalText = this.text || readXaiOutputText(response);
    const usage = readXaiUsage(asRecord(response)?.usage);
    this.text = finalText;
    this.outcome = { text: finalText, ...(usage ? { usage } : {}) };
    return this.outcome;
  }

  private failure(code: "stream" | "response-failed", detail: string | undefined): XaiError {
    return new XaiError(code, detail ? { detail: redactXaiText(detail, this.secret) } : {});
  }
}
