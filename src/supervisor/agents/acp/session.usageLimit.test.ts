// ViscosityCode: an ACP turn that ends because the account ran out of usage
// carries the shared `usage_limited` reason; the surfaced message is unchanged.
import { describe, expect, it, vi } from "vitest";
import { RequestError } from "@agentclientprotocol/sdk";
import { makeConfigSyncSession } from "./sessionTestFixture";
import type { AcpPromptErrorReasonResolver } from "./sessionErrors";

const config = { model: "model-a" };

type Listener = ReturnType<typeof makeConfigSyncSession>["listener"];

function errorEvents(listener: Listener) {
  return listener.onRuntimeEvent.mock.calls
    .map(([event]) => event as { type: string })
    .filter((event) => event.type === "error");
}

/** Starts a turn whose prompt stays in flight until `finish` resolves it. */
async function inFlightTurn() {
  const fixture = makeConfigSyncSession();
  let resolvePrompt: ((value: { stopReason: string }) => void) | undefined;
  fixture.connection.prompt.mockReturnValueOnce(
    new Promise<{ stopReason: string }>((resolve) => {
      resolvePrompt = resolve;
    }),
  );
  const turn = fixture.session.startTurn("continue", config);
  await vi.waitFor(() => expect(fixture.connection.prompt).toHaveBeenCalledOnce());
  const finish = async () => {
    resolvePrompt?.({ stopReason: "end_turn" });
    await turn;
  };
  return { ...fixture, finish };
}

describe("ACP usage limits", () => {
  it("names an Antigravity quota failure on a tool result as usage_limited", async () => {
    const { listener, session, finish } = await inFlightTurn();
    session.handleSessionUpdate({
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "tc-view",
        title: "Running view_file",
        kind: "read",
        status: "in_progress",
      },
    });
    session.handleSessionUpdate({
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: "tc-view",
        status: "failed",
        rawOutput:
          'Encountered retryable error from model provider: Agent execution terminated due to error. ("request failed (code 429): Individual quota reached. Please upgrade your subscription to increase your limits. Resets in 1h33m48s.")',
      },
    });
    await finish();

    expect(errorEvents(listener)).toEqual([
      {
        type: "error",
        threadId: "thread-1",
        message:
          "Individual quota reached. Please upgrade your subscription to increase your limits. Resets in 1h33m48s",
        reason: "usage_limited",
      },
    ]);
  });

  it("names a Factory usage-limit chunk as usage_limited and keeps its detail", async () => {
    const { connection, listener, session } = makeConfigSyncSession();
    connection.prompt.mockImplementationOnce(async () => {
      session.handleSessionUpdate({
        update: {
          sessionUpdate: "agent_message_chunk",
          content: {
            type: "text",
            text: 'Error: 402 {"detail":"You\'ve reached your 5-hour Droid Core usage limit (resets in 0h 3min).","status":402,"title":"Payment Required","displayToUser":true}',
          },
        },
      });
      throw RequestError.internalError({ details: "Internal error: Agent error" });
    });

    await session.startTurn("hello", config);

    expect(errorEvents(listener)).toEqual([
      {
        type: "error",
        threadId: "thread-1",
        message: "You've reached your 5-hour Droid Core usage limit (resets in 0h 3min).",
        reason: "usage_limited",
      },
    ]);
    expect(listener.onRuntimeEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "turn.completed", state: "failed" }),
    );
  });

  it("names a rejected prompt whose error says the account is out of credits", async () => {
    const { connection, listener, session } = makeConfigSyncSession();
    connection.prompt.mockRejectedValueOnce(
      RequestError.internalError({ details: "You are out of credits for this billing period." }),
    );

    await session.startTurn("hello", config);

    expect(errorEvents(listener)).toEqual([
      {
        type: "error",
        threadId: "thread-1",
        message: "You are out of credits for this billing period.",
        reason: "usage_limited",
      },
    ]);
  });

  it("keeps the provider resolver's reason ahead of the usage-limit wording", async () => {
    const { connection, listener, session } = makeConfigSyncSession();
    const error = new RequestError(-32603, "401: credit limit check failed, sign in again", {
      status: 401,
    });
    const resolver = vi.fn<AcpPromptErrorReasonResolver>(() => "auth_required");
    (session as unknown as Record<string, unknown>)["promptErrorReason"] = resolver;
    connection.prompt.mockRejectedValueOnce(error);

    await session.startTurn("hello", config);

    expect(errorEvents(listener)).toEqual([
      expect.objectContaining({ type: "error", reason: "auth_required" }),
    ]);
  });

  it("does not name a transient Factory rate limit as usage_limited", async () => {
    const { connection, listener, session } = makeConfigSyncSession();
    connection.prompt.mockImplementationOnce(async () => {
      session.handleSessionUpdate({
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Error: 429 status code (no body)" },
        },
      });
      throw RequestError.internalError({ details: "Internal error: Agent error" });
    });

    await session.startTurn("hello", config);

    expect(errorEvents(listener)).toEqual([
      {
        type: "error",
        threadId: "thread-1",
        message: "Rate limit exceeded (HTTP 429). Wait and retry, or switch models.",
      },
    ]);
    expect(listener.onRuntimeEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "turn.completed", state: "failed" }),
    );
  });

  it("does not name a rejected prompt that only reports HTTP 429", async () => {
    const { connection, listener, session } = makeConfigSyncSession();
    connection.prompt.mockRejectedValueOnce(
      RequestError.internalError({ details: "Rate limit exceeded (HTTP 429). Wait and retry." }),
    );

    await session.startTurn("hello", config);

    expect(errorEvents(listener)).toEqual([
      {
        type: "error",
        threadId: "thread-1",
        message: "Rate limit exceeded (HTTP 429). Wait and retry.",
      },
    ]);
  });

  it("leaves other provider failures without a reason", async () => {
    const { connection, listener, session } = makeConfigSyncSession();
    connection.prompt.mockImplementationOnce(async () => {
      session.handleSessionUpdate({
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Error: 403 status code (no body)" },
        },
      });
      throw RequestError.internalError({ details: "Internal error: Agent error" });
    });

    await session.startTurn("hello", config);

    expect(errorEvents(listener)).toEqual([
      {
        type: "error",
        threadId: "thread-1",
        message:
          "Access denied (HTTP 403). Your Factory account may lack permission for this model or workspace.",
      },
    ]);
  });
});
