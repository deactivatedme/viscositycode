// ViscosityCode: a Claude chat turn that ends because the account ran out of
// usage carries the shared `usage_limited` reason; its message is unchanged.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Options, Query, SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { RuntimeEvent, ThreadConfig } from "@/shared/contracts";
import { ClaudeSdkSession } from "./sdkSession";
import {
  assistantMessage,
  createClaudeTestQuery,
  flushSdkMessages,
  resultMessage,
} from "./sdkSessionTestHarness";

const sdk = vi.hoisted(() => ({
  query: vi.fn<(input: { prompt: AsyncIterable<SDKUserMessage>; options?: Options }) => Query>(),
}));
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({ query: sdk.query }));
vi.mock("../binaryResolver", () => ({ resolveAgentBinaryPath: () => "/test-bin/claude" }));

const config: ThreadConfig = { model: "sonnet" };
const LIMIT_TEXT = "You've hit your limit · resets 3pm (Europe/Rome)";

const sessions: ClaudeSdkSession[] = [];
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.dispose()));
  vi.restoreAllMocks();
});

async function runningTurn() {
  const fake = createClaudeTestQuery();
  sdk.query.mockReturnValue(fake.runtime);
  const events: RuntimeEvent[] = [];
  const session = await ClaudeSdkSession.create({
    threadId: "claude-usage-limit",
    projectLocation: { kind: "posix", path: process.cwd() },
    config,
    presentationMode: "gui",
  });
  sessions.push(session);
  session.setListener({
    onRuntimeEvent: (event) => events.push(event),
    onUpdate: () => {},
    onError: () => {},
    onClose: () => {},
  });
  const id = await session.openThread(config);
  const inputs = sdk.query.mock.calls.at(-1)![0].prompt[Symbol.asyncIterator]();
  const write = async (message: Record<string, unknown>) => {
    fake.output.write(message as unknown as SDKMessage);
    await flushSdkMessages();
  };
  const startTurn = async (prompt: string) => {
    await session.startTurn(prompt, config);
    await inputs.next();
  };
  await startTurn("first");
  return { id, events, write, startTurn };
}

function apiErrorResult(sessionId: string, status: number, text = LIMIT_TEXT) {
  return {
    ...resultMessage(sessionId),
    is_error: true,
    api_error_status: status,
    result: text,
  };
}

const errors = (events: RuntimeEvent[]) => events.filter((event) => event.type === "error");

describe("ClaudeSdkSession usage limits", () => {
  it("marks the error of a turn that hit the account's usage limit as usage_limited", async () => {
    const h = await runningTurn();
    await h.write({ ...assistantMessage(h.id, "limit-reply"), error: "rate_limit" });
    await h.write(apiErrorResult(h.id, 429));

    expect(errors(h.events)).toEqual([
      {
        type: "error",
        threadId: "claude-usage-limit",
        message: LIMIT_TEXT,
        reason: "usage_limited",
      },
    ]);
    expect(h.events).toContainEqual(
      expect.objectContaining({ type: "turn.completed", state: "failed" }),
    );
  });

  it("names a billing failure the SDK classified, whatever its HTTP status", async () => {
    const h = await runningTurn();
    const text = "Credit balance is too low";
    await h.write({ ...assistantMessage(h.id, "billing-reply"), error: "billing_error" });
    await h.write(apiErrorResult(h.id, 400, text));

    expect(errors(h.events)).toEqual([
      { type: "error", threadId: "claude-usage-limit", message: text, reason: "usage_limited" },
    ]);
  });

  it("leaves other API failures without a reason", async () => {
    const h = await runningTurn();
    await h.write({ ...assistantMessage(h.id, "server-reply"), error: "server_error" });
    await h.write(apiErrorResult(h.id, 500, "API Error: 500 Internal server error"));

    expect(errors(h.events)).toEqual([
      {
        type: "error",
        threadId: "claude-usage-limit",
        message: "API Error: 500 Internal server error",
      },
    ]);
  });

  it("does not carry a usage signal from an earlier turn into the next one", async () => {
    const h = await runningTurn();
    await h.write({ type: "rate_limit_event", rate_limit_info: { status: "rejected" } });
    await h.write({ ...assistantMessage(h.id, "ok-reply") });
    await h.write(resultMessage(h.id));
    expect(errors(h.events)).toEqual([]);

    await h.startTurn("second");
    await h.write(apiErrorResult(h.id, 500, "API Error: 500 Internal server error"));
    expect(errors(h.events)).toEqual([
      {
        type: "error",
        threadId: "claude-usage-limit",
        message: "API Error: 500 Internal server error",
      },
    ]);
  });
});
